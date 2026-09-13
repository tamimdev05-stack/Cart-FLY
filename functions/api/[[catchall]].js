// Cloudflare Pages Functions - Mailflux Edge API Handler
// Runs directly on Cloudflare Edge Runtime

const BASE_URL = 'https://api.mail.tm';

let cachedDomains = [];
let lastFetched = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0'
  };
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...getCorsHeaders()
    }
  });
}

async function callMailTm(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) MailTm-CloudflareEdge/2.0',
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

async function getDomains(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && cachedDomains.length > 0 && (now - lastFetched < CACHE_TTL)) {
    return cachedDomains;
  }

  try {
    const data = await callMailTm('/domains');
    const domainsList = Array.isArray(data) ? data : (data?.['hydra:member'] || []);

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
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    if (activeDomains.length > 0) {
      cachedDomains = activeDomains;
      lastFetched = now;
    }
    return cachedDomains.length > 0 ? cachedDomains : [{ id: 'fallback', domain: 'uberip.com', isActive: true, isPrivate: false }];
  } catch (err) {
    if (cachedDomains.length > 0) return cachedDomains;
    return [{ id: 'fallback', domain: 'uberip.com', isActive: true, isPrivate: false }];
  }
}

async function getBestDomain(preferredDomain = null) {
  const domains = await getDomains();
  if (preferredDomain) {
    const match = domains.find(d => d.domain.toLowerCase() === preferredDomain.toLowerCase() && d.isActive);
    if (match) return match.domain;
  }
  if (domains.length > 0 && domains[0].isActive) {
    return domains[0].domain;
  }
  return 'uberip.com';
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const method = request.method.toUpperCase();

  // Handle CORS Preflight
  if (method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: getCorsHeaders()
    });
  }

  // Normalize path (e.g. /api/domains or /domains)
  let subPath = url.pathname;
  if (subPath.startsWith('/api/')) {
    subPath = subPath.substring(4); // '/domains'
  } else if (subPath === '/api') {
    subPath = '/';
  }

  try {
    // Health check
    if (subPath === '/' || subPath === '/health') {
      return jsonResponse({ success: true, status: 'Mailflux Cloudflare Edge API active' });
    }

    // 1. Live Active Domains
    if (subPath === '/domains' && method === 'GET') {
      const forceFresh = url.searchParams.get('fresh') === 'true';
      const domains = await getDomains(forceFresh);
      return jsonResponse({
        success: true,
        domains: domains,
        activeDomain: domains.length > 0 ? domains[0].domain : null,
        lastUpdated: new Date(lastFetched).toISOString()
      });
    }

    // 2. Create Account
    if (subPath === '/create-account' && method === 'POST') {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
        return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
      }

      let { username, domain, password } = body;

      if (!username || typeof username !== 'string' || !username.trim()) {
        return jsonResponse({ success: false, error: 'Username is required. Random email creation is disabled.' }, 400);
      }

      if (!password || typeof password !== 'string' || !password.trim()) {
        return jsonResponse({ success: false, error: 'Password is required. Password ছাড়া একাউন্ট তৈরি করা যাবে না।' }, 400);
      }

      const cleanUsername = username.trim().toLowerCase().replace(/[^a-z0-9._-]/g, '');
      if (cleanUsername.length < 3) {
        return jsonResponse({ success: false, error: 'Username must be at least 3 characters long (letters, numbers, dot, dash, underscore).' }, 400);
      }

      if (password.length < 6) {
        return jsonResponse({ success: false, error: 'Password must be at least 6 characters long.' }, 400);
      }

      const targetDomain = await getBestDomain(domain);
      const address = `${cleanUsername}@${targetDomain}`.toLowerCase();

      // Create account on Mail.tm
      const account = await callMailTm('/accounts', {
        method: 'POST',
        body: JSON.stringify({ address, password: password.trim() })
      });

      // Get JWT token
      const tokenData = await callMailTm('/token', {
        method: 'POST',
        body: JSON.stringify({ address, password: password.trim() })
      });

      return jsonResponse({
        success: true,
        account: {
          id: account.id,
          address: account.address,
          password: password.trim(),
          token: tokenData.token,
          createdAt: account.createdAt
        }
      });
    }

    // 3. Login
    if (subPath === '/login' && method === 'POST') {
      let body = {};
      try {
        body = await request.json();
      } catch (e) {
        return jsonResponse({ success: false, error: 'Invalid JSON body' }, 400);
      }

      const { address, password } = body;
      if (!address || typeof address !== 'string' || !address.trim()) {
        return jsonResponse({ success: false, error: 'Email address is required.' }, 400);
      }

      if (!password || typeof password !== 'string' || !password.trim()) {
        return jsonResponse({ success: false, error: 'Password is required. Password ছাড়া লগইন করা যাবে না।' }, 400);
      }

      const cleanAddress = address.trim().toLowerCase();

      const tokenData = await callMailTm('/token', {
        method: 'POST',
        body: JSON.stringify({ address: cleanAddress, password: password.trim() })
      });

      const meData = await callMailTm('/me', {
        headers: { 'Authorization': `Bearer ${tokenData.token}` }
      });

      return jsonResponse({
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
    }

    // 4. Messages (List)
    if (subPath === '/messages' && method === 'GET') {
      const authHeader = request.headers.get('authorization');
      if (!authHeader) {
        return jsonResponse({ success: false, error: 'Authorization header required. Please login.' }, 401);
      }

      const page = url.searchParams.get('page') || 1;
      const data = await callMailTm(`/messages?page=${page}`, {
        headers: { 'Authorization': authHeader }
      });

      const msgList = Array.isArray(data) ? data : (data?.['hydra:member'] || []);
      return jsonResponse({
        success: true,
        messages: msgList,
        total: data?.['hydra:totalItems'] || msgList.length
      });
    }

    // 5. Message by ID (GET / PATCH / DELETE)
    const msgMatch = subPath.match(/^\/messages\/([^/?]+)$/);
    if (msgMatch) {
      const id = msgMatch[1];
      const authHeader = request.headers.get('authorization');
      if (!authHeader) {
        return jsonResponse({ success: false, error: 'Authorization header required.' }, 401);
      }

      if (method === 'GET') {
        const message = await callMailTm(`/messages/${id}`, {
          headers: { 'Authorization': authHeader }
        });
        return jsonResponse({ success: true, message });
      }

      if (method === 'PATCH') {
        const updated = await callMailTm(`/messages/${id}`, {
          method: 'PATCH',
          headers: {
            'Authorization': authHeader,
            'Content-Type': 'application/merge-patch+json'
          },
          body: JSON.stringify({ seen: true })
        });
        return jsonResponse({ success: true, message: updated });
      }

      if (method === 'DELETE') {
        await callMailTm(`/messages/${id}`, {
          method: 'DELETE',
          headers: { 'Authorization': authHeader }
        });
        return jsonResponse({ success: true, message: 'Message deleted successfully' });
      }
    }

    // 6. Source by ID
    const sourceMatch = subPath.match(/^\/sources\/([^/?]+)$/);
    if (sourceMatch && method === 'GET') {
      const id = sourceMatch[1];
      const authHeader = request.headers.get('authorization');
      if (!authHeader) {
        return jsonResponse({ success: false, error: 'Authorization header required.' }, 401);
      }

      const source = await callMailTm(`/sources/${id}`, {
        headers: { 'Authorization': authHeader }
      });
      return jsonResponse({ success: true, source });
    }

    return jsonResponse({ success: false, error: `Endpoint ${method} ${subPath} not found` }, 404);

  } catch (error) {
    let status = error.status || 500;
    let userMsg = error.message;
    if (status === 401 && subPath === '/login') {
      userMsg = 'Invalid email or password. Password সঠিক নয় অথবা একাউন্টটি পাওয়া যায়নি।';
    }
    return jsonResponse({
      success: false,
      error: userMsg,
      details: error.details
    }, status);
  }
}
