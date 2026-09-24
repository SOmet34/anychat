// AnyChat proxy server — zero dependencies (plain Node http).
//
// Run:  node proxy.js            (defaults to port 3000)
//       PORT=8080 node proxy.js
//
// It forwards requests to the real AI provider server-side, which avoids the
// CORS blocks that stop browsers from calling OpenAI / Anthropic directly.
//
// The browser talks only to this server. Your API key is sent in the
// Authorization / x-api-key header straight through to the provider.
//
// Usage in the app: Settings → Proxy URL → http://your-host:3000

const http = require('http');

const PORT = process.env.PORT || 3000;

// Hop-by-hop / client-controlled headers we never forward.
const DROP = new Set([
  'host', 'content-length', 'connection', 'keep-alive',
  'proxy-authenticate', 'proxy-authorization', 'te', 'trailers',
  'transfer-encoding', 'upgrade', 'access-control-request-*',
]);

function forwardHeaders(inHeaders) {
  const out = {};
  for (const [k, v] of Object.entries(inHeaders)) {
    if (DROP.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Max-Age': '86400',
  };
}

const server = http.createServer((req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  // Only /proxy?url=<target> is accepted.
  const u = new URL(req.url, `http://${req.headers.host}`);
  if (u.pathname !== '/proxy') {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...corsHeaders() });
    return res.end('not found — use /proxy?url=<target>');
  }

  const target = u.searchParams.get('url');
  if (!target) {
    res.writeHead(400, { 'Content-Type': 'text/plain', ...corsHeaders() });
    return res.end('missing ?url= parameter');
  }

  // Basic sanity: only forward to http/https.
  if (!/^https?:\/\//i.test(target)) {
    res.writeHead(400, { 'Content-Type': 'text/plain', ...corsHeaders() });
    return res.end('url must be http:// or https://');
  }

  const upstream = http.request(
    target,
    { method: req.method, headers: forwardHeaders(req.headers) },
    (up) => {
      const status = up.status || 200;
      const out = { 'content-type': up.headers['content-type'] || 'application/json', ...corsHeaders() };
      res.writeHead(status, out);
      up.pipe(res);
    }
  );

  upstream.on('error', (err) => {
    res.writeHead(502, { 'Content-Type': 'text/plain', ...corsHeaders() });
    res.end('proxy error: ' + err.message);
  });

  req.pipe(upstream);
});

server.listen(PORT, () => {
  console.log(`AnyChat proxy running on http://localhost:${PORT}`);
  console.log('Set this URL in the app as the Proxy URL.');
});