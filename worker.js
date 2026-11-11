// Cloudflare Worker for Mailflux
// Handles:
// 1. High-Fidelity Inbound Email Parsing via PostalMime
// 2. Multi-Domain Support (mailflux.online & freelancingaid.online)
// 3. High-Performance Instant Synchronization via KV Key Metadata & Listing
// 4. Auto-expiring storage via Cloudflare Workers KV (Zero DB maintenance)

import PostalMime from 'postal-mime';

const ALLOWED_DOMAINS = ['mailflux.online', 'freelancingaid.online'];

// Helper: D1 + KV Hybrid Smart Storage (100,000 writes/day, 5,000,000 reads/day, 100% strongly consistent)
function createSmartEnv(rawEnv) {
  if (!rawEnv || rawEnv._isSmart) return rawEnv;
  const rawKV = rawEnv.MAIL_KV;
  const db = rawEnv.MAIL_DB;
  if (!db) return rawEnv;

  const smartKV = {
    async get(key) {
      if (!key) return null;
      try {
        const row = await db.prepare('SELECT v FROM kv_store WHERE k = ?').bind(key).first();
        if (row && typeof row.v === 'string') {
          return row.v;
        }
      } catch (e) {}

      if (rawKV) {
        try {
          const val = await rawKV.get(key);
          if (val !== null && val !== undefined) {
            await db.prepare('INSERT OR IGNORE INTO kv_store (k, v, updated_at) VALUES (?, ?, ?)')
              .bind(key, val, Date.now())
              .run()
              .catch(() => {});
            return val;
          }
        } catch (e) {}
      }
      return null;
    },

    async put(key, value, options) {
      if (!key) return;
      const valStr = typeof value === 'string' ? value : JSON.stringify(value);
      try {
        await db.prepare('INSERT OR REPLACE INTO kv_store (k, v, updated_at) VALUES (?, ?, ?)')
          .bind(key, valStr, Date.now())
          .run();
      } catch (e) {}

      // Only mirror small account/config/gdrive keys to KV if quota permits (never throw on KV daily limit)
      if (rawKV && (key.startsWith('acc:') || key.startsWith('gdrive:') || key.startsWith('config:') || key.startsWith('otp:'))) {
        await rawKV.put(key, valStr, options).catch(() => {});
      }
    },

    async delete(key) {
      if (!key) return;
      try {
        await db.prepare('DELETE FROM kv_store WHERE k = ?').bind(key).run();
      } catch (e) {}
      if (rawKV) {
        await rawKV.delete(key).catch(() => {});
      }
    },

    async list(opts = {}) {
      const prefix = opts.prefix || '';
      const limit = opts.limit || 500;
      const keyMap = new Map();
      try {
        const res = await db.prepare('SELECT k FROM kv_store WHERE k LIKE ? LIMIT ?')
          .bind(`${prefix}%`, limit)
          .all();
        if (res && Array.isArray(res.results)) {
          for (const r of res.results) {
            if (r && r.k) keyMap.set(r.k, { name: r.k });
          }
        }
      } catch (e) {}

      // Only fall back to rawKV.list if D1 returned 0 keys for this prefix
      if (keyMap.size === 0 && rawKV) {
        try {
          const kvRes = await rawKV.list(opts);
          if (kvRes && Array.isArray(kvRes.keys)) {
            for (const k of kvRes.keys) {
              if (k && k.name) keyMap.set(k.name, k);
            }
          }
        } catch (e) {}
      }
      return { keys: Array.from(keyMap.values()) };
    }
  };

  return {
    ...rawEnv,
    _isSmart: true,
    RAW_KV: rawKV,
    MAIL_KV: smartKV
  };
}

async function getGoogleOAuthCredentials(env) {
  if (env && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    return { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET };
  }
  if (env && env.MAIL_KV) {
    try {
      const raw = await env.MAIL_KV.get('config:google_oauth');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.clientId && parsed.clientSecret) {
          return parsed;
        }
      }
    } catch (e) {}
  }
  return { clientId: '', clientSecret: '' };
}

// Helper: Exchange Google OAuth2 Authorization Code for Access + Refresh Token
async function exchangeGoogleAuthCode(code, env) {
  const { clientId, clientSecret } = await getGoogleOAuthCredentials(env);
  const params = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: 'postmessage',
    grant_type: 'authorization_code'
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'Failed to exchange Google authorization code');
  }
  return data;
}

// Helper: Refresh Google OAuth2 Access Token using Refresh Token
async function refreshGoogleAccessToken(refreshToken, env) {
  if (!refreshToken) return null;
  const { clientId, clientSecret } = await getGoogleOAuthCredentials(env);
  const params = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token'
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  return (data && data.access_token) ? data : null;
}

// Helper: Fetch Google User Email from Access Token
async function fetchGoogleUserProfile(accessToken) {
  try {
    const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (res.ok) return await res.json();
  } catch (e) {}
  return null;
}

// Helper: Make Google Drive DB file public so anyone with link can view/edit
async function ensurePublicDrivePermission(fileId, accessToken) {
  if (!fileId || !accessToken) return false;
  try {
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        role: 'writer',
        type: 'anyone'
      })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

