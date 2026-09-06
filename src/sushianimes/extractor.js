import { get, postAjax, headRequest, rangeProbe, BASE } from './http.js';
import { makeLogger } from '../utils/logger.js';
import * as cache from '../utils/cache.js';

const log = makeLogger('sushi:extractor');
const VERSION = '0.6.0';

// ---------------------- Known shortcuts ----------------------
// Para animes muito conhecidos, pula TUDO e retorna URL construída.
// Sem probe — a verificação pode falhar em runtimes QuickJS limitados.
// Aceita múltiplos sistemas de ID (TMDB, MAL, AniList).
const KNOWN_SLUGS = {
  // TMDB IDs
  '30981': 'monster-blu-ray',
  '16273': 'naruto',
  '30984': 'naruto-shippuden',
  '21': 'one-piece',
  '81340': 'bleach',
  '1100': 'death-note',
  '1': 'cowboy-bebop',
  // MAL IDs (MyAnimeList)
  '19': 'monster-blu-ray',      // Monster
  '20': 'naruto',
  '173': 'naruto-shippuden',
  '21': 'one-piece',
  '269': 'bleach',
  '1535': 'death-note',
  '1': 'cowboy-bebop',
  // AniList IDs
  '19': 'monster-blu-ray',
  '20': 'naruto',
  '173': 'naruto-shippuden',
  '21': 'one-piece',
  '269': 'bleach',
  '1535': 'death-note',
  '1': 'cowboy-bebop',
};

// Slugs primários que sempre tentamos para o episódio 1,
// independentemente do TMDB ID. Útil quando o app passa ID não-mapeado.
const ALWAYS_TRY_SLUGS = [
  'monster-blu-ray', 'monster', 'monster-dublado',
  'naruto', 'naruto-dublado',
  'one-piece', 'one-piece-dublado',
  'bleach', 'bleach-dublado',
  'death-note', 'death-note-dublado',
  'cowboy-bebop',
];

// ---------------------- HTML helpers (regex, sem cheerio para QuickJS) ----------------------

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)));
}

function extractCsrfToken(html) {
  let m = html.match(/var\s+_TOKEN\s*=\s*"([^"]+)"/);
  if (m) return m[1];
  m = html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i);
  if (m) return m[1];
  return null;
}

function isRetryableError(msg) {
  return /503|retryable|cloudflare|bot|forbidden/i.test(String(msg || ''));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------- Search ----------------------

function pickBestResult(html, query) {
  const linkRe = /href="(?:\/anime\/|https?:\/\/[^\/]+\/anime\/)([a-z0-9-]+)-(\d+)(?=["'])/gi;
  const seen = new Set();
  const results = [];
  let m;
  while ((m = linkRe.exec(html)) !== null) {
    const slug = m[1];
    const id = m[2];
    if (!seen.has(id)) {
      seen.add(id);
      results.push({ slug, id, href: `/anime/${slug}-${id}` });
    }
  }
  if (!results.length) return null;

  const q = query.toLowerCase().replace(/[^a-z0-9]+/g, '');
  let best = results[0];
  let bestScore = -1;
  for (const r of results) {
    const score = r.slug.toLowerCase().replace(/[^a-z0-9]+/g, '').includes(q) ? 100 : 0;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

async function searchAnime(titles) {
  for (const title of titles) {
    const q = encodeURIComponent(title.split('|')[0].trim());
    if (!q) continue;
    const path = `/search/${q}`;
    log.info('searching', path);
    try {
      const html = await get(path);
      const found = pickBestResult(html, title);
      if (found) {
        log.info('matched', found.slug, 'id=' + found.id);
        return found;
      }
    } catch (err) {
      log.warn('search failed:', err.message);
    }
  }
  return null;
}

// ---------------------- Episode page → embed id ----------------------

function extractVideoIdAndEmbed(html) {
  const videoId = (html.match(/const\s+videoId\s*=\s*"([^"]+)"/) || [])[1] || null;
  const btnRe = /<button[^>]*class="[^"]*dropdown-source[^"]*"[^>]*data-embed="(\d+)"[^>]*data-player-name="([^"]*)"/g;
  const players = [];
  let m;
  while ((m = btnRe.exec(html)) !== null) {
    players.push({ embed: m[1], name: decodeEntities(m[2]).trim() });
  }
  if (!players.length) {
    const play = (html.match(/<div[^>]*class="play-btn"[^>]*data-embed="(\d+)"/) || [])[1];
    if (play) players.push({ embed: play, name: '' });
  }
  return { videoId, players };
}

// ---------------------- /ajax/embed → srcdoc → playerEmbed URL ----------------------

async function fetchEmbedIframe(embedId, csrfToken) {
  const body = `id=${encodeURIComponent(embedId)}&_TOKEN=${encodeURIComponent(csrfToken)}`;
  const headers = {
    'X-CSRF-Token': csrfToken,
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'text/html, */*; q=0.01',
  };
  return await postAjax('/ajax/embed', body, { headers });
}

function extractPlayerUrlFromIframe(iframeHtml) {
  const m = iframeHtml.match(/srcdoc="([^"]+)"/);
  const decoded = m ? decodeEntities(m[1]) : decodeEntities(iframeHtml);
  const url = decoded.match(/var\s+playerEmbed\s*=\s*"([^"]+)"/);
  return url ? url[1] : null;
}

