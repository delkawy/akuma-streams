import { extractStreams } from './extractor.js';
import { makeLogger } from '../utils/logger.js';

const log = makeLogger('sushianimes');

async function getStreams(tmdbId, mediaType, season, episode) {
  try {
    const streams = await extractStreams(tmdbId, mediaType, season, episode);
    return Array.isArray(streams) ? streams : [];
  } catch (err) {
    log.error('getStreams failed:', err.message);
    return [];
  }
}

export { getStreams };
export default { getStreams };