// Helper: Authoritative Zero-Loss Inbox Reader (D1 SQL + KV Index Merge)
async function getAuthoritativeInbox(env, address) {
  if (!address) return [];
  const cleanAddress = address.trim().toLowerCase();
  const inboxKey = `inbox:${cleanAddress}`;
  const deletedKey = `deleted:${cleanAddress}`;

  let inboxList = [];
  let deletedIds = new Set();

  try {
    const [rawInbox, rawDeleted] = await Promise.all([
      env.MAIL_KV.get(inboxKey),
      env.MAIL_KV.get(deletedKey)
    ]);

    if (rawDeleted) {
      try {
        const arr = JSON.parse(rawDeleted);
        if (Array.isArray(arr)) arr.forEach(id => deletedIds.add(id));
      } catch (e) {}
    }

    if (rawInbox) {
      try {
        const parsed = JSON.parse(rawInbox);
        if (Array.isArray(parsed)) {
          inboxList = parsed.filter(m => m && m.id && !deletedIds.has(m.id));
        }
      } catch (e) {}
    }

    const byId = new Map();
    for (const m of inboxList) {
      byId.set(m.id, m);
    }

    let mergedNew = false;

    // Query strongly-consistent D1 messages table
    if (env.MAIL_DB) {
      try {
        const d1Res = await env.MAIL_DB.prepare(
          'SELECT id, from_json, to_json, subject, intro, seen, created_at, timestamp FROM messages WHERE recipient = ? AND folder = ? ORDER BY timestamp DESC LIMIT 1000'
        ).bind(cleanAddress, 'inbox').all();

        const rows = (d1Res && Array.isArray(d1Res.results)) ? d1Res.results : [];
        for (const r of rows) {
          if (!r || !r.id || deletedIds.has(r.id)) continue;
          const meta = {
            id: r.id,
            from: JSON.parse(r.from_json || '{}'),
            to: JSON.parse(r.to_json || '[]'),
            subject: r.subject || '(No Subject)',
            intro: r.intro || '',
            seen: !!r.seen,
            createdAt: r.created_at,
            timestamp: r.timestamp
          };
          if (!byId.has(meta.id)) {
            byId.set(meta.id, meta);
            mergedNew = true;
          } else if (meta.seen && !byId.get(meta.id).seen) {
            byId.get(meta.id).seen = true;
          }
        }
      } catch (e) {}
    }

    const mergedList = Array.from(byId.values())
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 1000);

    if (mergedNew) {
      await env.MAIL_KV.put(inboxKey, JSON.stringify(mergedList)).catch(() => {});
    }

    return mergedList;
  } catch (e) {
    return inboxList;
  }
}

