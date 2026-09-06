// Akuma Streams Proxy — Cloudflare Worker
// Adiciona Referer + Origin nas requisições ao CDN protegido,
// permitindo players nativos (sem header support) tocarem o MP4.

const ALLOWED_HOSTS = new Set([
  'cdn-s01.pixel-sus-4k-image.com',
  'cdn-s02.pixel-sus-4k-image.com',
  'cdn-s03.pixel-sus-4k-image.com',
  'cdn-s04.pixel-sus-4k-image.com',
]);

const SUSHI_REFERER = 'https://sushianimes.com.br/';
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url = new URL(request.url);
    const targetParam = url.searchParams.get('u');

    // Diagnóstico: GET / (sem ?u)
    if (!targetParam) {
      return jsonResponse({
        service: 'akuma-streams-proxy',
        usage: '/?u=<encoded-mp4-url>',
        allowedHosts: [...ALLOWED_HOSTS],
        note: 'GET /?u=<url> to proxy',
      });
    }

    // Decodifica se vier encodado
    let targetUrl;
    try {
      targetUrl = decodeURIComponent(targetParam);
    } catch (e) {
      targetUrl = targetParam;
    }

    // Valida URL
    let target;
    try {
      target = new URL(targetUrl);
    } catch (e) {
      return jsonResponse({ error: 'Invalid URL', input: targetUrl }, 400);
    }

    if (!ALLOWED_HOSTS.has(target.hostname)) {
      return jsonResponse(
        { error: 'Domain not allowed', host: target.hostname, allowed: [...ALLOWED_HOSTS] },
        403
      );
    }

    // Constrói headers para o CDN
    const upstreamHeaders = {
      Referer: SUSHI_REFERER,
      Origin: 'https://sushianimes.com.br',
      'User-Agent': UA,
    };

    // Repassa Range (seek)
    const range = request.headers.get('Range');
    if (range) upstreamHeaders.Range = range;

    // Repassa condicionais (cache)
    const ifMod = request.headers.get('If-Modified-Since');
    if (ifMod) upstreamHeaders['If-Modified-Since'] = ifMod;
    const ifNone = request.headers.get('If-None-Match');
    if (ifNone) upstreamHeaders['If-None-Match'] = ifNone;

    // Fetch upstream
    let upstream;
    try {
      upstream = await fetch(targetUrl, { headers: upstreamHeaders });
    } catch (err) {
      return jsonResponse({ error: 'Upstream fetch failed', message: err.message }, 502);
    }

    // Constrói resposta para o player
    const responseHeaders = new Headers();
    responseHeaders.set('Access-Control-Allow-Origin', '*');
    responseHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
    responseHeaders.set('Access-Control-Allow-Headers', '*');

    const ct = upstream.headers.get('Content-Type');
    if (ct) responseHeaders.set('Content-Type', ct);

    const cl = upstream.headers.get('Content-Length');
    if (cl) responseHeaders.set('Content-Length', cl);

    const ar = upstream.headers.get('Accept-Ranges');
    if (ar) responseHeaders.set('Accept-Ranges', ar);
    else responseHeaders.set('Accept-Ranges', 'bytes');

    const cr = upstream.headers.get('Content-Range');
    if (cr) responseHeaders.set('Content-Range', cr);

    const etag = upstream.headers.get('ETag');
    if (etag) responseHeaders.set('ETag', etag);

    const lm = upstream.headers.get('Last-Modified');
    if (lm) responseHeaders.set('Last-Modified', lm);

    // Cache CDN-friendly
    responseHeaders.set('Cache-Control', 'public, max-age=86400');

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  },
};
