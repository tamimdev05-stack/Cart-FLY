const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Global CORS Middleware
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

// Static assets (for local development or server deployment)
app.use(express.static(path.join(__dirname, 'public')));

const BASE_URL = 'https://api.mail.tm';

// Base helper for Mail.tm API calls
async function callMailTm(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MailTm-LocalService/2.0',
    ...(options.headers || {})
  };

  const response = await fetch(url, {
    ...options,
    headers
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (err) {
    data = text;
  }

  if (!response.ok) {
    const errorMsg = data?.message || data?.['hydra:description'] || `Mail.tm Error ${response.status}: ${response.statusText}`;
    const error = new Error(errorMsg);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

// -------------------------------------------------------------
// DYNAMIC DOMAIN MANAGER (Fixes domain rotation issue permanently)
// -------------------------------------------------------------
const DomainManager = {
  cachedDomains: [],
  lastFetched: 0,
  CACHE_TTL: 5 * 60 * 1000, // 5 minutes

  async getDomains(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.cachedDomains.length > 0 && (now - this.lastFetched < this.CACHE_TTL)) {
      return this.cachedDomains;
    }

    try {
      console.log('🔄 Fetching fresh active domains from mail.tm...');
      const data = await callMailTm('/domains');
      const domainsList = Array.isArray(data) ? data : (data?.['hydra:member'] || []);

      // Filter active and public domains
      const activeDomains = domainsList
        .filter(d => d.isActive && !d.isPrivate)
        .map(d => ({
          id: d.id,
          domain: d.domain,
          isActive: d.isActive,
          isPrivate: d.isPrivate,
          createdAt: d.createdAt,
          updatedAt: d.updatedAt
        }))
        // Sort newest domains first
        .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

      if (activeDomains.length > 0) {
        this.cachedDomains = activeDomains;
        this.lastFetched = now;
        console.log('✅ Active domains updated (' + activeDomains.length + ' available): ', activeDomains.map(d => d.domain));
      } else {
        console.warn('⚠️ No active domains returned from Mail.tm!');
      }

      return this.cachedDomains;
    } catch (err) {
      console.error('❌ Failed to fetch domains from Mail.tm:', err.message);
      if (this.cachedDomains.length > 0) {
        return this.cachedDomains;
      }
      // Emergency fallback if Mail.tm domain list fails
      return [{ id: 'fallback', domain: 'uberip.com', isActive: true, isPrivate: false }];
    }
  },

  async getBestDomain(preferredDomain = null) {
    const domains = await this.getDomains();
    if (preferredDomain) {
      const match = domains.find(d => d.domain.toLowerCase() === preferredDomain.toLowerCase() && d.isActive);
      if (match) return match.domain;
    }
    if (domains.length > 0 && domains[0].isActive) {
      return domains[0].domain;
    }
    return 'uberip.com';
  }
};

// -------------------------------------------------------------
// API ROUTER
// -------------------------------------------------------------
const apiRouter = express.Router();

// Health check endpoint
apiRouter.get('/health', (req, res) => {
  res.json({ success: true, status: 'Mailflux API operational' });
});

// 1. Get Live Active Domains
apiRouter.get('/domains', async (req, res) => {
  try {
    const forceFresh = req.query.fresh === 'true';
    const domains = await DomainManager.getDomains(forceFresh);
    res.json({
      success: true,
      domains: domains,
      activeDomain: domains.length > 0 ? domains[0].domain : null,
      lastUpdated: new Date(DomainManager.lastFetched).toISOString()
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// 2. Create Custom Account (STRICT: NO RANDOM ACCOUNTS, PASSWORD & USERNAME REQUIRED)
apiRouter.post('/create-account', async (req, res) => {
  try {
    let { username, domain, password } = req.body;

    // Strict validation: Random account creation is disallowed
    if (!username || typeof username !== 'string' || !username.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Username is required. Random email creation is disabled.'
      });
    }

    if (!password || typeof password !== 'string' || !password.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Password is required. Password ছাড়া একাউন্ট তৈরি করা যাবে না।'
      });
    }

    const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
    if (cleanUsername.length < 3) {
      return res.status(400).json({
        success: false,
        error: 'Username must be at least 3 characters long (letters, numbers, dot, dash, underscore).'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'Password must be at least 6 characters long.'
      });
    }

    // Ensure domain is active dynamically
    const targetDomain = await DomainManager.getBestDomain(domain);
    const address = `${cleanUsername}@${targetDomain}`.toLowerCase();

    // 1. Create account on Mail.tm
    const account = await callMailTm('/accounts', {
      method: 'POST',
      body: JSON.stringify({ address, password: password.trim() })
    });

    // 2. Get JWT token
    const tokenData = await callMailTm('/token', {
      method: 'POST',
      body: JSON.stringify({ address, password: password.trim() })
    });

    return res.json({
      success: true,
      account: {
        id: account.id,
        address: account.address,
        password: password.trim(),
        token: tokenData.token,
        createdAt: account.createdAt
      }
    });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      error: error.message,
      details: error.details
    });
  }
});

// 3. Login to Existing Account (STRICT: PASSWORD REQUIRED)
apiRouter.post('/login', async (req, res) => {
  try {
    const { address, password } = req.body;
    if (!address || typeof address !== 'string' || !address.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Email address is required.'
      });
    }

    if (!password || typeof password !== 'string' || !password.trim()) {
      return res.status(400).json({
        success: false,
        error: 'Password is required. Password ছাড়া লগইন করা যাবে না।'
      });
    }

    const cleanAddress = address.trim().toLowerCase();

    // 1. Authenticate and get JWT token
    const tokenData = await callMailTm('/token', {
      method: 'POST',
      body: JSON.stringify({ address: cleanAddress, password: password.trim() })
    });

    // 2. Fetch account metadata (/me)
    const meData = await callMailTm('/me', {
      headers: { 'Authorization': `Bearer ${tokenData.token}` }
    });

    res.json({
      success: true,
      account: {
        id: meData.id,
        address: meData.address,
        password: password.trim(),
        token: tokenData.token,
        createdAt: meData.createdAt,
        quota: meData.quota,
        used: meData.used
      }
    });
  } catch (error) {
    let userMsg = error.message;
    if (error.status === 401) {
      userMsg = 'Invalid email or password. Password সঠিক নয় অথবা একাউন্টটি পাওয়া যায়নি।';
    }
    res.status(error.status || 500).json({
      success: false,
      error: userMsg,
      status: error.status
    });
  }
});

