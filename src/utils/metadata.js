import { fetchJson } from './http.js';
import * as cache from './cache.js';
import { makeLogger } from './logger.js';

const log = makeLogger('tmdb');
const TTL = 1000 * 60 * 60 * 24; // 24h

// ---------------------- API key discovery ----------------------

function getApiKey() {
  if (typeof process !== 'undefined' && process.env && process.env.TMDB_API_KEY) {
    return process.env.TMDB_API_KEY;
  }
  if (typeof globalThis !== 'undefined') {
    const g = globalThis;
    const candidates = [
      g.TMDB_API_KEY,
      g.tmdbApiKey,
      g.tmdb_api_key,
      g.tmdbKey,
      g.tmdb_key,
      g.TMDB_KEY,
      g.TMDB_BEARER,
      (g.NuvioConfig && g.NuvioConfig.tmdbKey),
      (g.NuvioConfig && g.NuvioConfig.tmdbApiKey),
      (g.sushiConfig && g.sushiConfig.tmdbKey),
      (g.appConfig && g.appConfig.tmdbKey),
    ];
    for (const c of candidates) {
      if (c && typeof c === 'string' && c.length > 10) return c;
    }
  }
  if (typeof window !== 'undefined' && window !== globalThis) {
    const w = window;
    return w.TMDB_API_KEY || w.tmdbKey || null;
  }
  return null;
}

// ---------------------- Popular anime fallback ----------------------
// Quando TMDB não está acessível (app sem key), usamos este dicionário
// para pelo menos resolver os animes mais comuns. TMDB ID → lista de títulos
// para tentar no /search/ e como base para gerar slugs do CDN.

const POPULAR_TITLES = {
  30981: ['Monster', '怪物', 'MONSTER'],
  16273: ['Naruto', 'ナルト'],
  30984: ['Naruto Shippuden', 'ナルト 疾風伝'],
  21: ['One Piece', 'ワンピース'],
  81340: ['Bleach', 'ブリーチ'],
  1: ['Cowboy Bebop', 'カウボーイビバップ'],
  1100: ['Death Note', 'デスノート'],
  1399: ['Game of Thrones'],
  1396: ['Breaking Bad'],
  1668: ['Friends'],
  2316: ['The Office'],
  1399: ['Game of Thrones'],
};

function getFallbackTitles(tmdbId, mediaType) {
  if (mediaType === 'movie') return [];
  const titles = POPULAR_TITLES[String(tmdbId)] || [];
  return titles.length ? [titles.join('|'), titles.map(slugify).join('|')] : [];
}

// ---------------------- TMDB API ----------------------

async function tmdb(path) {
  const key = getApiKey();
  if (!key) return null;
  const url = `https://api.themoviedb.org/3${path}${path.includes('?') ? '&' : '?'}api_key=${key}&language=pt-BR`;
  return await fetchJson(url);
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

async function getTvTitles(tmdbId) {
  const cacheKey = `tmdb:tv:${tmdbId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await tmdb(`/tv/${tmdbId}`);
  const titles = [];
  if (data) {
    if (data.name) titles.push(data.name);
    if (data.original_name && data.original_name !== data.name) titles.push(data.original_name);
    if (data.also_known_as && Array.isArray(data.also_known_as)) {
      for (const alt of data.also_known_as) titles.push(alt);
    }
  }
  // Se TMDB falhou, usa fallback hardcoded
  if (!titles.length) {
    log.warn(`TMDB lookup empty for tv/${tmdbId}, using hardcoded fallback`);
    const fallback = getFallbackTitles(tmdbId, 'tv');
    if (fallback.length) {
      cache.set(cacheKey, fallback, TTL);
      return fallback;
    }
    return [];
  }

  const variants = [titles.join('|'), titles.map(slugify).join('|')];
  const dedup = [...new Set(variants)];
  cache.set(cacheKey, dedup, TTL);
  return dedup;
}

async function getMovieTitles(tmdbId) {
  const cacheKey = `tmdb:movie:${tmdbId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const data = await tmdb(`/movie/${tmdbId}`);
  const titles = [];
  if (data) {
    if (data.title) titles.push(data.title);
    if (data.original_title && data.original_title !== data.title) titles.push(data.original_title);
  }
  if (!titles.length) {
    const fallback = getFallbackTitles(tmdbId, 'movie');
    if (fallback.length) {
      cache.set(cacheKey, fallback, TTL);
      return fallback;
    }
    return [];
  }
  const variants = [titles.join('|'), titles.map(slugify).join('|')];
  const dedup = [...new Set(variants)];
  cache.set(cacheKey, dedup, TTL);
  return dedup;
}

async function getTmdbTitles(tmdbId, mediaType) {
  try {
    if (mediaType === 'movie') return await getMovieTitles(tmdbId);
    return await getTvTitles(tmdbId);
  } catch (err) {
    log.error('TMDB lookup failed:', err.message);
    return getFallbackTitles(tmdbId, mediaType);
  }
}

export { getTmdbTitles, getApiKey, slugify, POPULAR_TITLES };
export default { getTmdbTitles, getApiKey, slugify, POPULAR_TITLES };
