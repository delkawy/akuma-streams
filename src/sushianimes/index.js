import { extractStreams } from './extractor.js';
import { makeLogger } from '../utils/logger.js';

const log = makeLogger('sushianimes');

async function getStreams(tmdbId, mediaType, season, episode, opts) {
  try {
    const streams = await extractStreams(tmdbId, mediaType, season, episode, opts);
    return Array.isArray(streams) ? streams : [];
  } catch (err) {
    log.error('getStreams failed:', err.message);
    return [];
  }
}

// Exposição global — QuickJS/Nuvio procura a função via globalThis.
// Tentamos vários nomes comuns em diferentes forks do Nuvio.
try {
  globalThis.getStreams = getStreams;
  globalThis.SushiAnimes = { getStreams };
  globalThis.sushianimes = { getStreams };
  if (typeof self !== 'undefined') {
    self.getStreams = getStreams;
    self.SushiAnimes = { getStreams };
  }
} catch (e) {
  // Ignora se globalThis não estiver disponível
}

export { getStreams };
export default { getStreams };
