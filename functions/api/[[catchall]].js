// Cloudflare Pages Functions - Mailflux Edge API Gateway
// Routes all requests directly to the live Cloudflare Worker with KV storage

const CLOUDFLARE_BACKEND = 'https://mailflux-backend.freelancing-aid.workers.dev';

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // Handle CORS preflight
  if (request.method.toUpperCase() === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0'
      }
    });
  }

  // Construct target URL
  const targetUrl = `${CLOUDFLARE_BACKEND}${url.pathname}${url.search}`;

  const headers = new Headers(request.headers);
  headers.set('Host', 'mailflux-backend.freelancing-aid.workers.dev');

  const forwardRequest = new Request(targetUrl, {
    method: request.method,
    headers,
    body: (request.method !== 'GET' && request.method !== 'HEAD') ? request.body : undefined,
    redirect: 'follow'
  });

  try {
    const response = await fetch(forwardRequest);
    const newHeaders = new Headers(response.headers);
    newHeaders.set('Access-Control-Allow-Origin', '*');
    newHeaders.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: newHeaders
    });
  } catch(err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
}
