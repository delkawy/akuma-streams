#!/usr/bin/env node
// Testa providers localmente (Node 18+, fetch nativo).
//
// Uso:
//   node test_providers.js sushianimes <tmdbId> tv <season> <episode>
//   node test_providers.js sushianimes 30981 tv 1 1

import { getStreams } from './src/sushianimes/index.js';

function parseArgs(argv) {
  const [, , provider, tmdbId, mediaType, season, episode] = argv;
  return { provider, tmdbId, mediaType, season, episode };
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.provider || !args.tmdbId) {
    console.error(
      'Uso: node test_providers.js <provider> <tmdbId> [mediaType] [season] [episode]'
    );
    process.exit(1);
  }
  if (args.provider !== 'sushianimes') {
    console.error(`Provider desconhecido: ${args.provider}`);
    process.exit(1);
  }

  const tmdbId = String(args.tmdbId);
  const mediaType = args.mediaType || 'tv';
  const season = parseInt(args.season || '1', 10);
  const episode = parseInt(args.episode || '1', 10);

  console.log(`[test] provider=${args.provider} tmdbId=${tmdbId} ${mediaType} S${season}E${episode}`);
  const t0 = Date.now();
  const streams = await getStreams(tmdbId, mediaType, season, episode);
  const dt = Date.now() - t0;

  console.log(`[test] resolved in ${dt}ms — ${streams.length} stream(s)`);
  for (const s of streams) {
    console.log('---');
    console.log('name:    ', s.name);
    console.log('title:   ', s.title);
    console.log('quality: ', s.quality);
    console.log('isDirect:', s.isDirect);
    console.log('url:     ', s.url);
    if (s.headers) console.log('headers: ', JSON.stringify(s.headers));
  }
}

main().catch((err) => {
  console.error('[test] fatal:', err);
  process.exit(1);
});
