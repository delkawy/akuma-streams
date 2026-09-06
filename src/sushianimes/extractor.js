import { get, postAjax } from './http.js';
import { makeLogger } from '../utils/logger.js';

const log = makeLogger('sushi:extractor');
const VERSION = '0.8.0';

// Cloudflare Worker que adiciona Referer + Origin pra tocar MP4 no player nativo.
const PROXY_URL = 'https://akuma-streams-proxy.delkawy.workers.dev';

function proxyUrl(cdnUrl) {
  return `${PROXY_URL}/?u=${encodeURIComponent(cdnUrl)}`;
}

// ---------------------- HTML helpers ----------------------

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;quot;/g, '"')
    .replace(/&amp;#39;/g, "'")
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

// ---------------------- 1) Search via /ajax/posts ----------------------
// Retorna JSON: { data: [{id, name, image, url, type}] }
// URL completa é retornada pelo site — usamos pra extrair slug+id.

// Score de similaridade entre o nome do item e a query.
// Maior = melhor. -1 = sem match.
function scoreItem(it, query) {
  const name = (it.name || '').toLowerCase().trim();
  const q = query.toLowerCase().trim();
  if (!name || !q) return -1;
  // 1) match exato
  if (name === q) return 100;
  // 2) match exato após remover sufixos comuns
  const base = name.replace(/\s*\((dublado|legendado|blu-ray|tv|sub|dub)\)\s*$/i, '').trim();
  if (base === q) return 90;
  // 3) começa com a query
  if (name.startsWith(q)) return 50;
  // 4) contém
  if (name.includes(q)) return 10;
  return -1;
}

// Escolhe o item com maior score. Empate: primeiro que apareceu.
function pickBestItem(items, query) {
  if (!items || !items.length) return null;
  let best = null;
  let bestScore = -1;
  for (const it of items) {
    const s = scoreItem(it, query);
    if (s > bestScore) {
      bestScore = s;
      best = it;
    }
  }
  return best;
}

function parseAnimeFromItem(it) {
  if (!it || !it.url) return null;
  const m = it.url.match(/\/anime\/([a-z0-9-]+)-(\d+)\/?$/i);
  if (!m) return null;
  return { slug: m[1], id: m[2], name: it.name, href: `/anime/${m[1]}-${m[2]}` };
}

async function searchAnime(titles) {
  const tried = [];
  for (const raw of titles) {
    if (!raw) continue;
    // títulos podem ter múltiplos nomes separados por | (original|alt|alt2)
    const candidates = String(raw).split('|').map((t) => t.trim()).filter(Boolean);
    for (const q of candidates) {
      tried.push(q);
      const url = `/ajax/posts?q=${encodeURIComponent(q)}`;
      // Pequeno delay entre queries — Cloudflare limita bursts.
      await sleep(150);
      let payload = null;
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const text = await get(url, { headers: { 'X-Requested-With': 'XMLHttpRequest' } });
          payload = JSON.parse(text);
          break;
        } catch (err) {
          log.warn(`search "${q}" attempt ${attempt}: ${err.message}`);
          if (attempt === 1) await sleep(2000);
        }
      }
      if (!payload) continue;
      const items = (payload && payload.data) || [];
      if (!items.length) {
        log.info('search empty for', q);
        continue;
      }
      const best = pickBestItem(items, q);
      const anime = parseAnimeFromItem(best);
      if (anime) {
        log.info(`matched ${anime.slug} (id=${anime.id}, "${anime.name}") for query "${q}"`);
        return anime;
      }
    }
  }
  log.warn('search exhausted. tried:', tried.slice(0, 3).join(', '));
  return null;
}

// ---------------------- 2) Episode page → embed IDs ----------------------
// /anime/<slug>-<id>-<season>-season-<episode>-episode
// HTML tem múltiplos data-embed="N" (vários players/mirrors).

function extractEmbedIds(html) {
  const ids = new Set();
  // padrão principal: dropdown de players
  const re = /data-embed="(\d+)"|embed="(\d+)"|data-id="(\d+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const id = m[1] || m[2] || m[3];
    if (id) ids.add(id);
  }
  // pega o videoId também (info, não embed)
  const videoId = (html.match(/const\s+videoId\s*=\s*"([^"]+)"/) || [])[1] || null;
  // filtra IDs que parecem ser o do próprio anime (3-4 dígitos) e mantém só os "longos"
  // (4-5 dígitos tipicamente são embeds)
  const embedList = [...ids].filter((id) => {
    if (id.length < 3) return false;
    // ignora IDs muito pequenos que podem ser o do anime
    return true;
  });
  return { embedIds: embedList, videoId };
}

