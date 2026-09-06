import { fetchText, postForm, headRequest, DEFAULT_UA } from '../utils/http.js';
import { makeLogger } from '../utils/logger.js';
import * as cache from '../utils/cache.js';

const log = makeLogger('sushi:http');
const BASE = 'https://sushianimes.com.br';
const COOKIE_NAME = 'sushi_age_verified';
const COOKIE_VALUE = '1';

// Cookie de idade aceito (algumas rotas exigem). Cloudflare geralmente passa com UA correto.
function withAgeCookie(headers = {}) {
  const cookie = headers['Cookie'] || headers['cookie'] || '';
  const has = cookie.split(';').some((c) => c.trim().startsWith(`${COOKIE_NAME}=`));
  if (has) return headers;
  const merged = cookie ? `${cookie}; ${COOKIE_NAME}=${COOKIE_VALUE}` : `${COOKIE_NAME}=${COOKIE_VALUE}`;
  return Object.assign({}, headers, { Cookie: merged });
}

async function get(path, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const headers = withAgeCookie(opts.headers || {});
  return await fetchText(url, Object.assign({}, opts, { headers }));
}

async function postAjax(path, form, opts = {}) {
  const url = path.startsWith('http') ? path : `${BASE}${path}`;
  const headers = withAgeCookie(opts.headers || {});
  return await postForm(url, form, Object.assign({}, opts, { headers }));
}

// Cache curto da home/search (1 min) para evitar bater no site.
async function getCached(path, ttlMs = 60_000) {
  const key = `sushi:html:${path}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const html = await get(path);
  cache.set(key, html, ttlMs);
  return html;
}

function buildCookieHeader(extra) {
  return withAgeCookie(extra || {});
}

export { BASE, DEFAULT_UA, get, postAjax, getCached, headRequest, buildCookieHeader, withAgeCookie };
export default { get, postAjax, getCached, headRequest, BASE, DEFAULT_UA, buildCookieHeader };
