// Cloudflare Worker for Mailflux
// Handles:
// 1. Inbound Email Processing via Cloudflare Email Routing
// 2. High-Performance Instant Synchronization via KV Key Metadata & Listing
// 3. Auto-expiring storage via Cloudflare Workers KV (Zero DB maintenance)

// Helper: Simple MIME parser for raw emails
function parseRawEmail(raw, message) {
  let subject = message.headers.get('subject') || '';
  if (!subject) {
    const subjMatch = raw.match(/\r?\nSubject:\s*([^\r\n]+)/i);
    subject = subjMatch ? subjMatch[1].trim() : '(No Subject)';
  }

  let from = message.from || message.headers.get('from') || '';
  if (!from) {
    const fromMatch = raw.match(/\r?\nFrom:\s*([^\r\n]+)/i);
    from = fromMatch ? fromMatch[1].trim() : 'Unknown';
  }

  const to = message.to || message.headers.get('to') || '';
  const date = message.headers.get('date') || new Date().toISOString();

  let textBody = '';
  let htmlBody = '';

  // Look for Content-Type boundary
  const contentType = message.headers.get('content-type') || raw.match(/\r?\nContent-Type:\s*([^\r\n]+)/i)?.[1] || '';
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
    subject: subject || '(No Subject)',
    from: { address: from, name: from.split('<')[0].replace(/["']/g, '').trim() || from },
    to: [{ address: to }],
    createdAt: new Date().toISOString(),
    intro: intro || '',
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

      const timestamp = Date.now();
      const msgId = 'msg_' + timestamp + '_' + Math.random().toString(36).substring(2, 8);
      parsed.id = msgId;
      parsed.seen = false;

      // Metadata stored with key for instantaneous listing without secondary queries
      const metadata = {
        id: parsed.id,
        from: parsed.from,
        to: parsed.to,
        subject: parsed.subject,
        intro: parsed.intro,
        seen: false,
        createdAt: parsed.createdAt,
        timestamp
      };

      // Key format: msg:{recipient}:{timestamp}:{msgId}
      // Storing timestamp in key guarantees alphabetical list reverse sort
      const msgKey = `msg:${recipient}:${timestamp}:${msgId}`;
      await env.MAIL_KV.put(msgKey, JSON.stringify(parsed), {
        expirationTtl: 86400,
        metadata
      });

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

      // 2. Create Account
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

        const accountRecord = {
          id: address,
          address,
          passwordHash: passHash,
          createdAt: existing ? JSON.parse(existing).createdAt : new Date().toISOString()
        };
        await env.MAIL_KV.put(accountKey, JSON.stringify(accountRecord), { expirationTtl: 30 * 86400 });

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

      // 4. Messages (List) - Always uses authoritative KV list with instant metadata
      if (pathname === '/messages' && method === 'GET') {
        if (!authenticatedAddress) {
          return jsonResponse({ success: false, error: 'Authorization header required. Please login.' }, 401);
        }

        // List all message keys for this recipient
        const prefix = `msg:${authenticatedAddress}:`;
        const kvList = await env.MAIL_KV.list({ prefix, limit: 100 });

        const messages = [];
        for (const item of (kvList.keys || [])) {
          if (item.metadata && item.metadata.id) {
            messages.push(item.metadata);
          } else {
            // Fallback for older format keys without metadata
            const raw = await env.MAIL_KV.get(item.name);
            if (raw) {
              const p = JSON.parse(raw);
              messages.push({
                id: p.id,
                from: p.from,
                to: p.to,
                subject: p.subject,
                intro: p.intro,
                seen: p.seen,
                createdAt: p.createdAt
              });
            }
          }
        }

        // Sort newest first
        messages.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

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
        const prefix = `msg:${authenticatedAddress}:`;
        const kvList = await env.MAIL_KV.list({ prefix });
        const targetKeyObj = (kvList.keys || []).find(k => k.name.endsWith(':' + id) || (k.metadata && k.metadata.id === id));

        if (!targetKeyObj) {
          return jsonResponse({ success: false, error: 'Message not found or expired.' }, 404);
        }

        const msgKey = targetKeyObj.name;

        if (method === 'GET') {
          const rawMsg = await env.MAIL_KV.get(msgKey);
          if (!rawMsg) return jsonResponse({ success: false, error: 'Message content not found' }, 404);
          const message = JSON.parse(rawMsg);
          return jsonResponse({ success: true, message });
        }

        if (method === 'PATCH') {
          const rawMsg = await env.MAIL_KV.get(msgKey);
          if (rawMsg) {
            const message = JSON.parse(rawMsg);
            message.seen = true;
            const meta = targetKeyObj.metadata || {};
            meta.seen = true;
            await env.MAIL_KV.put(msgKey, JSON.stringify(message), { expirationTtl: 86400, metadata: meta });
          }
          return jsonResponse({ success: true, message: { id, seen: true } });
        }

        if (method === 'DELETE') {
          await env.MAIL_KV.delete(msgKey);
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
        const prefix = `msg:${authenticatedAddress}:`;
        const kvList = await env.MAIL_KV.list({ prefix });
        const targetKeyObj = (kvList.keys || []).find(k => k.name.endsWith(':' + id) || (k.metadata && k.metadata.id === id));
        if (!targetKeyObj) return jsonResponse({ success: false, error: 'Source not found' }, 404);

        const rawMsg = await env.MAIL_KV.get(targetKeyObj.name);
        if (!rawMsg) return jsonResponse({ success: false, error: 'Source data empty' }, 404);

        const parsed = JSON.parse(rawMsg);
        return jsonResponse({ success: true, source: { data: parsed.raw || '' } });
      }

      return jsonResponse({ success: false, error: `Endpoint ${method} /${pathname} not found` }, 404);

    } catch(err) {
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }
};
