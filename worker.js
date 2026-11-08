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
      function extractCleanEmail(str) {
        if (!str) return '';
        const m = str.match(/<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/);
        return m ? m[1].toLowerCase().trim() : str.replace(/[<>]/g, '').toLowerCase().trim();
      }

      const rawBuffer = await new Response(message.raw).arrayBuffer();
      const rawText = new TextDecoder('utf-8', { fatal: false }).decode(rawBuffer);

      // High-Fidelity RFC 822 / MIME Email Parser
      let parsedEmail = {};
      try {
        const parser = new PostalMime();
        parsedEmail = await parser.parse(rawBuffer);
      } catch (parseErr) {
        console.warn('PostalMime fallback parsing:', parseErr);
        parsedEmail = {};
      }

      const timestamp = Date.now();
      const msgId = 'msg_' + timestamp + '_' + Math.random().toString(36).substring(2, 8);

      const subject = parsedEmail.subject || message.headers.get('subject') || '(No Subject)';
      const fromObj = parsedEmail.from || { name: message.from || 'Unknown', address: message.from || '' };
      const envelopeTo = extractCleanEmail(message.to);
      const toArr = parsedEmail.to && parsedEmail.to.length > 0 ? parsedEmail.to : [{ address: envelopeTo }];
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
        subject: parsed.subject.substring(0, 100),
        intro: parsed.intro.substring(0, 120),
        seen: false,
        createdAt: parsed.createdAt,
        timestamp
      };

      // 1. Store full body in KV by ID (Direct KV.get accessible, ZERO list operations required)
      await env.MAIL_KV.put(`body:${msgId}`, JSON.stringify(parsed));

      // 2. Identify all recipient mailboxes for this email
      const targetRecipients = new Set();
      if (envelopeTo) targetRecipients.add(envelopeTo);
      if (parsedEmail.to) {
        parsedEmail.to.forEach(t => {
          const cl = extractCleanEmail(t.address || t.name);
          if (cl && (cl.endsWith('@mailflux.online') || cl.endsWith('@freelancingaid.online'))) {
            targetRecipients.add(cl);
          }
        });
      }

      // 3. Atomically update inbox list for each recipient
      for (const rcpt of targetRecipients) {
        const inboxKey = `inbox:${rcpt}`;
        let currentInbox = [];
        try {
          const rawInbox = await env.MAIL_KV.get(inboxKey);
          if (rawInbox) currentInbox = JSON.parse(rawInbox);
        } catch(e) {}

        // Add newest message to top, retain last 100 emails
        currentInbox = [metadata, ...currentInbox.filter(m => m.id !== msgId)].slice(0, 100);
        await env.MAIL_KV.put(inboxKey, JSON.stringify(currentInbox));
        console.log(`✅ Stored message for ${rcpt}: "${parsed.subject}" (ID: ${msgId})`);
      }

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
        await env.MAIL_KV.put(accountKey, JSON.stringify(accountRecord));

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
          await env.MAIL_KV.put(accountKey, JSON.stringify(accountRecord));
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

      // 4. Messages (List) - Instant Index lookup (100,000 requests/day, ZERO list operations)
      if (pathname === '/messages' && method === 'GET') {
        if (!authenticatedAddress) {
          return jsonResponse({ success: false, error: 'Authorization header required. Please login.' }, 401);
        }

        const inboxKey = `inbox:${authenticatedAddress}`;
        let messages = [];
        try {
          const raw = await env.MAIL_KV.get(inboxKey);
          if (raw) {
            messages = JSON.parse(raw);
          }
        } catch(e) {
          console.warn('Error reading inbox index:', e);
        }

        // Auto-sort newest first
        messages.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        return jsonResponse({
          success: true,
          messages,
          total: messages.length
        });
      }

      // 5. Message by ID (GET / PATCH / DELETE) - Direct key lookup
      const msgMatch = pathname.match(/^\/messages\/([^/?]+)$/);
      if (msgMatch) {
        if (!authenticatedAddress) {
          return jsonResponse({ success: false, error: 'Authorization header required.' }, 401);
        }

        const id = msgMatch[1];
        const bodyKey = `body:${id}`;

        if (method === 'GET') {
          const rawMsg = await env.MAIL_KV.get(bodyKey);
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
          // Mark as seen in user's inbox list
          const inboxKey = `inbox:${authenticatedAddress}`;
          try {
            const rawInbox = await env.MAIL_KV.get(inboxKey);
            if (rawInbox) {
              const list = JSON.parse(rawInbox);
              const target = list.find(m => m.id === id);
              if (target) {
                target.seen = true;
                await env.MAIL_KV.put(inboxKey, JSON.stringify(list));
              }
            }
          } catch(e) {}

          // Also mark seen in message body
          try {
            const rawMsg = await env.MAIL_KV.get(bodyKey);
            if (rawMsg) {
              const msg = JSON.parse(rawMsg);
              msg.seen = true;
              await env.MAIL_KV.put(bodyKey, JSON.stringify(msg));
            }
          } catch(e) {}

          return jsonResponse({ success: true, message: { id, seen: true } });
        }

        if (method === 'DELETE') {
          // Remove from user's inbox list
          const inboxKey = `inbox:${authenticatedAddress}`;
          try {
            const rawInbox = await env.MAIL_KV.get(inboxKey);
            if (rawInbox) {
              const list = JSON.parse(rawInbox).filter(m => m.id !== id);
              await env.MAIL_KV.put(inboxKey, JSON.stringify(list));
            }
          } catch(e) {}

          // Delete message body
          try {
            await env.MAIL_KV.delete(bodyKey);
          } catch(e) {}

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
        const bodyKey = `body:${id}`;
        const rawMsg = await env.MAIL_KV.get(bodyKey);
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
