import { extractStreams } from './extractor.js';
import { makeLogger } from '../utils/logger.js';

const log = makeLogger('sushianimes');

// Assinatura padrão Nuvio: getStreams(tmdbId, mediaType, season, episode)
// Aceita também: getStreams(tmdbId, mediaType, season, episode, { title })
// (alguns forks do Nuvio passam contexto extra)
async function getStreams(tmdbId, mediaType, season, episode, opts) {
  try {
    const streams = await extractStreams(tmdbId, mediaType, season, episode, opts);
    return Array.isArray(streams) ? streams : [];
  } catch (err) {
    log.error('getStreams failed:', err.message);
    return [];
  }
}

export { getStreams };
export default { getStreams };
