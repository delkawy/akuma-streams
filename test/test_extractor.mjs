#!/usr/bin/env node
// Teste offline: roda o extractor com HTML de fixture (capturado via browser)
// Útil porque Cloudflare bloqueia fetch fora de browsers reais.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getStreams } from '../src/sushianimes/index.js';
import {
  extractStreams,
  extractCsrfToken,
  pickBestResult,
  extractVideoIdAndEmbed,
  extractPlayerUrlFromIframe,
  rankPlayer,
  detectQuality,
  buildEpisodeUrl,
} from '../src/sushianimes/extractor.js';

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
section('csrf token');
{
  const html = `
    <html><head>
      <script>var _TOKEN = "abc123def456";</script>
      <meta name="csrf-token" content="should-not-be-used">
    </head><body></body></html>`;
  const tok = extractCsrfToken(html);
  assert(tok === 'abc123def456', 'extracts _TOKEN from inline script');
}

// ---------------------- 2. pickBestResult ----------------------
section('search result picker');
{
  const html = `
    <a href="/anime/naruto-123"></a>
    <a href="/anime/monster-blu-ray-958"></a>
    <a href="/anime/re-monster-dublado-480"></a>
    <a href="/anime/re-monster-478"></a>
    <a href="/anime/bleach-1105"></a>`;
  const best = pickBestResult(html, 'monster');
  assert(best && best.slug === 'monster-blu-ray', `picks monster-blu-ray (got ${best && best.slug})`);
  assert(best && best.id === '958', `id=958 (got ${best && best.id})`);
}

// ---------------------- 3. extractVideoIdAndEmbed ----------------------
section('episode page parse');
{
  const html = fs.readFileSync(path.join(FIXTURES, 'episode-1.html'), 'utf8');
  const { videoId, players } = extractVideoIdAndEmbed(html);
  assert(videoId === 'ep-22791', `videoId = ep-22791 (got ${videoId})`);
  assert(players.length >= 1, `at least 1 player (got ${players.length})`);
  if (players[0]) {
    assert(/^\d+$/.test(players[0].embed), `embed id numeric (got ${players[0].embed})`);
    assert(typeof players[0].name === 'string' && players[0].name.length > 0, `player name present`);
  }
}

// ---------------------- 4. extractPlayerUrlFromIframe ----------------------
section('iframe srcdoc → mp4');
{
  const html = fs.readFileSync(path.join(FIXTURES, 'iframe-23954.html'), 'utf8');
  const url = extractPlayerUrlFromIframe(html);
  assert(url && url.endsWith('.mp4'), `mp4 url extracted (got ${url})`);
  assert(url && url.includes('cdn-s01.pixel-sus-4k-image.com'), `cdn host matches`);
}

// ---------------------- 5. rankPlayer / detectQuality ----------------------
section('player ranking + quality');
{
  assert(rankPlayer('FullHD') > rankPlayer('HD'), 'FullHD > HD');
  assert(rankPlayer('Mobile') < rankPlayer('HD'), 'HD > Mobile');
  assert(detectQuality('FullHD', '') === '1080p', 'FullHD → 1080p');
  assert(detectQuality('HD', '') === '720p', 'HD → 720p');
}

// ---------------------- 6. buildEpisodeUrl ----------------------
section('episode URL builder');
{
  const url = buildEpisodeUrl('/anime/monster-blu-ray-958', 1, 1);
  assert(
    url === '/anime/monster-blu-ray-958-1-season-1-episode',
    `URL format correct (got ${url})`
  );
}

// ---------------------- 7. end-to-end via fixtures ----------------------
section('end-to-end integration via fixtures');
{
  // Carrega as fixtures e valida o pipeline concatenando-as manualmente.
  const homeHtml = fs.readFileSync(path.join(FIXTURES, 'home.html'), 'utf8');
  const searchHtml = fs.readFileSync(path.join(FIXTURES, 'search-monster.html'), 'utf8');
  const episodeHtml = fs.readFileSync(path.join(FIXTURES, 'episode-1.html'), 'utf8');
  const iframeHtml = fs.readFileSync(path.join(FIXTURES, 'iframe-23954.html'), 'utf8');

  const csrf = extractCsrfToken(homeHtml);
  assert(csrf && csrf.length > 10, `csrf token from home fixture (${csrf ? csrf.slice(0, 8) + '...' : 'none'})`);

  const best = pickBestResult(searchHtml, 'monster');
  assert(best && best.slug === 'monster-blu-ray', `search picked monster-blu-ray`);

  const episodeUrl = buildEpisodeUrl(best.href, 1, 1);
  const { videoId, players } = extractVideoIdAndEmbed(episodeHtml);
  assert(videoId && players.length >= 1, `episode parsed (${videoId}, ${players.length} players)`);

  // Itera players como o extractor faria
  const urls = players
    .map((p) => ({ ...p, score: rankPlayer(p.name) }))
    .sort((a, b) => b.score - a.score)
    .map((p) => extractPlayerUrlFromIframe(iframeHtml))
    .filter(Boolean);

  assert(urls.length >= 1, `at least 1 mp4 url resolved (got ${urls.length})`);
  assert(
    urls[0] && urls[0].endsWith('.mp4'),
    `stream is .mp4 (got ${urls[0] ? urls[0].split('/').pop() : 'none'})`
  );
}

// ---------------------- Resultado ----------------------
console.log(`\n=== ${passed} passed, ${failed} failed ===`);
process.exit(failed === 0 ? 0 : 1);