// ---------------------- 3) /ajax/embed → srcdoc → playerEmbed ----------------------
// O embed pode retornar:
//   A) iframe com src="https://playsus.online/..." (wrapper JS-only, não serve)
//   B) iframe com srcdoc="<html>...var playerEmbed='CDN_URL'..." (DIRETO MP4)
// Só o caso B serve pro player nativo do Nuvio.

function extractPlayerUrlFromIframe(iframeHtml) {
  // Primeiro tenta pelo atributo src do iframe (vai ser playsus, mas verificamos)
  const srcMatch = iframeHtml.match(/<iframe[^>]*\ssrc="([^"]+)"/i);
  if (srcMatch && /playsus|player\?|blogger\.com\/video/i.test(srcMatch[1])) {
    // Pode ter o token do blogger — mas o playsus wrapper exige JS pra resolver.
    // Continuamos procurando srcdoc; se não achar, podemos tentar o src.
  }
  // Procura srcdoc (caso B, direto)
  const srcdocMatch = iframeHtml.match(/srcdoc="([^"]+)"/i);
  if (srcdocMatch) {
    const decoded = decodeEntities(srcdocMatch[1]);
    const playerMatch = decoded.match(/var\s+playerEmbed\s*=\s*"([^"]+)"/);
    if (playerMatch) return playerMatch[1];
  }
  // Fallback: às vezes o playerEmbed está no HTML inteiro sem estar em srcdoc
  const inlineMatch = iframeHtml.match(/var\s+playerEmbed\s*=\s*"([^"]+)"/);
  if (inlineMatch) return inlineMatch[1];
  return null;
}

async function fetchEmbedIframe(embedId, csrfToken) {
  const body = `id=${encodeURIComponent(embedId)}&_TOKEN=${encodeURIComponent(csrfToken)}`;
  const headers = {
    'X-CSRF-Token': csrfToken,
    'X-Requested-With': 'XMLHttpRequest',
    Accept: 'text/html, */*; q=0.01',
  };
  return await postAjax('/ajax/embed', body, { headers });
}

function rankEmbeds(embeds, html) {
  // Heurística: embed que estiver marcado como "selected" ou vier primeiro é priorizado.
  // Alguns embeds retornam playsus (ruim), outros retornam srcdoc com MP4 (bom).
  // Como não sabemos qual é qual sem testar, retornamos na ordem que aparecem.
  return embeds;
}

// ---------------------- Pipeline ----------------------

function buildEpisodeUrl(animePath, season, episode) {
  return `${animePath}-${season}-season-${episode}-episode`;
}

function detectQuality(url) {
  const u = String(url || '').toLowerCase();
  if (u.includes('fullhd') || u.includes('1080') || u.includes('4k')) return '1080p';
  if (u.includes('hd') || u.includes('720')) return '720p';
  return 'SD';
}

// Detecta qualidade a partir do HTML do iframe (atributo title="FullHD / HLS").
function detectQualityFromIframe(iframeHtml) {
  const m = iframeHtml.match(/<iframe[^>]*\stitle="([^"]+)"/i);
  if (!m) return null;
  const t = m[1].toLowerCase();
  if (t.includes('fullhd') || t.includes('1080') || t.includes('4k')) return '1080p';
  if (t.includes('hd') || t.includes('720')) return '720p';
  return null;
}

// Nome amigável: usa qualidade (1080p/720p) ou "Direct" como fallback.
function makeStream({ url, quality, videoId, season, episode, source, animeSlug }) {
  const q = quality || detectQuality(url);
  const label = q === 'SD' ? 'Direct' : q;
  return {
    name: `SushiAnimes • ${label}`,
    title: `${animeSlug ? animeSlug + ' ' : ''}S${season}E${episode}`.trim(),
    quality: q,
    url: proxyUrl(url),
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    },
    isDirect: true,
    videoId: videoId || null,
  };
}