// 4. Fetch Messages
apiRouter.get('/messages', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'Authorization header required. Please login.' });
    }

    const page = req.query.page || 1;
    const data = await callMailTm(`/messages?page=${page}`, {
      headers: { 'Authorization': authHeader }
    });

    const msgList = Array.isArray(data) ? data : (data?.['hydra:member'] || []);
    res.json({
      success: true,
      messages: msgList,
      total: data?.['hydra:totalItems'] || msgList.length
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

// 5. Get Single Message by ID
apiRouter.get('/messages/:id', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'Authorization header required. Please login.' });
    }

    const message = await callMailTm(`/messages/${req.params.id}`, {
      headers: { 'Authorization': authHeader }
    });

    res.json({
      success: true,
      message: message
    });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

// 6. Mark Message as Seen / Read
apiRouter.patch('/messages/:id', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'Authorization header required.' });
    }

    const updated = await callMailTm(`/messages/${req.params.id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': authHeader,
        'Content-Type': 'application/merge-patch+json'
      },
      body: JSON.stringify({ seen: true })
    });

    res.json({ success: true, message: updated });
  } catch (error) {
    res.json({ success: false, error: error.message });
  }
});

// 7. Delete Message by ID
apiRouter.delete('/messages/:id', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'Authorization header required. Please login.' });
    }

    await callMailTm(`/messages/${req.params.id}`, {
      method: 'DELETE',
      headers: { 'Authorization': authHeader }
    });

    res.json({ success: true, message: 'Message deleted successfully' });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

// 8. Get Message Source (Raw headers and body)
apiRouter.get('/sources/:id', async (req, res) => {
  try {
    const authHeader = req.headers['authorization'];
    if (!authHeader) {
      return res.status(401).json({ success: false, error: 'Authorization header required' });
    }

    const source = await callMailTm(`/sources/${req.params.id}`, {
      headers: { 'Authorization': authHeader }
    });

    res.json({ success: true, source: source });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, error: error.message });
  }
});

// Mount router on multiple prefixes for seamless local, Netlify, and Cloudflare compatibility
app.use('/api', apiRouter);
app.use('/.netlify/functions/api', apiRouter);

// Fallback to index.html for SPA client routing if needed
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/.netlify/functions')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Server & Initialize Dynamic Domain Cache when run directly
if (require.main === module) {
  app.listen(PORT, async () => {
    console.log('================================================');
    console.log(`🚀 Mailflux Service running!`);
    console.log(`👉 Access in browser: http://localhost:${PORT}`);
    console.log('🔒 Security: Random emails disabled, Password required, No auto-creation');
    console.log('================================================');
    try {
      await DomainManager.getDomains(true);
      console.log('✅ Initial domain sync completed.');
    } catch (err) {
      console.error('Initial domain fetch error:', err.message);
    }
  });
}

module.exports = app;
module.exports.DomainManager = DomainManager;
