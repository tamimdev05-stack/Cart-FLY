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

// Static assets
app.use(express.static(path.join(__dirname, 'public')));

// LIVE CLOUDFLARE WORKER BACKEND (Powered by freelancingaid.online & Cloudflare KV)
const CLOUDFLARE_BACKEND = 'https://mailflux-backend.freelancing-aid.workers.dev';

async function forwardToBackend(req, res) {
  try {
    let rawPath = req.originalUrl.replace(/^\/\.netlify\/functions\/api/, '/api');
    if (!rawPath.startsWith('/api')) {
      rawPath = '/api' + rawPath;
    }
    const targetUrl = `${CLOUDFLARE_BACKEND}${rawPath}`;
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (req.headers['authorization']) {
      headers['Authorization'] = req.headers['authorization'];
    }

    const options = {
      method: req.method,
      headers
    };

    if (req.method !== 'GET' && req.method !== 'HEAD' && req.body && Object.keys(req.body).length > 0) {
      options.body = JSON.stringify(req.body);
    }

    const response = await fetch(targetUrl, options);
    const data = await response.json().catch(() => ({}));
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}

// Proxy API routes (Express 5 compatible)
app.use('/api', forwardToBackend);
app.use('/.netlify/functions/api', forwardToBackend);

// Fallback to index.html for SPA client routing
app.use((req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/.netlify/functions')) {
    return next();
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log('================================================');
    console.log(`🚀 Mailflux Service running!`);
    console.log(`👉 Domain: freelancingaid.online`);
    console.log(`👉 Access in browser: http://localhost:${PORT}`);
    console.log(`☁️ Cloudflare Edge: ${CLOUDFLARE_BACKEND}`);
    console.log('================================================');
  });
}

module.exports = app;
