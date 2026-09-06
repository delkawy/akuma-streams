const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const envLevel = (typeof process !== 'undefined' && process.env && process.env.LOG_LEVEL) || 'info';

function ts() {
  return new Date().toISOString();
}

function makeLogger(scope) {
  const minLevel = LEVELS[envLevel] || LEVELS.info;
  function emit(level, args) {
    if (LEVELS[level] < minLevel) return;
    const tag = `[${ts()}] [${level.toUpperCase()}]${scope ? ' [' + scope + ']' : ''}`;
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(tag, ...args);
  }
  return {
    debug: (...a) => emit('debug', a),
    info: (...a) => emit('info', a),
    warn: (...a) => emit('warn', a),
    error: (...a) => emit('error', a),
  };
}

export default makeLogger;
export { makeLogger };
