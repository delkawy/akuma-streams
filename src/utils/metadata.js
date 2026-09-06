import { fetchJson } from './http.js';
import * as cache from './cache.js';
import { makeLogger } from './logger.js';

const log = makeLogger('tmdb');
const TTL = 1000 * 60 * 60 * 24; // 24h

function getApiKey() {
  if (typeof process !== 'undefined' && process.env && process.env.TMDB_API_KEY) {
    return process.env.TMDB_API_KEY;
  }
  if (typeof globalThis !== 'undefined') {
    // Várias formas que diferentes forks de Nuvio expõem a key.
    const g = globalThis;
    return (
      g.TMDB_API_KEY ||
      g.tmdbApiKey ||
      g.tmdb_api_key ||
      g.tmdbKey ||
      g.tmdb_key ||
      (g.SUSHI_CONFIG && g.SUSHI_CONFIG.tmdbKey) ||
      null
    );
  }
  return null;
}

async function tmdb(path) {
  const key = getApiKey();
  if (!key) {
    log.warn('TMDB_API_KEY not set — returning empty results.');
    return null;
  }
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
  if (!data) return [];

  const titles = [];
  if (data.name) titles.push(data.name);
  if (data.original_name && data.original_name !== data.name) titles.push(data.original_name);
  if (data.also_known_as && Array.isArray(data.also_known_as)) {
    for (const alt of data.also_known_as) titles.push(alt);
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
  if (!data) return [];

  const titles = [];
  if (data.title) titles.push(data.title);
  if (data.original_title && data.original_title !== data.title) titles.push(data.original_title);

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
    return [];
  }
}

export { getTmdbTitles, slugify };
export default { getTmdbTitles, slugify };