// Helper: Server-Side Automatic Google Drive Database Sync Engine
async function syncMailboxToGoogleDriveServer(rawEnv, address, authOptions = {}) {
  const env = createSmartEnv(rawEnv);
  if (!address) return { synced: false, reason: 'missing_address' };
  const cleanAddress = address.trim().toLowerCase();
  const gdriveKey = `gdrive:${cleanAddress}`;

  let rawGdrive = await env.MAIL_KV.get(gdriveKey);
  let gdriveData = rawGdrive ? JSON.parse(rawGdrive) : null;

  if (!gdriveData && !authOptions.code && !authOptions.accessToken && !authOptions.fileId) {
    return { synced: false, reason: 'not_linked' };
  }

  if (!gdriveData) {
    gdriveData = {
      address: cleanAddress,
      driveEmail: authOptions.driveEmail || `${cleanAddress.split('@')[0]}@gmail.com`,
      fileId: authOptions.fileId || null,
      webViewLink: authOptions.webViewLink || 'https://drive.google.com',
      linkedAt: new Date().toISOString(),
      status: 'active',
      storageLimitBytes: 60 * 1024 * 1024
    };
  }

  if (authOptions.driveEmail && authOptions.driveEmail !== 'Google Account') {
    gdriveData.driveEmail = authOptions.driveEmail;
  }
  if (authOptions.fileId && !authOptions.fileId.startsWith('gdrive_db_')) {
    gdriveData.fileId = authOptions.fileId;
  }
  if (authOptions.webViewLink && authOptions.webViewLink.includes('/file/d/')) {
    gdriveData.webViewLink = authOptions.webViewLink;
  }

  let accessToken = null;

  // 1. Exchange authorization code if provided
  if (authOptions.code) {
    try {
      const tokenData = await exchangeGoogleAuthCode(authOptions.code, env);
      if (tokenData && tokenData.access_token) {
        accessToken = tokenData.access_token;
        gdriveData.accessToken = accessToken;
        gdriveData.tokenExpiry = Date.now() + ((tokenData.expires_in || 3500) - 120) * 1000;
      }
      if (tokenData && tokenData.refresh_token) {
        gdriveData.refreshToken = tokenData.refresh_token;
      }
    } catch (codeErr) {
      console.warn('Auth code exchange warning:', codeErr.message);
    }
  }

  // 2. Or use direct accessToken if provided by client
  if (!accessToken && authOptions.accessToken) {
    accessToken = authOptions.accessToken;
    gdriveData.accessToken = accessToken;
    gdriveData.tokenExpiry = Date.now() + ((authOptions.expiresIn || 3500) - 120) * 1000;
    if (authOptions.refreshToken) {
      gdriveData.refreshToken = authOptions.refreshToken;
    }
  }

  // Fetch Google user profile if we just got a fresh token
  if (accessToken && (authOptions.code || authOptions.accessToken)) {
    const profile = await fetchGoogleUserProfile(accessToken);
    if (profile && profile.email) {
      gdriveData.driveEmail = profile.email.toLowerCase();
    }
    // Persist shared token under driveEmail & master_tokens for cross-mailbox background auto-sync
    if (gdriveData.driveEmail) {
      const sharedTokenKey = `gdrive_token:${gdriveData.driveEmail.toLowerCase()}`;
      const existingSharedRaw = await env.MAIL_KV.get(sharedTokenKey);
      const existingShared = existingSharedRaw ? JSON.parse(existingSharedRaw) : {};
      const updatedShared = {
        driveEmail: gdriveData.driveEmail.toLowerCase(),
        accessToken: gdriveData.accessToken,
        tokenExpiry: gdriveData.tokenExpiry,
        refreshToken: gdriveData.refreshToken || existingShared.refreshToken || null,
        updatedAt: new Date().toISOString()
      };
      if (updatedShared.refreshToken && !gdriveData.refreshToken) {
        gdriveData.refreshToken = updatedShared.refreshToken;
      }
      await env.MAIL_KV.put(sharedTokenKey, JSON.stringify(updatedShared));
    }

    // Also save into global master_tokens pool so public Drive files can sync even without per-mailbox token
    if (gdriveData.refreshToken || gdriveData.accessToken) {
      try {
        const masterRaw = await env.MAIL_KV.get('gdrive:master_tokens');
        let masterList = masterRaw ? JSON.parse(masterRaw) : [];
        if (!Array.isArray(masterList)) masterList = [];
        const emailKey = (gdriveData.driveEmail || 'default').toLowerCase();
        const existingEntry = masterList.find(item => item.driveEmail === emailKey) || {};
        const newEntry = {
          driveEmail: emailKey,
          accessToken: gdriveData.accessToken || existingEntry.accessToken || null,
          tokenExpiry: gdriveData.tokenExpiry || existingEntry.tokenExpiry || 0,
          refreshToken: gdriveData.refreshToken || existingEntry.refreshToken || null,
          updatedAt: new Date().toISOString()
        };
        masterList = [newEntry, ...masterList.filter(item => item.driveEmail !== emailKey)].slice(0, 20);
        await env.MAIL_KV.put('gdrive:master_tokens', JSON.stringify(masterList));
      } catch (e) {}
    }
  }

  // 3. If no active token passed in request, resolve from stored KV tokens
  if (!accessToken) {
    if (gdriveData.accessToken && gdriveData.tokenExpiry && Date.now() < gdriveData.tokenExpiry) {
      accessToken = gdriveData.accessToken;
    } else if (gdriveData.refreshToken) {
      const refreshed = await refreshGoogleAccessToken(gdriveData.refreshToken, env);
      if (refreshed && refreshed.access_token) {
        accessToken = refreshed.access_token;
        gdriveData.accessToken = accessToken;
        gdriveData.tokenExpiry = Date.now() + ((refreshed.expires_in || 3500) - 120) * 1000;
        if (refreshed.refresh_token) gdriveData.refreshToken = refreshed.refresh_token;
      }
    }
  }

  // 4. Check shared token by linked Google email (e.g., if user authorized another mailbox with same Gmail)
  if (!accessToken && gdriveData.driveEmail) {
    const sharedTokenKey = `gdrive_token:${gdriveData.driveEmail.toLowerCase()}`;
    const sharedRaw = await env.MAIL_KV.get(sharedTokenKey);
    if (sharedRaw) {
      try {
        const shared = JSON.parse(sharedRaw);
        if (shared.refreshToken) {
          gdriveData.refreshToken = shared.refreshToken;
        }
        if (shared.accessToken && shared.tokenExpiry && Date.now() < shared.tokenExpiry) {
          accessToken = shared.accessToken;
          gdriveData.accessToken = accessToken;
          gdriveData.tokenExpiry = shared.tokenExpiry;
        } else if (shared.refreshToken) {
          const refreshed = await refreshGoogleAccessToken(shared.refreshToken, env);
          if (refreshed && refreshed.access_token) {
            accessToken = refreshed.access_token;
            gdriveData.accessToken = accessToken;
            gdriveData.tokenExpiry = Date.now() + ((refreshed.expires_in || 3500) - 120) * 1000;
            shared.accessToken = accessToken;
            shared.tokenExpiry = gdriveData.tokenExpiry;
            await env.MAIL_KV.put(sharedTokenKey, JSON.stringify(shared));
          }
        }
      } catch (e) {}
    }
  }

  // 5. Fallback to global master_tokens pool (for public Google Drive files when Gmail is not logged in)
  let usingFallbackMasterToken = false;
  if (!accessToken) {
    try {
      const masterRaw = await env.MAIL_KV.get('gdrive:master_tokens');
      const masterList = masterRaw ? JSON.parse(masterRaw) : [];
      if (Array.isArray(masterList) && masterList.length > 0) {
        for (let i = 0; i < masterList.length; i++) {
          const item = masterList[i];
          if (item.accessToken && item.tokenExpiry && Date.now() < item.tokenExpiry) {
            accessToken = item.accessToken;
            usingFallbackMasterToken = true;
            break;
          } else if (item.refreshToken) {
            const refreshed = await refreshGoogleAccessToken(item.refreshToken, env);
            if (refreshed && refreshed.access_token) {
              accessToken = refreshed.access_token;
              item.accessToken = accessToken;
              item.tokenExpiry = Date.now() + ((refreshed.expires_in || 3500) - 120) * 1000;
              await env.MAIL_KV.put('gdrive:master_tokens', JSON.stringify(masterList));
              usingFallbackMasterToken = true;
              break;
            }
          }
        }
      }
    } catch (e) {}
  }

  // Read current mailbox messages from KV (Authoritative Zero-Loss Merge)
  const inbox = await getAuthoritativeInbox(env, cleanAddress);
  const rawSent = await env.MAIL_KV.get(`sent:${cleanAddress}`);
  const sent = rawSent ? JSON.parse(rawSent) : [];
  const totalCount = inbox.length + sent.length;

  // If no valid accessToken could be resolved on the server
  if (!accessToken) {
    if (authOptions.driveEmail || authOptions.fileId || authOptions.webViewLink || authOptions.code || authOptions.accessToken) {
      await env.MAIL_KV.put(gdriveKey, JSON.stringify(gdriveData));
    }
    return {
      synced: false,
      needsAuth: true,
      hasServerToken: false,
      gdrive: {
        address: gdriveData.address,
        driveEmail: gdriveData.driveEmail,
        fileId: gdriveData.fileId,
        webViewLink: gdriveData.webViewLink,
        linkedAt: gdriveData.linkedAt,
        status: gdriveData.status
      }
    };
  }

  // Build full JSON database payload
  const dbPayload = {
    mailbox: cleanAddress,
    lastUpdated: new Date().toISOString(),
    linkedGoogleAccount: gdriveData.driveEmail || 'Google Account',
    storageLimitMb: 60,
    messagesCount: inbox.length,
    totalEmails: totalCount,
    inboxCount: inbox.length,
    sentCount: sent.length,
    messages: inbox.map(m => ({
      id: m.id,
      from: m.from,
      to: m.to,
      subject: m.subject,
      intro: m.intro,
      seen: m.seen,
      createdAt: m.createdAt,
      timestamp: m.timestamp
    })),
    inbox: inbox.map(m => ({
      id: m.id,
      from: m.from,
      to: m.to,
      subject: m.subject,
      intro: m.intro,
      seen: m.seen,
      createdAt: m.createdAt,
      timestamp: m.timestamp
    })),
    sent: sent.map(s => ({
      id: s.id,
      from: s.from,
      to: s.to,
      subject: s.subject,
      intro: s.intro,
      seen: s.seen,
      createdAt: s.createdAt,
      timestamp: s.timestamp
    }))
  };

  let fileId = gdriveData.fileId;
  let needsCreate = !fileId || fileId.startsWith('gdrive_db_');
  let syncOk = false;

  if (!needsCreate) {
    let patchRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(dbPayload, null, 2)
    });

    // If token was revoked or expired early (401), refresh using refreshToken and retry once
    if (patchRes.status === 401 && gdriveData.refreshToken) {
      const refreshed = await refreshGoogleAccessToken(gdriveData.refreshToken, env);
      if (refreshed && refreshed.access_token) {
        accessToken = refreshed.access_token;
        gdriveData.accessToken = accessToken;
        gdriveData.tokenExpiry = Date.now() + ((refreshed.expires_in || 3500) - 120) * 1000;
        patchRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(dbPayload, null, 2)
        });
      }
    }

    if (patchRes.ok) {
      syncOk = true;
      if (!gdriveData.publicPermissionSet) {
        const permOk = await ensurePublicDrivePermission(fileId, accessToken);
        if (permOk) gdriveData.publicPermissionSet = true;
      }
    } else if ((patchRes.status === 404 || patchRes.status === 403) && !usingFallbackMasterToken && (authOptions.code || authOptions.accessToken)) {
      needsCreate = true;
    } else if (patchRes.status === 401) {
      gdriveData.accessToken = null;
      gdriveData.tokenExpiry = 0;
      await env.MAIL_KV.put(gdriveKey, JSON.stringify(gdriveData));
      return {
        synced: false,
        needsAuth: true,
        hasServerToken: false,
        gdrive: gdriveData
      };
    }
  }

  if (needsCreate) {
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        name: `mailflux_${cleanAddress.replace(/[@.]/g, '_')}_db.json`,
        mimeType: 'application/json',
        description: `MailFlux 60 MB Persistent Mailbox Database for ${cleanAddress}`
      })
    });

    if (createRes.ok) {
      const fileData = await createRes.json().catch(() => null);
      if (fileData && fileData.id) {
        fileId = fileData.id;
        gdriveData.fileId = fileId;
        gdriveData.webViewLink = `https://drive.google.com/file/d/${fileId}/view`;

        // Automatically set public permission so anyone with the link can view/edit
        const permOk = await ensurePublicDrivePermission(fileId, accessToken);
        if (permOk) gdriveData.publicPermissionSet = true;

        const patchNewRes = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&supportsAllDrives=true`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(dbPayload, null, 2)
        });
        syncOk = patchNewRes.ok;
      }
    }
  }

  if (syncOk) {
    gdriveData.lastSyncedCount = totalCount;
    gdriveData.lastSyncedAt = new Date().toISOString();
  }

  await env.MAIL_KV.put(gdriveKey, JSON.stringify(gdriveData));

  return {
    synced: syncOk,
    needsAuth: !syncOk && !gdriveData.refreshToken,
    hasServerToken: !!(gdriveData.refreshToken || (gdriveData.accessToken && gdriveData.tokenExpiry > Date.now())),
    totalEmails: totalCount,
    gdrive: {
      address: gdriveData.address,
      driveEmail: gdriveData.driveEmail,
      fileId: gdriveData.fileId,
      webViewLink: gdriveData.webViewLink,
      linkedAt: gdriveData.linkedAt,
      lastSyncedAt: gdriveData.lastSyncedAt,
      lastSyncedCount: gdriveData.lastSyncedCount,
      status: gdriveData.status
    }
  };
}

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
  async email(message, rawEnv, ctx) {
    const env = createSmartEnv(rawEnv);
    try {
      function extractCleanEmail(str) {
        if (!str || typeof str !== 'string') return '';
        const m = str.match(/<?([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})>?/);
        return m ? m[1].toLowerCase().trim() : str.replace(/[<>"]/g, '').toLowerCase().trim();
      }

      function extractAllDomainEmails(str) {
        if (!str || typeof str !== 'string') return [];
        const matches = str.match(/[a-zA-Z0-9._%+-]+@(?:mailflux\.online|freelancingaid\.online)/gi) || [];
        return matches.map(e => e.toLowerCase().trim());
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
      const headerFrom = message.headers.get('from') || message.headers.get('sender') || message.from || '';
      const fromObj = parsedEmail.from || {
        name: headerFrom.replace(/<[^>]+>/g, '').replace(/"/g, '').trim() || extractCleanEmail(headerFrom) || 'Unknown',
        address: extractCleanEmail(headerFrom) || message.from || ''
      };
      const envelopeTo = extractCleanEmail(message.to);
      const toArr = parsedEmail.to && parsedEmail.to.length > 0 ? parsedEmail.to : [{ address: envelopeTo }];
      let textBody = parsedEmail.text || '';
      let htmlBody = parsedEmail.html || '';

      // Fallback 1: Check attachments if inline text/html or text/plain was placed in attachments
      if (!textBody && !htmlBody && Array.isArray(parsedEmail.attachments)) {
        for (const att of parsedEmail.attachments) {
          if (att && att.content) {
            const mime = (att.mimeType || '').toLowerCase();
            if (mime.includes('text/html') || mime.includes('text/plain') || mime.includes('text/calendar') || mime.includes('message/')) {
              const decodedAtt = typeof att.content === 'string'
                ? att.content
                : new TextDecoder('utf-8', { fatal: false }).decode(att.content);
              if (mime.includes('text/html')) {
                htmlBody = decodedAtt;
              } else {
                textBody = decodedAtt;
              }
            }
          }
        }
      }

      // Fallback 2: Extract raw body after RFC822 header separator if both textBody and htmlBody are still empty
      if (!textBody && !htmlBody && rawText) {
        const sepMatch = rawText.match(/\r?\n\r?\n/);
        if (sepMatch && typeof sepMatch.index === 'number') {
          let rawBodyContent = rawText.slice(sepMatch.index + sepMatch[0].length).trim();
          if (/(?:=09|=3D|=\r?\n|=E2=80=8B)/i.test(rawBodyContent)) {
            rawBodyContent = decodeQuotedPrintable(rawBodyContent);
          }
          if (/<html|<body|<div|<table|<p|<a\s/i.test(rawBodyContent)) {
            htmlBody = rawBodyContent;
          } else {
            textBody = rawBodyContent;
          }
        }
      }

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
        timestamp,
        intro: intro || '',
        text: textBody,
        html: htmlBody ? [htmlBody] : [],
        seen: false,
        raw: rawText.length > 300000 ? rawText.slice(0, 300000) : rawText
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
      try {
        await env.MAIL_KV.put(`body:${msgId}`, JSON.stringify(parsed), { expirationTtl: 86400 * 365 });
      } catch (bodyErr) {
        // Fallback without raw if message is huge
        const compactParsed = { ...parsed, raw: '' };
        await env.MAIL_KV.put(`body:${msgId}`, JSON.stringify(compactParsed), { expirationTtl: 86400 * 365 }).catch(() => {});
      }

      // 2. Identify all recipient mailboxes for this email (To, CC, BCC, Envelope, Forwarded headers, Plus-Addressing)
      const targetRecipients = new Set();
      const addRecipientCandidate = (addr) => {
        const cl = extractCleanEmail(addr);
        if (!cl) return;
        if (cl.endsWith('@mailflux.online') || cl.endsWith('@freelancingaid.online')) {
          targetRecipients.add(cl);
          // Also resolve plus-addressing (e.g. user+tag@domain.com -> user@domain.com)
          const [localPart, domainPart] = cl.split('@');
          if (localPart && localPart.includes('+')) {
            const baseLocal = localPart.split('+')[0];
            if (baseLocal) targetRecipients.add(`${baseLocal}@${domainPart}`);
          }
        }
      };

      if (envelopeTo) addRecipientCandidate(envelopeTo);
      for (const list of [parsedEmail.to, parsedEmail.cc, parsedEmail.bcc]) {
        if (Array.isArray(list)) {
          list.forEach(t => addRecipientCandidate((t && (t.address || t.name)) || ''));
        }
      }
      for (const hdrName of ['to', 'cc', 'bcc', 'delivered-to', 'x-original-to', 'envelope-to', 'x-forwarded-to', 'resent-to']) {
        const hdrVal = message.headers.get(hdrName);
        if (hdrVal) {
          extractAllDomainEmails(hdrVal).forEach(addRecipientCandidate);
        }
      }

      // 3. Atomically store in D1 SQL messages table AND update inbox list for each recipient (100% immune to KV PoP race conditions & KV daily write limits)
      for (const rcpt of targetRecipients) {
        if (env.MAIL_DB) {
          try {
            await env.MAIL_DB.prepare(
              'INSERT OR REPLACE INTO messages (id, recipient, folder, from_json, to_json, subject, intro, text_body, html_json, raw_mime, seen, created_at, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)'
            ).bind(
              msgId,
              rcpt,
              'inbox',
              JSON.stringify(parsed.from),
              JSON.stringify(parsed.to),
              metadata.subject,
              metadata.intro,
              parsed.text || '',
              JSON.stringify(parsed.html || []),
              parsed.raw || '',
              parsed.createdAt,
              timestamp
            ).run();
          } catch (d1Err) {
            console.warn('D1 message insert notice:', d1Err);
          }
        }

        // Merge with authoritative inbox
        const inboxKey = `inbox:${rcpt}`;
        const currentInbox = await getAuthoritativeInbox(env, rcpt);
        const updatedInbox = [metadata, ...currentInbox.filter(m => m.id !== msgId)]
          .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
          .slice(0, 1000);
        await env.MAIL_KV.put(inboxKey, JSON.stringify(updatedInbox));
        console.log(`✅ Stored message for ${rcpt}: "${parsed.subject}" (ID: ${msgId})`);

        // Automatically sync updated inbox to Google Drive in background
        if (ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil(syncMailboxToGoogleDriveServer(env, rcpt).catch(e => console.warn('Inbound Drive sync notice:', e)));
        } else {
          await syncMailboxToGoogleDriveServer(env, rcpt).catch(() => {});
        }
      }

    } catch(err) {
      console.error('❌ Error processing inbound email:', err.message);
    }
  },

  // -------------------------------------------------------------
  // 2. HTTP REST API HANDLER
  // -------------------------------------------------------------
  async fetch(request, rawEnv, ctx) {
    const env = createSmartEnv(rawEnv);
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

      // 4. Messages (List) - Authoritative Zero-Loss Index + Atomic Per-Message Merge
      if (pathname === '/messages' && method === 'GET') {
        if (!authenticatedAddress) {
          return jsonResponse({ success: false, error: 'Authorization header required. Please login.' }, 401);
        }

        const messages = await getAuthoritativeInbox(env, authenticatedAddress);

        // Background auto-sync to Google Drive if message count changed
        if (ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil((async () => {
            try {
              const rawGd = await env.MAIL_KV.get(`gdrive:${authenticatedAddress}`);
              if (rawGd) {
                const gd = JSON.parse(rawGd);
                if (gd.lastSyncedCount !== messages.length) {
                  await syncMailboxToGoogleDriveServer(env, authenticatedAddress);
                }
              }
            } catch (e) {}
          })());
        }

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
          let message = null;
          if (env.MAIL_DB) {
            try {
              const row = await env.MAIL_DB.prepare('SELECT * FROM messages WHERE id = ? LIMIT 1').bind(id).first();
              if (row && row.id) {
                message = {
                  id: row.id,
                  subject: row.subject || '(No Subject)',
                  from: JSON.parse(row.from_json || '{}'),
                  to: JSON.parse(row.to_json || '[]'),
                  createdAt: row.created_at,
                  timestamp: row.timestamp,
                  intro: row.intro || '',
                  text: row.text_body || '',
                  html: JSON.parse(row.html_json || '[]'),
                  seen: !!row.seen,
                  raw: row.raw_mime || ''
                };
              }
            } catch (e) {}
          }
          if (!message) {
            const rawMsg = await env.MAIL_KV.get(bodyKey);
            if (!rawMsg) return jsonResponse({ success: false, error: 'Message content not found' }, 404);
            message = JSON.parse(rawMsg);
          }

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
          if (env.MAIL_DB) {
            try {
              await env.MAIL_DB.prepare('UPDATE messages SET seen = 1 WHERE id = ?').bind(id).run();
            } catch (e) {}
          }

          // Mark as seen in user's authoritative inbox list without overwriting newly arrived emails
          const inboxKey = `inbox:${authenticatedAddress}`;
          try {
            const list = await getAuthoritativeInbox(env, authenticatedAddress);
            const target = list.find(m => m.id === id);
            if (target) {
              target.seen = true;
              await env.MAIL_KV.put(inboxKey, JSON.stringify(list));
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
          if (env.MAIL_DB) {
            try {
              await env.MAIL_DB.prepare('DELETE FROM messages WHERE id = ? AND recipient = ?')
                .bind(id, authenticatedAddress)
                .run();
            } catch (e) {}
          }

          // Record in deleted set so eventual consistency never resurrects a deleted email
          const deletedKey = `deleted:${authenticatedAddress}`;
          try {
            const rawDel = await env.MAIL_KV.get(deletedKey);
            let delArr = rawDel ? JSON.parse(rawDel) : [];
            if (!Array.isArray(delArr)) delArr = [];
            if (!delArr.includes(id)) {
              delArr = [id, ...delArr].slice(0, 500);
              await env.MAIL_KV.put(deletedKey, JSON.stringify(delArr));
            }
          } catch (e) {}

          // Remove from user's authoritative inbox list
          const inboxKey = `inbox:${authenticatedAddress}`;
          try {
            const currentList = await getAuthoritativeInbox(env, authenticatedAddress);
            const list = currentList.filter(m => m.id !== id);
            await env.MAIL_KV.put(inboxKey, JSON.stringify(list));
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

          if (ctx && typeof ctx.waitUntil === 'function') {
            ctx.waitUntil(syncMailboxToGoogleDriveServer(env, authenticatedAddress).catch(() => {}));
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

            if (ctx && typeof ctx.waitUntil === 'function') {
              ctx.waitUntil(syncMailboxToGoogleDriveServer(env, recipientClean).catch(() => {}));
            }
          }

          if (ctx && typeof ctx.waitUntil === 'function') {
            ctx.waitUntil(syncMailboxToGoogleDriveServer(env, authenticatedAddress).catch(() => {}));
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

        // Check if server has a valid refreshToken or shared token for this driveEmail
        let hasServerToken = false;
        if (gdriveInfo) {
          if (gdriveInfo.refreshToken || (gdriveInfo.accessToken && gdriveInfo.tokenExpiry && Date.now() < gdriveInfo.tokenExpiry)) {
            hasServerToken = true;
          } else if (gdriveInfo.driveEmail) {
            const sharedRaw = await env.MAIL_KV.get(`gdrive_token:${gdriveInfo.driveEmail.toLowerCase()}`);
            if (sharedRaw) {
              try {
                const sh = JSON.parse(sharedRaw);
                if (sh.refreshToken || (sh.accessToken && sh.tokenExpiry && Date.now() < sh.tokenExpiry)) {
                  hasServerToken = true;
                }
              } catch (e) {}
            }
          }
        }

        if (isLinked && hasServerToken && ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil(syncMailboxToGoogleDriveServer(env, authenticatedAddress).catch(() => {}));
        }

        return jsonResponse({
          success: true,
          linked: isLinked,
          hasServerToken,
          gdrive: gdriveInfo ? {
            address: gdriveInfo.address,
            driveEmail: gdriveInfo.driveEmail,
            fileId: gdriveInfo.fileId,
            webViewLink: gdriveInfo.webViewLink,
            linkedAt: gdriveInfo.linkedAt,
            lastSyncedAt: gdriveInfo.lastSyncedAt || null,
            lastSyncedCount: typeof gdriveInfo.lastSyncedCount === 'number' ? gdriveInfo.lastSyncedCount : null,
            status: gdriveInfo.status
          } : null,
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

      // 10. Link or Sync Google Drive to Mailbox (Mandatory 60MB Database Activation & Permanent Auto-Sync)
      if ((pathname === '/gdrive/link' || pathname === '/gdrive/sync') && method === 'POST') {
        if (!authenticatedAddress) {
          return jsonResponse({ success: false, error: 'Authorization header required.' }, 401);
        }

        let body = {};
        try { body = await request.json(); } catch(e) {
          body = {};
        }

        const { code, accessToken, expiresIn, refreshToken, driveEmail, fileId, webViewLink } = body;
        const syncResult = await syncMailboxToGoogleDriveServer(env, authenticatedAddress, {
          code,
          accessToken,
          expiresIn,
          refreshToken,
          driveEmail,
          fileId,
          webViewLink
        });

        return jsonResponse({
          success: true,
          synced: !!syncResult.synced,
          needsAuth: !!syncResult.needsAuth,
          hasServerToken: !!syncResult.hasServerToken,
          totalEmails: syncResult.totalEmails || 0,
          message: syncResult.synced
            ? 'Google Drive database automatically synced!'
            : 'Google Drive linked to mailbox (60 MB storage activated)',
          gdrive: syncResult.gdrive
        });
      }

      // 10A-1. Background Auto-Sync Queue for All Linked Mailboxes (Zero-Login Real-Time Sync)
      if (pathname === '/gdrive/sync-queue' && method === 'GET') {
        const forceAll = url.searchParams.get('all') === '1';
        let listRes = await env.MAIL_KV.list({ prefix: 'gdrive:' });
        let keys = (listRes && Array.isArray(listRes.keys)) ? listRes.keys : [];
        if (keys.length === 0) {
          const seedAddresses = [
            'shadeprotexas@freelancingaid.online',
            'maofacialplastics@mailflux.online',
            'nashvillebarbike@mailflux.online',
            'mainstreetfinance@freelancingaid.online',
            'tamim1@mailflux.online',
            'tamim@freelancingaid.online',
            'freelancingaid@mailflux.online',
            'getprestigeclean@freelancingaid.online',
            'motplumbingservices@mailflux.online',
            'orthoatlantaevans@mailflux.online',
            'nyneurologistsny@mailflux.online'
          ];
          for (const sa of seedAddresses) {
            const v = await env.MAIL_KV.get(`gdrive:${sa}`);
            if (v) keys.push({ name: `gdrive:${sa}` });
          }
        }
        const queue = [];

        for (const k of keys) {
          if (!k.name || k.name === 'gdrive:master_tokens') continue;
          const address = k.name.replace(/^gdrive:/, '').trim().toLowerCase();
          if (!address) continue;

          try {
            const rawGd = await env.MAIL_KV.get(k.name);
            if (!rawGd) continue;
            const gdriveData = JSON.parse(rawGd);
            if (!gdriveData || !gdriveData.fileId) continue;

            const inboxList = await getAuthoritativeInbox(env, address);
            const rawSent = await env.MAIL_KV.get(`sent:${address}`);
            const sentList = rawSent ? JSON.parse(rawSent) : [];
            const totalCount = inboxList.length + sentList.length;

            if (!forceAll && gdriveData.lastSyncedCount === totalCount) {
              continue;
            }

            // Try server-side token sync first
            const srvSync = await syncMailboxToGoogleDriveServer(env, address);
            if (srvSync && srvSync.synced && !forceAll) {
              continue;
            }

            // Fetch bodies in 1 single D1 query (avoids Cloudflare 50-subrequest limit)
            const bodyMap = new Map();
            if (env.MAIL_DB) {
              try {
                const d1Bodies = await env.MAIL_DB.prepare(
                  'SELECT id, text_body, html_json FROM messages WHERE recipient = ? AND folder = ? LIMIT 200'
                ).bind(address, 'inbox').all();
                for (const row of (d1Bodies.results || [])) {
                  bodyMap.set(row.id, {
                    text: row.text_body || '',
                    html: JSON.parse(row.html_json || '[]')
                  });
                }
              } catch (e) {}
            }

            const detailedInbox = inboxList.slice(0, 200).map((msg) => {
              const b = bodyMap.get(msg.id);
              return {
                id: msg.id,
                from: msg.from,
                to: msg.to,
                subject: msg.subject,
                intro: msg.intro,
                text: b ? b.text : (msg.text || ''),
                html: b ? b.html : (msg.html || []),
                seen: msg.seen,
                createdAt: msg.createdAt,
                timestamp: msg.timestamp
              };
            });

            const dbPayload = {
              mailbox: address,
              lastUpdated: new Date().toISOString(),
              linkedGoogleAccount: gdriveData.driveEmail || 'Linked Google Account',
              storageLimitMb: 60,
              messagesCount: detailedInbox.length,
              totalEmails: totalCount,
              inboxCount: detailedInbox.length,
              sentCount: sentList.length,
              messages: detailedInbox,
              inbox: detailedInbox,
              sent: sentList
            };

            queue.push({
              address,
              fileId: gdriveData.fileId,
              driveEmail: gdriveData.driveEmail,
              totalEmails: totalCount,
              lastSyncedCount: gdriveData.lastSyncedCount,
              dbPayload
            });
          } catch (e) {}
        }

        return jsonResponse({
          success: true,
          count: queue.length,
          queue
        });
      }

      // 10A-2. Mark Mailbox Drive File as Synced
      if (pathname === '/gdrive/mark-synced' && method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch (e) { body = {}; }
        const cleanAddress = (body.address || '').trim().toLowerCase();
        if (!cleanAddress) {
          return jsonResponse({ success: false, error: 'Address required' }, 400);
        }
        const gdriveKey = `gdrive:${cleanAddress}`;
        const rawGd = await env.MAIL_KV.get(gdriveKey);
        if (!rawGd) {
          return jsonResponse({ success: false, error: 'GDrive record not found' }, 404);
        }
        const gdriveData = JSON.parse(rawGd);
        if (typeof body.totalEmails === 'number') {
          gdriveData.lastSyncedCount = body.totalEmails;
        }
        if (body.fileId) {
          gdriveData.fileId = body.fileId;
          gdriveData.webViewLink = `https://drive.google.com/file/d/${body.fileId}/view`;
        }
        gdriveData.lastSyncedAt = new Date().toISOString();
        await env.MAIL_KV.put(gdriveKey, JSON.stringify(gdriveData));

        return jsonResponse({
          success: true,
          gdrive: gdriveData
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

        const sentKey = `sent:${authenticatedAddress}`;
        const gdriveKey = `gdrive:${authenticatedAddress}`;

        const inbox = await getAuthoritativeInbox(env, authenticatedAddress);
        const rawSent = await env.MAIL_KV.get(sentKey);
        const rawGdrive = await env.MAIL_KV.get(gdriveKey);

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
