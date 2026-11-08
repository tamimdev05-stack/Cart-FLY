// Cloudflare Worker for Mailflux
// Handles:
// 1. Inbound Email Processing via Cloudflare Email Routing
// 2. Full REST API for Accounts, Inboxes, and Message Reading
// 3. Auto-expiring storage via Cloudflare Workers KV (Zero DB maintenance)

// Helper: Simple MIME parser for raw emails
function parseRawEmail(raw, message) {
  const subject = message.headers.get('subject') || '(No Subject)';
  const from = message.from || message.headers.get('from') || 'Unknown';
  const to = message.to || message.headers.get('to') || '';
  const date = message.headers.get('date') || new Date().toISOString();

  let textBody = '';
  let htmlBody = '';

  // Look for Content-Type boundary
  const contentType = message.headers.get('content-type') || '';
  const boundaryMatch = contentType.match(/boundary=["']?([^"';]+)["']?/i);

  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = raw.split('--' + boundary);

    for (const part of parts) {
      if (part.includes('--') && part.trim().endsWith('--')) continue; // End boundary

      const headerBodySplit = part.split(/\r?\n\r?\n/);
      if (headerBodySplit.length < 2) continue;

      const partHeaders = headerBodySplit[0];
      const partBody = headerBodySplit.slice(1).join('\n\n').trim();

      const isHtml = /content-type:[^;\n]*text\/html/i.test(partHeaders);
      const isPlain = /content-type:[^;\n]*text\/plain/i.test(partHeaders);

      // Handle Quoted-Printable decoding
      const isQP = /content-transfer-encoding:\s*quoted-printable/i.test(partHeaders);
      const isBase64 = /content-transfer-encoding:\s*base64/i.test(partHeaders);

      let decoded = partBody;
      if (isQP) {
        decoded = decoded.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
      } else if (isBase64) {
        try {
          decoded = atob(decoded.replace(/\s+/g, ''));
        } catch(e) {}
      }

      if (isHtml && !htmlBody) {
        htmlBody = decoded;
      } else if (isPlain && !textBody) {
        textBody = decoded;
      }
    }
  }

  // Fallback if no multipart boundary found
  if (!textBody && !htmlBody) {
    const split = raw.split(/\r?\n\r?\n/);
    const body = split.slice(1).join('\n\n').trim();
    if (body.includes('<html') || body.includes('<body') || body.includes('<div') || body.includes('<p>')) {
      htmlBody = body;
    } else {
      textBody = body;
    }
  }

  // Generate intro snippet
  const intro = (textBody || htmlBody.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().substring(0, 120);

  return {
    subject,
    from: { address: from, name: from.split('<')[0].replace(/["']/g, '').trim() || from },
    to: [{ address: to }],
    createdAt: new Date().toISOString(),
    intro,
    text: textBody,
    html: htmlBody ? [htmlBody] : [],
    raw
  };
}

// Helper: Hash password with SHA-256
async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + ':mailflux_salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// CORS Headers helper
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders()
    }
  });
}

