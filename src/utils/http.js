import { makeLogger } from './logger.js';

const log = makeLogger('http');

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

function defaultHeaders(extra) {
  return Object.assign(
    {
      'User-Agent': DEFAULT_UA,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
    },
    extra || {}
  );
}

async function fetchText(url, opts = {}) {
  const headers = defaultHeaders(opts.headers);
  log.debug('GET', url);
  const res = await fetch(url, Object.assign({}, opts, { headers }));
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${url}`);
  }
  return text;
}

async function fetchJson(url, opts = {}) {
  const headers = defaultHeaders(Object.assign({ Accept: 'application/json' }, opts.headers || {}));
  log.debug('JSON', url);
  const res = await fetch(url, Object.assign({}, opts, { headers }));
  const json = await res.json();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${url}`);
  }
  return json;
}

async function postForm(url, form, opts = {}) {
  const body = new URLSearchParams(form).toString();
  const headers = defaultHeaders(
    Object.assign(
      {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      opts.headers || {}
    )
  );
  log.debug('POST', url, form);
  const res = await fetch(url, Object.assign({ method: 'POST', body }, opts, { headers }));
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on POST ${url}`);
  }
  return text;
}

async function headRequest(url, opts = {}) {
  log.debug('HEAD', url);
  try {
    const headers = defaultHeaders(opts.headers);
    const res = await fetch(url, Object.assign({ method: 'HEAD' }, opts, { headers }));
    return {
      ok: res.ok,
      status: res.status,
      contentType: res.headers.get('content-type') || '',
      contentLength: parseInt(res.headers.get('content-length') || '0', 10),
    };
  } catch (err) {
    return { ok: false, status: 0, error: err.message };
  }
}

export { fetchText, fetchJson, postForm, headRequest, defaultHeaders, DEFAULT_UA };
export default { fetchText, fetchJson, postForm, headRequest, defaultHeaders, DEFAULT_UA };
