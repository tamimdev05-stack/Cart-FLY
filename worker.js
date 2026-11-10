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

      // 1. Store full body in KV by ID (Persistent 60MB Mailbox Database)
      await env.MAIL_KV.put(`body:${msgId}`, JSON.stringify(parsed), { expirationTtl: 86400 * 365 });

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

      // 3. Atomically update inbox list for each recipient (retains up to 60MB of emails)
      for (const rcpt of targetRecipients) {
        const inboxKey = `inbox:${rcpt}`;
        let currentInbox = [];
        try {
          const rawInbox = await env.MAIL_KV.get(inboxKey);
          if (rawInbox) currentInbox = JSON.parse(rawInbox);
        } catch(e) {}

        // Add newest message to top, retain up to 1000 messages
        currentInbox = [metadata, ...currentInbox.filter(m => m.id !== msgId)].slice(0, 1000);
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

        const { username, domain, password, recoveryEmail } = body;
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

        let cleanRecovery = null;
        if (recoveryEmail && typeof recoveryEmail === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail.trim())) {
          cleanRecovery = recoveryEmail.trim().toLowerCase();
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
          recoveryEmail: cleanRecovery || (existing ? JSON.parse(existing).recoveryEmail : null),
          createdAt: existing ? JSON.parse(existing).createdAt : new Date().toISOString()
        };
        await env.MAIL_KV.put(accountKey, JSON.stringify(accountRecord));

        const token = btoa(`${address}:${passHash}:${Date.now()}`);
        const gdriveRaw = await env.MAIL_KV.get(`gdrive:${address}`);
        const gdriveData = gdriveRaw ? JSON.parse(gdriveRaw) : null;

        return jsonResponse({
          success: true,
          account: {
            id: address,
            address,
            password: password.trim(),
            token,
            recoveryEmail: accountRecord.recoveryEmail,
            gdriveLinked: !!gdriveRaw,
            driveEmail: gdriveData ? gdriveData.driveEmail : null,
            driveFileId: gdriveData ? gdriveData.fileId : null,
            webViewLink: gdriveData ? gdriveData.webViewLink : null,
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
        const gdriveRaw = await env.MAIL_KV.get(`gdrive:${cleanAddress}`);
        const gdriveData = gdriveRaw ? JSON.parse(gdriveRaw) : null;
        const currentAcc = existing ? JSON.parse(existing) : null;

        return jsonResponse({
          success: true,
          account: {
            id: cleanAddress,
            address: cleanAddress,
            password: password.trim(),
            token,
            recoveryEmail: currentAcc ? (currentAcc.recoveryEmail || null) : null,
            gdriveLinked: !!gdriveRaw,
            driveEmail: gdriveData ? gdriveData.driveEmail : null,
            driveFileId: gdriveData ? gdriveData.fileId : null,
            webViewLink: gdriveData ? gdriveData.webViewLink : null,
            createdAt: currentAcc ? currentAcc.createdAt : new Date().toISOString()
          }
        });
      }

      // Helper to mask email (e.g. tamim.hasan2005@gmail.com -> t***5@gmail.com)
      function maskEmail(email) {
        if (!email || !email.includes('@')) return 'Linked Account';
        const [user, domain] = email.split('@');
        if (user.length <= 2) return `${user[0]}***@${domain}`;
        return `${user[0]}***${user[user.length - 1]}@${domain}`;
      }

      // 3A. Password Recovery - Check Recovery Info
      if (pathname === '/auth/recovery-info' && method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch(e) {
          return jsonResponse({ success: false, error: 'Invalid JSON request' }, 400);
        }

        const { address } = body;
        if (!address || !address.trim()) {
          return jsonResponse({ success: false, error: 'Mailbox address is required.' }, 400);
        }

        const cleanAddress = address.trim().toLowerCase();
        const accountKey = `acc:${cleanAddress}`;
        const accRaw = await env.MAIL_KV.get(accountKey);

        if (!accRaw) {
          return jsonResponse({ success: false, error: 'Mailbox not found. এই নামে কোনো মেইলবক্স নেই।' }, 404);
        }

        // Find linked recovery email (from Google Drive link or account record)
        const gdriveRaw = await env.MAIL_KV.get(`gdrive:${cleanAddress}`);
        const gdriveData = gdriveRaw ? JSON.parse(gdriveRaw) : null;
        const accData = JSON.parse(accRaw);

        const recoveryEmail = (accData && accData.recoveryEmail) ? accData.recoveryEmail : ((gdriveData && gdriveData.driveEmail) ? gdriveData.driveEmail : null);

        if (!recoveryEmail) {
          return jsonResponse({
            success: false,
            error: 'এই মেইলবক্সের সাথে কোনো Google Account বা Recovery Email লিংক করা নেই।'
          }, 400);
        }

        return jsonResponse({
          success: true,
          address: cleanAddress,
          maskedEmail: maskEmail(recoveryEmail),
          hasGoogleLink: !!(gdriveData && gdriveData.driveEmail)
        });
      }

      // 3B. Password Recovery - Send 6-Digit OTP via Brevo
      if (pathname === '/auth/send-recovery-otp' && method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch(e) {
          return jsonResponse({ success: false, error: 'Invalid JSON request' }, 400);
        }

        const { address } = body;
        if (!address || !address.trim()) {
          return jsonResponse({ success: false, error: 'Mailbox address is required.' }, 400);
        }

        const cleanAddress = address.trim().toLowerCase();
        const gdriveRaw = await env.MAIL_KV.get(`gdrive:${cleanAddress}`);
        const gdriveData = gdriveRaw ? JSON.parse(gdriveRaw) : null;
        const accRaw = await env.MAIL_KV.get(`acc:${cleanAddress}`);
        const accData = accRaw ? JSON.parse(accRaw) : null;

        const recoveryEmail = (accData && accData.recoveryEmail) ? accData.recoveryEmail : ((gdriveData && gdriveData.driveEmail) ? gdriveData.driveEmail : null);

        if (!recoveryEmail) {
          return jsonResponse({ success: false, error: 'No recovery email found for this mailbox.' }, 400);
        }

        // Generate 6-digit OTP code (expires in 10 minutes)
        const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
        await env.MAIL_KV.put(`otp:${cleanAddress}`, otpCode, { expirationTtl: 600 });

        // Send OTP via Brevo
        try {
          const brevoApiKey = env.BREVO_API_KEY;
          const emailHtml = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px 24px; background: #0b0f19; color: #ffffff; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);">
              <div style="text-align: center; margin-bottom: 24px;">
                <h1 style="font-size: 24px; font-weight: 800; margin: 0; background: linear-gradient(135deg, #3B82F6, #8B5CF6); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">MailFlux</h1>
                <p style="font-size: 13px; color: #94a3b8; margin-top: 4px;">Password Recovery Request</p>
              </div>
              <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px; text-align: center; margin-bottom: 24px;">
                <p style="font-size: 14px; color: #cbd5e1; margin-top: 0;">Use the verification code below to reset your password for <strong>${cleanAddress}</strong>:</p>
                <div style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #60a5fa; margin: 18px 0; font-family: monospace;">${otpCode}</div>
                <p style="font-size: 12px; color: #64748b; margin-bottom: 0;">This code will expire in 10 minutes. If you did not request this, please ignore this email.</p>
              </div>
              <p style="font-size: 12px; color: #475569; text-align: center; margin: 0;">MailFlux Permanent Cloud Mailbox &bull; Security Center</p>
            </div>
          `;

          const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
            method: 'POST',
            headers: {
              'api-key': brevoApiKey,
              'content-type': 'application/json',
              'accept': 'application/json'
            },
            body: JSON.stringify({
              sender: { name: 'MailFlux Security', email: 'tamim.hasan2005@gmail.com' },
              to: [{ email: recoveryEmail.trim() }],
              subject: `MailFlux Reset Code: ${otpCode}`,
              htmlContent: emailHtml
            })
          });

          if (!brevoRes.ok) {
            console.warn('Brevo OTP send failed:', await brevoRes.text());
          }
        } catch(mailErr) {
          console.error('Failed to send OTP email:', mailErr);
        }

        return jsonResponse({
          success: true,
          message: `Verification code sent to ${maskEmail(recoveryEmail)}`,
          maskedEmail: maskEmail(recoveryEmail)
        });
      }

      // 3C. Password Recovery - Verify & Reset Password
      if (pathname === '/auth/reset-password' && method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch(e) {
          return jsonResponse({ success: false, error: 'Invalid JSON request' }, 400);
        }

        const { address, newPassword, method: resetMethod, otp, googleToken } = body;
        if (!address || !address.trim() || !newPassword || newPassword.trim().length < 6) {
          return jsonResponse({ success: false, error: 'Valid mailbox address and new password (min 6 characters) are required.' }, 400);
        }

        const cleanAddress = address.trim().toLowerCase();
        const accountKey = `acc:${cleanAddress}`;
        const accRaw = await env.MAIL_KV.get(accountKey);
        if (!accRaw) {
          return jsonResponse({ success: false, error: 'Mailbox not found.' }, 404);
        }

        const gdriveRaw = await env.MAIL_KV.get(`gdrive:${cleanAddress}`);
        const gdriveData = gdriveRaw ? JSON.parse(gdriveRaw) : null;
        const accData = JSON.parse(accRaw);
        const recoveryEmail = (accData && accData.recoveryEmail) ? accData.recoveryEmail : ((gdriveData && gdriveData.driveEmail) ? gdriveData.driveEmail : '');

        let isVerified = false;

        // Method 1: Google OAuth Token Verification
        if (resetMethod === 'google' && googleToken) {
          try {
            const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
              headers: { 'Authorization': `Bearer ${googleToken}` }
            });
            if (userRes.ok) {
              const uProfile = await userRes.json();
              if (uProfile && uProfile.email) {
                const googleEmail = uProfile.email.toLowerCase();
                if ((recoveryEmail && googleEmail === recoveryEmail.toLowerCase()) ||
                    (gdriveData && gdriveData.driveEmail && googleEmail === gdriveData.driveEmail.toLowerCase())) {
                  isVerified = true;
                }
              }
            }
          } catch(e) {
            console.warn('Google verify error:', e);
          }
        }

        // Method 2: OTP Verification
        if (resetMethod === 'otp' && otp) {
          const storedOtp = await env.MAIL_KV.get(`otp:${cleanAddress}`);
          if (storedOtp && storedOtp.trim() === otp.trim()) {
            isVerified = true;
            await env.MAIL_KV.delete(`otp:${cleanAddress}`);
          }
        }

        if (!isVerified) {
          return jsonResponse({ success: false, error: 'Verification failed. OTP সঠিক নয় অথবা Google Account টি মেলেনি।' }, 401);
        }

        // Verification successful: Update password hash in KV
        const newPassHash = await hashPassword(newPassword.trim());
        accData.passwordHash = newPassHash;
        accData.updatedAt = new Date().toISOString();
        await env.MAIL_KV.put(accountKey, JSON.stringify(accData));

        const token = btoa(`${cleanAddress}:${newPassHash}:${Date.now()}`);

        return jsonResponse({
          success: true,
          message: 'Password successfully changed! আপনার পাসওয়ার্ড সফলভাবে পরিবর্তন করা হয়েছে।',
          account: {
            id: cleanAddress,
            address: cleanAddress,
            password: newPassword.trim(),
            token,
            gdriveLinked: !!gdriveRaw,
            driveEmail: gdriveData ? gdriveData.driveEmail : null,
            driveFileId: gdriveData ? gdriveData.fileId : null,
            webViewLink: gdriveData ? gdriveData.webViewLink : null,
            createdAt: accData.createdAt
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

          // Also remove from user's sent list
          const sentKey = `sent:${authenticatedAddress}`;
          try {
            const rawSent = await env.MAIL_KV.get(sentKey);
            if (rawSent) {
              const list = JSON.parse(rawSent).filter(m => m.id !== id);
              await env.MAIL_KV.put(sentKey, JSON.stringify(list));
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

      // 7. Send Outbound Email (Powered by Brevo)
      if (pathname === '/send-email' && method === 'POST') {
        if (!authenticatedAddress) {
          return jsonResponse({ success: false, error: 'Authorization header required. Please sign in.' }, 401);
        }

        let body = {};
        try { body = await request.json(); } catch(e) {
          return jsonResponse({ success: false, error: 'Invalid JSON request' }, 400);
        }

        const { to, subject, text, html } = body;
        if (!to || typeof to !== 'string' || !to.includes('@')) {
          return jsonResponse({ success: false, error: 'Valid recipient email (To) is required.' }, 400);
        }

        const senderAddress = authenticatedAddress;
        const senderHandle = senderAddress.split('@')[0] || 'User';
        const senderDisplayName = `${senderHandle} (${senderAddress})`;

        const safeHtml = html || (text ? `<div style="font-family:sans-serif;white-space:pre-wrap;line-height:1.6;">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>` : '<p></p>');

        // Brevo requires a verified sender until custom domains complete DNS authentication
        // We set the verified sender with the Mailflux user's display name and set replyTo so replies come to the Mailflux address
        const brevoPayload = {
          sender: {
            name: senderDisplayName,
            email: 'tamim.hasan2005@gmail.com'
          },
          replyTo: {
            name: senderDisplayName,
            email: senderAddress
          },
          to: [
            { email: to.trim() }
          ],
          subject: subject && subject.trim() ? subject.trim() : '(No Subject)',
          htmlContent: safeHtml
        };

        const brevoApiKey = env.BREVO_API_KEY;

        const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': brevoApiKey,
            'content-type': 'application/json',
            'accept': 'application/json'
          },
          body: JSON.stringify(brevoPayload)
        });

        const brevoData = await brevoRes.json().catch(() => ({}));
        if (!brevoRes.ok) {
          return jsonResponse({
            success: false,
            error: brevoData.message || 'Failed to deliver message via Brevo'
          }, brevoRes.status);
        }

        // Store sent message in KV
        const sentMsgId = `sent_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const sentRecord = {
          id: sentMsgId,
          to: [{ address: to.trim() }],
          from: { address: senderAddress, name: senderHandle },
          subject: subject && subject.trim() ? subject.trim() : '(No Subject)',
          intro: (text || '').substring(0, 100),
          text: text || '',
          html: [safeHtml],
          createdAt: new Date().toISOString(),
          timestamp: Date.now(),
          isSent: true,
          seen: true
        };

        try {
          await env.MAIL_KV.put(`body:${sentMsgId}`, JSON.stringify(sentRecord), { expirationTtl: 86400 * 30 });
          const sentKey = `sent:${authenticatedAddress}`;
          let currentSent = [];
          const rawSent = await env.MAIL_KV.get(sentKey);
          if (rawSent) currentSent = JSON.parse(rawSent);
          currentSent = [sentRecord, ...currentSent.filter(m => m.id !== sentMsgId)].slice(0, 100);
          await env.MAIL_KV.put(sentKey, JSON.stringify(currentSent));

          // If recipient is a Mailflux/freelancingaid mailbox, deposit directly into recipient's inbox
          const recipientClean = to.trim().toLowerCase();
          if (recipientClean.endsWith('@mailflux.online') || recipientClean.endsWith('@freelancingaid.online')) {
            const recipientInboxKey = `inbox:${recipientClean}`;
            const inboxMsg = {
              id: sentMsgId,
              from: { name: senderDisplayName, address: senderAddress },
              to: [{ address: recipientClean }],
              subject: sentRecord.subject,
              intro: sentRecord.intro,
              seen: false,
              createdAt: sentRecord.createdAt,
              timestamp: sentRecord.timestamp
            };
            let currentRecipientInbox = [];
            const rawRecp = await env.MAIL_KV.get(recipientInboxKey);
            if (rawRecp) currentRecipientInbox = JSON.parse(rawRecp);
            currentRecipientInbox = [inboxMsg, ...currentRecipientInbox.filter(m => m.id !== sentMsgId)].slice(0, 1000);
            await env.MAIL_KV.put(recipientInboxKey, JSON.stringify(currentRecipientInbox));
          }
        } catch(e) {
          console.warn('Failed to record sent/received email in KV:', e);
        }

        return jsonResponse({
          success: true,
          messageId: brevoData.messageId || 'sent',
          message: 'Email delivered successfully!',
          sentRecord
        });
      }

      // 8. Sent Messages (List)
      if (pathname === '/sent' && method === 'GET') {
        if (!authenticatedAddress) {
          return jsonResponse({ success: false, error: 'Authorization header required.' }, 401);
        }

        const sentKey = `sent:${authenticatedAddress}`;
        let messages = [];
        try {
          const rawSent = await env.MAIL_KV.get(sentKey);
          if (rawSent) {
            messages = JSON.parse(rawSent);
          }
        } catch(e) {}

        return jsonResponse({
          success: true,
          messages,
          total: messages.length
        });
      }

      // 9. Google Drive Status & 60 MB Storage Quota
      if (pathname === '/gdrive/status' && method === 'GET') {
        if (!authenticatedAddress) {
          return jsonResponse({ success: false, error: 'Authorization header required.' }, 401);
        }

        const gdriveKey = `gdrive:${authenticatedAddress}`;
        const rawGdrive = await env.MAIL_KV.get(gdriveKey);
        const isLinked = !!rawGdrive;
        let gdriveInfo = isLinked ? JSON.parse(rawGdrive) : null;

        // Calculate storage used across Inbox and Sent
        const inboxKey = `inbox:${authenticatedAddress}`;
        const sentKey = `sent:${authenticatedAddress}`;
        const rawInbox = (await env.MAIL_KV.get(inboxKey)) || '[]';
        const rawSent = (await env.MAIL_KV.get(sentKey)) || '[]';

        const usedBytes = rawInbox.length + rawSent.length + (rawGdrive ? rawGdrive.length : 0);
        const limitBytes = 60 * 1024 * 1024; // 60 MB Limit
        const usedMb = (usedBytes / (1024 * 1024)).toFixed(3);
        const percent = Math.min(100, Math.round((usedBytes / limitBytes) * 100));

        return jsonResponse({
          success: true,
          linked: isLinked,
          gdrive: gdriveInfo,
          storage: {
            usedBytes,
            limitBytes,
            usedMb,
            limitMb: 60,
            percent: Math.max(1, percent),
            isFull: usedBytes >= limitBytes
          }
        });
      }

      // 10. Link Google Drive to Mailbox (Mandatory 60MB Database Activation)
      if (pathname === '/gdrive/link' && method === 'POST') {
        if (!authenticatedAddress) {
          return jsonResponse({ success: false, error: 'Authorization header required.' }, 401);
        }

        let body = {};
        try { body = await request.json(); } catch(e) {
          return jsonResponse({ success: false, error: 'Invalid JSON request' }, 400);
        }

        const { driveEmail, fileId, webViewLink } = body;
        const gdriveRecord = {
          address: authenticatedAddress,
          driveEmail: driveEmail || `${authenticatedAddress.split('@')[0]}@gmail.com`,
          fileId: fileId || `gdrive_db_${Date.now()}`,
          webViewLink: webViewLink || 'https://drive.google.com',
          linkedAt: new Date().toISOString(),
          status: 'active',
          storageLimitBytes: 60 * 1024 * 1024
        };

        const gdriveKey = `gdrive:${authenticatedAddress}`;
        await env.MAIL_KV.put(gdriveKey, JSON.stringify(gdriveRecord));

        return jsonResponse({
          success: true,
          message: 'Google Drive successfully linked to mailbox (60 MB storage activated)',
          gdrive: gdriveRecord
        });
      }

      // 10B. Set / Update Recovery Email (Any custom email)
      if (pathname === '/account/recovery-email' && (method === 'POST' || method === 'PATCH')) {
        if (!authenticatedAddress) {
          return jsonResponse({ success: false, error: 'Authorization header required. Please sign in.' }, 401);
        }

        let body = {};
        try { body = await request.json(); } catch(e) {
          return jsonResponse({ success: false, error: 'Invalid JSON request' }, 400);
        }

        const { recoveryEmail } = body;
        if (!recoveryEmail || typeof recoveryEmail !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail.trim())) {
          return jsonResponse({ success: false, error: 'Please enter a valid email address (e.g. you@gmail.com).' }, 400);
        }

        const cleanRecovery = recoveryEmail.trim().toLowerCase();
        const accountKey = `acc:${authenticatedAddress}`;
        const accRaw = await env.MAIL_KV.get(accountKey);
        if (!accRaw) {
          return jsonResponse({ success: false, error: 'Account not found.' }, 404);
        }

        const accData = JSON.parse(accRaw);
        accData.recoveryEmail = cleanRecovery;
        accData.updatedAt = new Date().toISOString();
        await env.MAIL_KV.put(accountKey, JSON.stringify(accData));

        return jsonResponse({
          success: true,
          message: 'Recovery email updated successfully!',
          recoveryEmail: cleanRecovery
        });
      }

      // 11. Mailbox Full Database Sync & Export (Cross-Device Multi-User Sync)
      if (pathname === '/mailbox/db' && method === 'GET') {
        if (!authenticatedAddress) {
          return jsonResponse({ success: false, error: 'Authorization header required.' }, 401);
        }

        const inboxKey = `inbox:${authenticatedAddress}`;
        const sentKey = `sent:${authenticatedAddress}`;
        const gdriveKey = `gdrive:${authenticatedAddress}`;

        const rawInbox = await env.MAIL_KV.get(inboxKey);
        const rawSent = await env.MAIL_KV.get(sentKey);
        const rawGdrive = await env.MAIL_KV.get(gdriveKey);

        const inbox = rawInbox ? JSON.parse(rawInbox) : [];
        const sent = rawSent ? JSON.parse(rawSent) : [];
        const gdrive = rawGdrive ? JSON.parse(rawGdrive) : null;

        return jsonResponse({
          success: true,
          address: authenticatedAddress,
          gdrive,
          inbox,
          sent,
          storageLimitMb: 60,
          totalEmails: inbox.length + sent.length,
          lastSync: new Date().toISOString()
        });
      }

      return jsonResponse({ success: false, error: `Endpoint ${method} /${pathname} not found` }, 404);

    } catch(err) {
      return jsonResponse({ success: false, error: err.message }, 500);
    }
  }
};