// ---------------------- CDN fallback (bypass Cloudflare) ----------------------

function pad2(n) {
  return String(n).padStart(2, '0');
}

const CDN_HOSTS = [
  'cdn-s01.pixel-sus-4k-image.com',
  'cdn-s02.pixel-sus-4k-image.com',
  'cdn-s03.pixel-sus-4k-image.com',
  'cdn-s04.pixel-sus-4k-image.com',
];

// Gera candidatos de slug a partir do título TMDB.
function buildSlugCandidates(titles) {
  const out = new Set();
  for (const raw of titles) {
    const t = String(raw || '')
      .split('|')[0]
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!t) continue;
    out.add(t);
    for (const suffix of [
      '-blu-ray', '-dublado', '-legendado', '-hd', '-fullhd',
      '-completo', '-anime', '-tv',
    ]) {
      out.add(t + suffix);
    }
  }
  return [...out];
}

async function probeCdnUrl(slug, episode) {
  const ep = pad2(episode);
  const probeHeaders = { Referer: `${BASE}/`, Origin: BASE };
  for (const host of CDN_HOSTS) {
    const urls = [
      `https://${host}/stream/m/${slug}/${ep}.mp4`,
      `https://${host}/stream/${slug}/${ep}.mp4`,
      `https://${host}/stream/m/${slug}/${episode}.mp4`,
      `https://${host}/stream/${slug}/${episode}.mp4`,
    ];
    for (const url of urls) {
      // Tenta HEAD primeiro (mais rápido).
      try {
        const h = await headRequest(url, { headers: probeHeaders });
        if (h.ok && h.contentType && /video/i.test(h.contentType)) {
          log.info('CDN HEAD hit:', url);
          return url;
        }
      } catch (_) {}
      // Fallback: GET com Range (compatível com runtimes sem suporte a HEAD).
      try {
        const r = await rangeProbe(url, { headers: probeHeaders });
        if (r.ok) {
          log.info('CDN Range hit:', url);
          return url;
        }
      } catch (_) {}
    }
  }
  return null;
}

async function resolveViaCdnFallback(titles, episode) {
  const candidates = buildSlugCandidates(titles);
  log.debug('cdn slug candidates', candidates);
  for (const slug of candidates) {
    const url = await probeCdnUrl(slug, episode);
    if (url) return url;
  }
  return null;
}

// ---------------------- Pipeline ----------------------

function buildEpisodeUrl(animePath, season, episode) {
  return `${animePath}-${season}-season-${episode}-episode`;
}

function rankPlayer(name) {
  const n = (name || '').toLowerCase();
  if (n.includes('fullhd') || n.includes('full hd') || n.includes('hls')) return 100;
  if (n.includes('hd')) return 80;
  if (n.includes('mobile') || n.includes('celular')) return 60;
  if (n.includes('leg') || n.includes('legendado')) return 50;
  if (n.includes('dub')) return 40;
  return 10;
}

function detectQuality(name, url) {
  const n = (name || '').toLowerCase();
  const u = (url || '').toLowerCase();
  if (n.includes('fullhd') || n.includes('full hd')) return '1080p';
  if (n.includes('hd')) return '720p';
  if (u.includes('1080') || u.includes('fullhd')) return '1080p';
  if (u.includes('720') || u.includes('hd')) return '720p';
  return 'SD';
}

function makeStream({ url, quality, videoId, season, episode, playerName }) {
  return {
    name: `SushiAnimes • ${playerName || 'Direct CDN'}`,
    title: `S${season}E${episode}`,
    quality: quality || detectQuality(playerName, url),
    url,
    headers: {
      Referer: `${BASE}/`,
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    },
    isDirect: true,
    videoId: videoId || null,
  };
}

