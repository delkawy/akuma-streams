import { get, postAjax, BASE } from './http.js';
import { makeLogger } from '../utils/logger.js';
import * as cache from '../utils/cache.js';

const log = makeLogger('sushi:extractor');

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

function extractAttribute(html, attr, search) {
  // Busca `attr="value"` após um marcador search (ex: nome de tag ou classe).
  const re = new RegExp(`${attr}="([^"]*)"`, 'g');
  let m;
  while ((m = re.exec(html)) !== null) {
    if (!search || html.slice(Math.max(0, m.index - 200), m.index).includes(search)) {
      return decodeEntities(m[1]);
    }
  }
  return null;
}

function extractCsrfToken(html) {
  // 1) var _TOKEN = "...";
  let m = html.match(/var\s+_TOKEN\s*=\s*"([^"]+)"/);
  if (m) return m[1];
  // 2) <meta name="csrf-token" content="...">
  m = html.match(/<meta\s+name=["']csrf-token["']\s+content=["']([^"']+)["']/i);
  if (m) return m[1];
  return null;
}

// ---------------------- Anime search ----------------------

function pickBestResult(html, query) {
  // Aceita tanto /anime/<slug>-<id> quanto https://...anime/<slug>-<id>.
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
    const html = await get(path);
    const found = pickBestResult(html, title);
    if (found) {
      log.info('matched', found.slug, 'id=' + found.id);
      return found;
    }
  }
  return null;
}

// ---------------------- Episode page → embed id ----------------------

function extractVideoIdAndEmbed(html) {
  // videoId: const videoId = "ep-XXXX";
  const videoId = (html.match(/const\s+videoId\s*=\s*"([^"]+)"/) || [])[1] || null;

  // Botão selecionado é o melhor candidato; mas queremos TODOS para fallback.
  const btnRe = /<button[^>]*class="[^"]*dropdown-source[^"]*"[^>]*data-embed="(\d+)"[^>]*data-player-name="([^"]*)"/g;
  const players = [];
  let m;
  while ((m = btnRe.exec(html)) !== null) {
    players.push({ embed: m[1], name: decodeEntities(m[2]).trim() });
  }

  // fallback: play-btn
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
  const html = await postAjax('/ajax/embed', body, { headers });
  return html;
}

function extractPlayerUrlFromIframe(iframeHtml) {
  // iframe srcdoc="..."> → decoderEntities → regex playerEmbed="..."
  const srcdoc = extractAttribute(iframeHtml, 'srcdoc') || iframeHtml;
  const decoded = decodeEntities(srcdoc);
  const m = decoded.match(/var\s+playerEmbed\s*=\s*"([^"]+)"/);
  if (m) return m[1];
  return null;
}

// ---------------------- Pipeline ----------------------

function buildEpisodeUrl(animePath, season, episode) {
  // /anime/<slug>-<id>-<season>-season-<episode>-episode
  return `${animePath}-${season}-season-${episode}-episode`;
}

async function resolveEpisode({ anime, season, episode, csrfToken }) {
  const episodePath = buildEpisodeUrl(anime.href, season, episode);
  log.info('episode page', episodePath);
  const html = await get(episodePath);

  const { videoId, players } = extractVideoIdAndEmbed(html);
  if (!players.length) {
    throw new Error(`No players found at ${episodePath}`);
  }

  // Preferência: FullHD > Mobile > outros (ordem do site, mas pegamos todos como fallback).
  const ranked = players
    .map((p) => ({ ...p, score: rankPlayer(p.name) }))
    .sort((a, b) => b.score - a.score);

  const streams = [];
  const seen = new Set();

  for (const p of ranked) {
    try {
      const iframeHtml = await fetchEmbedIframe(p.embed, csrfToken);
      const url = extractPlayerUrlFromIframe(iframeHtml);
      if (!url || seen.has(url)) continue;
      seen.add(url);

      streams.push({
        name: `SushiAnimes • ${p.name || 'Player'}`,
        title: `Monster - S${season}E${episode}`,
        quality: detectQuality(p.name, url),
        url,
        headers: {
          Referer: `${BASE}/`,
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
        },
        isDirect: true,
        videoId,
      });
    } catch (err) {
      log.warn(`player ${p.name} (${p.embed}) failed:`, err.message);
    }
  }

  if (!streams.length) throw new Error('No playable streams resolved.');
  return streams;
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

// ---------------------- Entry ----------------------

async function getAnimePageHtml(animePath) {
  // Cache por path — evita refetch em chamadas repetidas.
  const key = `sushi:anime:${animePath}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const html = await get(animePath);
  cache.set(key, html, 5 * 60_000);
  return html;
}

async function extractStreams(tmdbId, mediaType, season, episode) {
  // 1. CSRF — pega da home (pode estar em qualquer página; home é confiável).
  const homeHtml = await get('/');
  const csrfToken = extractCsrfToken(homeHtml);
  if (!csrfToken) throw new Error('CSRF token not found on homepage.');

  // 2. Títulos TMDB.
  const { getTmdbTitles } = await import('../utils/metadata.js');
  const titles = await getTmdbTitles(tmdbId, mediaType);

  // 3. Search fallback (se TMDB indisponível, usa fallback "monster" básico).
  const searchTitles =
    titles.length > 0
      ? titles
      : ['monster'];

  const anime = await searchAnime(searchTitles);
  if (!anime) throw new Error(`Anime not found on sushianimes for tmdbId=${tmdbId}`);

  // 4. Resolve episode(s).
  return await resolveEpisode({ anime, season, episode, csrfToken });
}

export {
  extractStreams,
  extractCsrfToken,
  pickBestResult,
  extractVideoIdAndEmbed,
  extractPlayerUrlFromIframe,
  rankPlayer,
  detectQuality,
  buildEpisodeUrl,
};
export default { extractStreams };
