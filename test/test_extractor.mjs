#!/usr/bin/env node
// Testa o extractor com fixtures (offline) + algumas chamadas live.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';

import {
  extractStreams,
  extractCsrfToken,
  extractEmbedIds,
  extractPlayerUrlFromIframe,
  searchAnime,
  proxyUrl,
} from '../src/sushianimes/extractor.js';
import { POPULAR_TITLES, getApiKey } from '../src/utils/metadata.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, 'fixtures');

let passed = 0;
let failed = 0;

function assert(cond, label) {
  if (cond) {
    console.log(`  ok   ${label}`);
    passed++;
  } else {
    console.log(`  FAIL ${label}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n[${name}]`);
}

// ---------------------- 1. CSRF token ----------------------
section('csrf token extraction');
{
  const html = `
    <html><head>
      <script>var _TOKEN = "abc123def456";</script>
      <meta name="csrf-token" content="should-not-be-used">
    </head><body></body></html>`;
  const tok = extractCsrfToken(html);
  assert(tok === 'abc123def456', 'extracts _TOKEN from inline script');
}

{
  const home = fs.readFileSync(path.join(FIXTURES, 'home.html'), 'utf8');
  const tok = extractCsrfToken(home);
  assert(tok && tok.length > 20, `csrf from home fixture (${tok ? tok.slice(0, 12) + '...' : 'none'})`);
}

// ---------------------- 2. searchAnime (LIVE) ----------------------
section('searchAnime live');
{
  const anime = await searchAnime(['Naruto']);
  assert(anime !== null, 'found an anime for "Naruto"');
  if (anime) {
    assert(typeof anime.slug === 'string' && anime.slug.length > 0, `slug present (${anime.slug})`);
    assert(/^\d+$/.test(anime.id), `id is numeric (${anime.id})`);
  }
}

{
  const anime = await searchAnime(['Monster']);
  assert(anime !== null, 'found an anime for "Monster"');
  if (anime) {
    assert(typeof anime.slug === 'string' && anime.slug.includes('monster'), `slug contains "monster" (${anime.slug})`);
  }
}

{
  const anime = await searchAnime(['this-anime-should-not-exist-xyz123']);
  assert(anime === null, 'returns null for nonexistent query');
}

// ---------------------- 3. extractEmbedIds ----------------------
section('extractEmbedIds from episode page');
{
  // usa a fixture do episode-1.html (Monster) — deve ter 1+ embed
  const html = fs.readFileSync(path.join(FIXTURES, 'episode-1.html'), 'utf8');
  const { embedIds, videoId } = extractEmbedIds(html);
  assert(embedIds.length >= 1, `at least 1 embed id (got ${embedIds.length}: ${embedIds.join(',')})`);
  embedIds.forEach((id) => assert(/^\d+$/.test(id), `embed id is numeric (${id})`));
  if (videoId) {
    assert(/^ep-/.test(videoId), `videoId starts with ep- (${videoId})`);
  }
}

// ---------------------- 4. extractPlayerUrlFromIframe (Monster, srcdoc) ----------------------
section('iframe srcdoc → MP4 URL (Monster)');
{
  const html = fs.readFileSync(path.join(FIXTURES, 'iframe-23954.html'), 'utf8');
  const url = extractPlayerUrlFromIframe(html);
  assert(url && url.endsWith('.mp4'), `mp4 url extracted (${url})`);
  assert(url && url.includes('cdn-s01.pixel-sus-4k-image.com'), 'cdn host matches');
}

// ---------------------- 5. extractPlayerUrlFromIframe (Naruto, srcdoc) ----------------------
section('iframe srcdoc → MP4 URL (Naruto, novo embed 34603)');
{
  const html = fs.readFileSync(path.join(FIXTURES, 'iframe-34603-naruto.html'), 'utf8');
  const url = extractPlayerUrlFromIframe(html);
  assert(url && url.endsWith('.mp4'), `mp4 url extracted (${url})`);
  assert(url && url.includes('naruto'), 'URL contains "naruto"');
  assert(url && url.includes('pixel-sus-4k-image.com'), 'cdn host matches');
}

// ---------------------- 6. proxyUrl ----------------------
section('proxy URL wrapping');
{
  const original = 'https://cdn-s01.pixel-sus-4k-image.com/stream/m/monster-blu-ray/01.mp4';
  const proxied = proxyUrl(original);
  assert(proxied.startsWith('https://akuma-streams-proxy.delkawy.workers.dev/?u='), 'proxied to worker');
  assert(proxied.includes(encodeURIComponent(original)), 'original URL is encoded');
}

// ---------------------- 7. extractStreams graceful degradation ----------------------
section('extractStreams graceful degradation');
{
  let threw = false;
  let result = [];
  try {
    result = await extractStreams('9999999', 'tv', 1, 1);
  } catch (err) {
    threw = true;
  }
  assert(!threw, 'extractStreams does not throw on failure');
  assert(Array.isArray(result), 'returns an array');
  console.log(`  info  result.length = ${result.length} (0 expected without network)`);
}

// ---------------------- 8. extractStreams with injected title ----------------------
section('extractStreams with injected title');
{
  let threw = false;
  let result = [];
  try {
    result = await extractStreams('99999', 'tv', 1, 1, { title: 'Naruto' });
  } catch (err) {
    threw = true;
  }
  assert(!threw, 'does not throw on injected title');
  assert(Array.isArray(result), 'returns array');
  console.log(`  info  result.length = ${result.length}`);
}

// ---------------------- 9. extractStreams end-to-end (LIVE) ----------------------
section('extractStreams end-to-end (LIVE, Naruto T1E1)');
{
  // Naruto dublado: TMDB 16273 (ou usa título injetado que sempre funciona)
  let threw = false;
  let result = [];
  try {
    result = await extractStreams('16273', 'tv', 1, 1, { title: 'Naruto' });
  } catch (err) {
    threw = true;
    console.log('  err  ' + err.message);
  }
  assert(!threw, 'does not throw on real call');
  assert(result.length >= 1, `returned at least 1 stream (got ${result.length})`);
  if (result[0]) {
    assert(result[0].url && result[0].url.includes('workers.dev'), 'URL goes through worker');
    assert(/naruto|cdn/i.test(result[0].url), `URL contains anime/cdn hint (${result[0].url})`);
    assert(result[0].quality && /^\d+p$|^SD$/.test(result[0].quality), `quality looks valid (${result[0].quality})`);
    console.log(`  info  stream: ${result[0].name} | ${result[0].quality} | ${result[0].url.slice(0, 80)}...`);
  }
}

section('extractStreams end-to-end (LIVE, Monster T1E1)');
{
  let result = [];
  try {
    result = await extractStreams('30981', 'tv', 1, 1, { title: 'Monster' });
  } catch (err) {
    console.log('  err  ' + err.message);
  }
  assert(result.length >= 1, `Monster returned ${result.length} stream(s)`);
  if (result[0]) {
    assert(result[0].url.includes('monster-blu-ray') || result[0].url.includes('pixel-sus-4k-image.com'), 'URL points to Monster MP4');
    console.log(`  info  stream: ${result[0].name} | ${result[0].url.slice(0, 80)}...`);
  }
}

// ---------------------- 10. TMDB key discovery ----------------------
section('TMDB key discovery');
{
  const before = getApiKey();
  globalThis.TMDB_API_KEY = 'test-key-1234567890abcdef';
  const after = getApiKey();
  delete globalThis.TMDB_API_KEY;
  assert(before === null, 'no key set → null');
  assert(after === 'test-key-1234567890abcdef', 'reads from globalThis.TMDB_API_KEY');
}

// ---------------------- 11. Popular titles fallback ----------------------
section('popular titles fallback');
{
  assert(POPULAR_TITLES['30981'] && POPULAR_TITLES['30981'].includes('Monster'), 'Monster → 30981');
  assert(POPULAR_TITLES['16273'] && POPULAR_TITLES['16273'].includes('Naruto'), 'Naruto → 16273');
}

// ---------------------- Resultado ----------------------
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