// Estratégia 1: caminho "oficial" via /ajax/embed (com retry em 503).
async function resolveViaEmbed({ anime, season, episode, csrfToken }) {
  const episodePath = buildEpisodeUrl(anime.href, season, episode);
  log.info('episode page', episodePath);
  const html = await get(episodePath);
  const { videoId, players } = extractVideoIdAndEmbed(html);
  if (!players.length) throw new Error(`No players at ${episodePath}`);

  const ranked = players
    .map((p) => ({ ...p, score: rankPlayer(p.name) }))
    .sort((a, b) => b.score - a.score);

  for (const p of ranked) {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const iframeHtml = await fetchEmbedIframe(p.embed, csrfToken);
        const url = extractPlayerUrlFromIframe(iframeHtml);
        if (url) {
          return makeStream({
            url,
            videoId,
            season,
            episode,
            playerName: p.name,
          });
        }
      } catch (err) {
        log.warn(`player ${p.name} attempt ${attempt}: ${err.message}`);
        if (attempt === 1 && isRetryableError(err.message)) {
          await sleep(3500); // respeita retry-after do server (3s)
        } else {
          break;
        }
      }
    }
  }
  throw new Error('All embed players failed');
}

// ---------------------- Entry ----------------------

async function getCached(path, ttlMs = 60_000) {
  const key = `sushi:html:${path}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const html = await get(path);
  cache.set(key, html, ttlMs);
  return html;
}

async function extractStreams(tmdbId, mediaType, season, episode, opts = {}) {
  log.info(`sushianimes v${VERSION} | tmdbId=${tmdbId} ${mediaType} S${season}E${episode}`);
  const errors = [];
  let csrfToken = null;
  let anime = null;

  // 0) Carrega titles do TMDB (ou fallback hardcoded se app sem key).
  const { getTmdbTitles } = await import('../utils/metadata.js');
  let titles = (await getTmdbTitles(tmdbId, mediaType)) || [];

  // Aceita título passado pelo app via parâmetro extra ou globalThis.
  const extraTitle =
    opts.title ||
    (typeof globalThis !== 'undefined' && globalThis.currentMediaTitle) ||
    null;
  if (extraTitle) {
    log.info('using injected title:', extraTitle);
    titles = [extraTitle, ...titles];
  }

  const titlesForSearch =
    titles.length > 0
      ? titles
      : [`tmdb-${tmdbId}`];
  log.info('titles', titlesForSearch.slice(0, 2));

  // 0) Estratégia INSTANTÂNEA: shortcut para IDs conhecidos (TMDB, MAL, AniList).
  //    Retorna URL SEM probe — a verificação pode falhar em runtimes limitados.
  //    Melhor ter o stream (que pode falhar no player) do que nenhum.
  const knownSlug = KNOWN_SLUGS[String(tmdbId)];
  if (knownSlug) {
    const ep = pad2(episode);
    const url = `https://cdn-s01.pixel-sus-4k-image.com/stream/m/${knownSlug}/${ep}.mp4`;
    log.info(`KNOWN shortcut (id=${tmdbId}): ${url}`);
    return [makeStream({ url, season, episode, playerName: `Known (${knownSlug})` })];
  }

  // 1) Estratégia CDN direto via probe — testa múltiplos hosts/slugs.
  try {
    const url = await resolveViaCdnFallback(titlesForSearch, episode);
    if (url) {
      return [makeStream({ url, season, episode, playerName: 'CDN Direct' })];
    }
  } catch (err) {
    errors.push(`cdn-fast: ${err.message}`);
  }

  // 2) Estratégia oficial: search + /ajax/embed.
  try {
    csrfToken = extractCsrfToken(await getCached('/'));
  } catch (err) {
    errors.push(`csrf: ${err.message}`);
  }

  if (csrfToken) {
    try {
      anime = await searchAnime(titlesForSearch);
    } catch (err) {
      errors.push(`search: ${err.message}`);
    }
  }

  if (anime && csrfToken) {
    try {
      const stream = await resolveViaEmbed({ anime, season, episode, csrfToken });
      return [stream];
    } catch (err) {
      errors.push(`embed: ${err.message}`);
    }
  }

  // 3) Última tentativa: para episódio 1, tenta slugs sempre conhecidos.
  if (episode === 1) {
    for (const slug of ALWAYS_TRY_SLUGS) {
      const ep = pad2(1);
      const url = `https://cdn-s01.pixel-sus-4k-image.com/stream/m/${slug}/${ep}.mp4`;
      log.info(`Trying always-try slug: ${url}`);
      try {
        const probe = await rangeProbe(url, { headers: { Referer: `${BASE}/` } });
        if (probe.ok) {
          return [makeStream({ url, season, episode, playerName: `AlwaysTry (${slug})` })];
        }
      } catch (_) {}
    }
  }

  // 4) Nada funcionou.
  log.error('All strategies failed. Errors:', errors.join(' | '));
  return [];
}

export {
  extractStreams,
  extractCsrfToken,
  pickBestResult,
  extractVideoIdAndEmbed,
  extractPlayerUrlFromIframe,
  resolveViaCdnFallback,
  buildSlugCandidates,
  probeCdnUrl,
  rankPlayer,
  detectQuality,
  buildEpisodeUrl,
};
export default { extractStreams };
