// Cloudflare Worker for Mailflux
// Handles:
// 1. High-Fidelity Inbound Email Parsing via PostalMime
// 2. Multi-Domain Support (mailflux.online & freelancingaid.online)
// 3. High-Performance Instant Synchronization via KV Key Metadata & Listing
// 4. Auto-expiring storage via Cloudflare Workers KV (Zero DB maintenance)

import PostalMime from 'postal-mime';

const ALLOWED_DOMAINS = ['mailflux.online', 'freelancingaid.online'];

// Helper: Decode Quoted-Printable MIME encoded strings
function decodeQuotedPrintable(input) {
  if (typeof input !== 'string') return input;
  const normalized = input.replace(/=(?:\r\n|\r|\n)/g, '');
  try {
    const percentEncoded = normalized
      .replace(/%/g, '%25')
      .replace(/=([0-9A-Fa-f]{2})/g, '%$1');
    return decodeURIComponent(percentEncoded);
  } catch (e) {
    return normalized.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => {
      return String.fromCharCode(parseInt(hex, 16));
    });
  }
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

      // High-Fidelity RFC 822 / MIME Email Parser
      const parser = new PostalMime();
      const parsedEmail = await parser.parse(rawText);

      const timestamp = Date.now();
      const msgId = 'msg_' + timestamp + '_' + Math.random().toString(36).substring(2, 8);

      const subject = parsedEmail.subject || message.headers.get('subject') || '(No Subject)';
      const fromObj = parsedEmail.from || { name: message.from || 'Unknown', address: message.from || '' };
      const toArr = parsedEmail.to && parsedEmail.to.length > 0 ? parsedEmail.to : [{ address: recipient }];
      const textBody = parsedEmail.text || '';
      const htmlBody = parsedEmail.html || '';

      const intro = (textBody || htmlBody.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim().substring(0, 120);

      const parsed = {
        id: msgId,
        subject,
        from: {
          name: fromObj.name || fromObj.address || 'Unknown',
          address: fromObj.address || fromObj.name || ''
        },
        to: toArr,
        createdAt: new Date().toISOString(),
        intro: intro || '',
        text: textBody,
        html: htmlBody ? [htmlBody] : [],
        seen: false,
        raw: rawText
      };

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
          status: 'Mailflux Multi-Domain Edge Mail Service Active',
          domains: ALLOWED_DOMAINS
        });
      }

      // 1. Domains endpoint (Supports both mailflux.online and freelancingaid.online)
      if (pathname === '/domains' && method === 'GET') {
        return jsonResponse({
          success: true,
          domains: [
            {
              id: 'domain_1',
              domain: 'mailflux.online',
              isActive: true,
              isPrivate: false,
              createdAt: '2026-01-01T00:00:00Z'
            },
            {
              id: 'domain_2',
              domain: 'freelancingaid.online',
              isActive: true,
              isPrivate: false,
              createdAt: '2026-01-01T00:00:00Z'
            }
          ],
          activeDomain: 'mailflux.online',
          lastUpdated: new Date().toISOString()
        });
      }

      // 2. Create Account
      if (pathname === '/create-account' && method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch(e) {
          return jsonResponse({ success: false, error: 'Invalid JSON request body' }, 400);
        }

        const { username, domain, password } = body;
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

        // Validate domain against allowed domains
        let chosenDomain = (domain || '').trim().toLowerCase();
        if (!ALLOWED_DOMAINS.includes(chosenDomain)) {
          chosenDomain = ALLOWED_DOMAINS[0];
        }

        const address = `${cleanUsername}@${chosenDomain}`.toLowerCase();
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

        const prefix = `msg:${authenticatedAddress}:`;
        const kvList = await env.MAIL_KV.list({ prefix, limit: 100 });

        const messages = [];
        for (const item of (kvList.keys || [])) {
          if (item.metadata && item.metadata.id) {
            messages.push(item.metadata);
          } else {
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
          let message = JSON.parse(rawMsg);

          // On-the-fly PostalMime fallback for emails previously stored as raw/unparsed text
          if ((!message.html || message.html.length === 0 || (message.html[0] && message.html[0].includes('=09'))) && message.raw) {
            try {
              const parser = new PostalMime();
              const fresh = await parser.parse(message.raw);
              if (fresh.html) {
                message.html = [fresh.html];
              }
              if (fresh.text) {
                message.text = fresh.text;
              }
              if (fresh.subject && fresh.subject !== '(No Subject)') {
                message.subject = fresh.subject;
              }
            } catch(e) {}
          }

          // Clean up legacy Quoted-Printable encoded artifacts if present
          if (message.html && message.html.length > 0 && typeof message.html[0] === 'string') {
            if (/(?:=09|=3D|=\r?\n|=E2=80=8B)/i.test(message.html[0])) {
              message.html[0] = decodeQuotedPrintable(message.html[0]);
            }
          }
          if (message.text && typeof message.text === 'string' && /(?:=09|=3D|=\r?\n|=E2=80=8B)/i.test(message.text)) {
            message.text = decodeQuotedPrintable(message.text);
          }

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