async function resolveViaEmbed({ anime, season, episode, csrfToken }) {
  const episodePath = buildEpisodeUrl(anime.href, season, episode);
  log.info('episode page', episodePath);

  let html = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      html = await get(episodePath);
      break;
    } catch (err) {
      log.warn(`episode page attempt ${attempt}: ${err.message}`);
      if (attempt < 3) await sleep(2000 * attempt);
    }
  }
  if (!html) throw new Error(`Failed to fetch ${episodePath}`);

  const { embedIds, videoId } = extractEmbedIds(html);
  if (!embedIds.length) throw new Error(`No embeds at ${episodePath}`);

  log.info('found', embedIds.length, 'embed candidates:', embedIds.join(', '));
  const ordered = rankEmbeds(embedIds, html);

  for (const embedId of ordered) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await sleep(300); // gentil entre embeds
        const iframeHtml = await fetchEmbedIframe(embedId, csrfToken);
        const playerUrl = extractPlayerUrlFromIframe(iframeHtml);
        if (playerUrl) {
          if (/\.(mp4|m3u8|m4v)(\?|$)/i.test(playerUrl)) {
            // Tenta detectar qualidade do atributo title do iframe (FullHD / HLS, etc)
            const qualityFromHtml = detectQualityFromIframe(iframeHtml);
            const url = playerUrl;
            const quality = qualityFromHtml || detectQuality(url);
            log.info(`embed ${embedId} → direct video (${quality}):`, url);
            return makeStream({
              url,
              quality,
              videoId,
              season,
              episode,
              source: `Embed ${embedId}`,
              animeSlug: anime.slug,
            });
          }
          log.info('embed', embedId, '→ wrapper URL (não direto):', playerUrl.slice(0, 80));
        } else {
          log.info('embed', embedId, '→ sem playerEmbed');
        }
        break;
      } catch (err) {
        log.warn(`embed ${embedId} attempt ${attempt}: ${err.message}`);
        if (attempt < 3 && isRetryableError(err.message)) {
          await sleep(3500);
        } else {
          break;
        }
      }
    }
  }
  throw new Error('No embed returned a direct video URL');
}

// ---------------------- Entry ----------------------

async function extractStreams(tmdbId, mediaType, season, episode, opts = {}) {
  log.info(`sushianimes v${VERSION} | tmdbId=${tmdbId} ${mediaType} S${season}E${episode}`);
  const errors = [];

  // 0) Carrega titles do TMDB
  const { getTmdbTitles } = await import('../utils/metadata.js');
  let titles = (await getTmdbTitles(tmdbId, mediaType)) || [];

  // Aceita título injetado pelo app
  const extraTitle =
    opts.title ||
    (typeof globalThis !== 'undefined' && globalThis.currentMediaTitle) ||
    null;
  if (extraTitle) {
    log.info('using injected title:', extraTitle);
    titles = [extraTitle, ...titles];
  }

  const titlesForSearch = titles.length > 0 ? titles : [`tmdb-${tmdbId}`];
  log.info('titles', titlesForSearch.slice(0, 3));

  // 1) CSRF token da home
  let csrfToken = null;
  try {
    csrfToken = extractCsrfToken(await get('/'));
  } catch (err) {
    errors.push(`csrf: ${err.message}`);
    log.warn('csrf failed:', err.message);
  }

  // 2) Search → {slug, id}
  let anime = null;
  if (csrfToken) {
    try {
      anime = await searchAnime(titlesForSearch);
    } catch (err) {
      errors.push(`search: ${err.message}`);
    }
  }

  if (!anime) {
    log.error('No anime found for', titlesForSearch.slice(0, 2));
    return [];
  }

  // 3) Episode page → embed IDs → /ajax/embed → playerEmbed
  try {
    return [await resolveViaEmbed({ anime, season, episode, csrfToken })];
  } catch (err) {
    errors.push(`embed: ${err.message}`);
  }

  log.error('All strategies failed. Errors:', errors.join(' | '));
  return [];
}

export {
  extractStreams,
  extractCsrfToken,
  searchAnime,
  extractEmbedIds,
  extractPlayerUrlFromIframe,
  resolveViaEmbed,
  proxyUrl,
};
export default { extractStreams };