export default {
  // -------------------------------------------------------------
  // 1. CLOUDFLARE EMAIL ROUTING WORKER HANDLER
  // -------------------------------------------------------------
  async email(message, env, ctx) {
    try {
      const recipient = (message.to || '').toLowerCase().trim();
      const rawText = await new Response(message.raw).text();
      const parsed = parseRawEmail(rawText, message);

      const msgId = 'msg_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);
      parsed.id = msgId;
      parsed.seen = false;

      // Save message in KV with 24 hours (86,400s) TTL
      // KV Key: msg:{recipient}:{msgId}
      const msgKey = `msg:${recipient}:${msgId}`;
      await env.MAIL_KV.put(msgKey, JSON.stringify(parsed), { expirationTtl: 86400 });

      // Update recipient's message index list in KV
      const indexKey = `inbox:${recipient}`;
      const existingRaw = await env.MAIL_KV.get(indexKey);
      let list = existingRaw ? JSON.parse(existingRaw) : [];
      // Keep summary object in index list for fast list rendering
      list.unshift({
        id: parsed.id,
        from: parsed.from,
        to: parsed.to,
        subject: parsed.subject,
        intro: parsed.intro,
        seen: false,
        createdAt: parsed.createdAt
      });
      // Limit to latest 100 messages per mailbox
      list = list.slice(0, 100);
      await env.MAIL_KV.put(indexKey, JSON.stringify(list), { expirationTtl: 86400 });

      console.log(`✅ Stored message for ${recipient}: "${parsed.subject}" (ID: ${msgId})`);
    } catch(err) {
      console.error('❌ Error processing inbound email:', err.message);
    }
  },

  // -------------------------------------------------------------
  // 2. HTTP REST API HANDLER
  // -------------------------------------------------------------
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method.toUpperCase();

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    let pathname = url.pathname;
    if (pathname.startsWith('/api/')) {
      pathname = pathname.substring(4);
    } else if (pathname === '/api') {
      pathname = '/';
    }

    try {
      // Health / Status
      if (pathname === '/' || pathname === '/health') {
        return jsonResponse({
          success: true,
          status: 'Mailflux Cloudflare Edge Mail Service Active',
          domain: 'freelancingaid.online'
        });
      }

      // 1. Domains endpoint
      if (pathname === '/domains' && method === 'GET') {
        return jsonResponse({
          success: true,
          domains: [
            {
              id: 'domain_1',
              domain: 'freelancingaid.online',
              isActive: true,
              isPrivate: false,
              createdAt: '2026-01-01T00:00:00Z'
            }
          ],
          activeDomain: 'freelancingaid.online',
          lastUpdated: new Date().toISOString()
        });
      }

      // 2. Create Account (Username & Password strictly required)
      if (pathname === '/create-account' && method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch(e) {
          return jsonResponse({ success: false, error: 'Invalid JSON request body' }, 400);
        }

        const { username, password } = body;
        if (!username || typeof username !== 'string' || !username.trim()) {
          return jsonResponse({ success: false, error: 'Username is required. Random email creation is disabled.' }, 400);
        }

        if (!password || typeof password !== 'string' || !password.trim()) {
          return jsonResponse({ success: false, error: 'Password is required. Password ছাড়া একাউন্ট তৈরি করা যাবে না।' }, 400);
        }

        const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
        if (cleanUsername.length < 3) {
          return jsonResponse({ success: false, error: 'Username must be at least 3 characters long.' }, 400);
        }

        if (password.length < 6) {
          return jsonResponse({ success: false, error: 'Password must be at least 6 characters long.' }, 400);
        }

        const address = `${cleanUsername}@freelancingaid.online`.toLowerCase();
        const accountKey = `acc:${address}`;
        const existing = await env.MAIL_KV.get(accountKey);
        const passHash = await hashPassword(password.trim());

        if (existing) {
          const accData = JSON.parse(existing);
          if (accData.passwordHash !== passHash) {
            return jsonResponse({ success: false, error: 'This username is already taken. Please choose another username or sign in with your password.' }, 400);
          }
        }

        // Store account credentials in KV (retained for 30 days)
        const accountRecord = {
          id: address,
          address,
          passwordHash: passHash,
          createdAt: existing ? JSON.parse(existing).createdAt : new Date().toISOString()
        };
        await env.MAIL_KV.put(accountKey, JSON.stringify(accountRecord), { expirationTtl: 30 * 86400 });

        // Token is base64 representation of address + hash (simple, stateless edge token)
        const token = btoa(`${address}:${passHash}:${Date.now()}`);

        return jsonResponse({
          success: true,
          account: {
            id: address,
            address,
            password: password.trim(),
            token,
            createdAt: accountRecord.createdAt
          }
        });
      }

      // 3. Login
      if (pathname === '/login' && method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch(e) {
          return jsonResponse({ success: false, error: 'Invalid JSON request body' }, 400);
        }

        const { address, password } = body;
        if (!address || !address.trim() || !password || !password.trim()) {
          return jsonResponse({ success: false, error: 'Email and password are required.' }, 400);
        }

        const cleanAddress = address.trim().toLowerCase();
        const accountKey = `acc:${cleanAddress}`;
        const existing = await env.MAIL_KV.get(accountKey);

        const passHash = await hashPassword(password.trim());

        if (existing) {
          const acc = JSON.parse(existing);
          if (acc.passwordHash !== passHash) {
            return jsonResponse({ success: false, error: 'Invalid email or password. Password সঠিক নয় অথবা একাউন্টটি পাওয়া যায়নি।' }, 401);
          }
        } else {
          // If account wasn't pre-created (e.g. created on the fly with password), register it:
          const accountRecord = {
            id: cleanAddress,
            address: cleanAddress,
            passwordHash: passHash,
            createdAt: new Date().toISOString()
          };
          await env.MAIL_KV.put(accountKey, JSON.stringify(accountRecord), { expirationTtl: 30 * 86400 });
        }

        const token = btoa(`${cleanAddress}:${passHash}:${Date.now()}`);

        return jsonResponse({
          success: true,
          account: {
            id: cleanAddress,
            address: cleanAddress,
            password: password.trim(),
            token,
            createdAt: new Date().toISOString()
          }
        });
      }

      // Helper to verify Bearer token from header
      const authHeader = request.headers.get('authorization') || '';
      let authenticatedAddress = '';
      if (authHeader.startsWith('Bearer ')) {
        try {
          const decodedToken = atob(authHeader.replace('Bearer ', '').trim());
          const parts = decodedToken.split(':');
          authenticatedAddress = parts[0] ? parts[0].toLowerCase() : '';
        } catch(e) {}
      }

      // 4. Messages (List)
      if (pathname === '/messages' && method === 'GET') {
        if (!authenticatedAddress) {
          return jsonResponse({ success: false, error: 'Authorization header required. Please login.' }, 401);
        }

        const indexKey = `inbox:${authenticatedAddress}`;
        const rawList = await env.MAIL_KV.get(indexKey);
        const messages = rawList ? JSON.parse(rawList) : [];

        return jsonResponse({
          success: true,
          messages,
          total: messages.length
        });
      }

      // 5. Message by ID (GET / PATCH / DELETE)
      const msgMatch = pathname.match(/^\/messages\/([^/?]+)$/);
      if (msgMatch) {
        if (!authenticatedAddress) {
          return jsonResponse({ success: false, error: 'Authorization header required.' }, 401);
        }

        const id = msgMatch[1];
        const msgKey = `msg:${authenticatedAddress}:${id}`;

        if (method === 'GET') {
          const rawMsg = await env.MAIL_KV.get(msgKey);
          if (!rawMsg) {
            return jsonResponse({ success: false, error: 'Message not found or expired.' }, 404);
          }
          const message = JSON.parse(rawMsg);
          return jsonResponse({ success: true, message });
        }

        if (method === 'PATCH') {
          const rawMsg = await env.MAIL_KV.get(msgKey);
          if (rawMsg) {
            const message = JSON.parse(rawMsg);
            message.seen = true;
            await env.MAIL_KV.put(msgKey, JSON.stringify(message), { expirationTtl: 86400 });
          }

          // Update index list seen state as well
          const indexKey = `inbox:${authenticatedAddress}`;
          const rawList = await env.MAIL_KV.get(indexKey);
          if (rawList) {
            let list = JSON.parse(rawList);
            list = list.map(m => m.id === id ? { ...m, seen: true } : m);
            await env.MAIL_KV.put(indexKey, JSON.stringify(list), { expirationTtl: 86400 });
          }

          return jsonResponse({ success: true, message: { id, seen: true } });
        }

        if (method === 'DELETE') {
          await env.MAIL_KV.delete(msgKey);

          // Remove from index list
          const indexKey = `inbox:${authenticatedAddress}`;
          const rawList = await env.MAIL_KV.get(indexKey);
          if (rawList) {
            let list = JSON.parse(rawList);
            list = list.filter(m => m.id !== id);
            await env.MAIL_KV.put(indexKey, JSON.stringify(list), { expirationTtl: 86400 });
          }

          return jsonResponse({ success: true, message: 'Message deleted successfully' });
        }
      }

      // 6. Source by ID
      const srcMatch = pathname.match(/^\/sources\/([^/?]+)$/);
      if (srcMatch && method === 'GET') {
        if (!authenticatedAddress) {
          return jsonResponse({ success: false, error: 'Authorization header required.' }, 401);
        }

        const id = srcMatch[1];
        const msgKey = `msg:${authenticatedAddress}:${id}`;
        const rawMsg = await env.MAIL_KV.get(msgKey);
        if (!rawMsg) return jsonResponse({ success: false, error: 'Source not found' }, 404);

        const parsed = JSON.parse(rawMsg);
        return jsonResponse({ success: true, source: { data: parsed.raw || '' } });
      }

      return jsonResponse({ success: false, error: `Endpoint ${method} /${pathname} not found` }, 404);

    } catch(err) {
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }
};
