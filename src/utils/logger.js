// Logger minimalista, defensivo — funciona em qualquer runtime.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function getEnvLevel() {
  try {
    if (typeof process !== 'undefined' && process && process.env && process.env.LOG_LEVEL) {
      return process.env.LOG_LEVEL;
    }
  } catch (_) {}
  return 'info';
}

function ts() {
  try {
    return new Date().toISOString();
  } catch (_) {
    return '';
  }
}

function makeLogger(scope) {
  const minLevel = LEVELS[getEnvLevel()] || LEVELS.info;
  function emit(level, args) {
    try {
      if (LEVELS[level] < minLevel) return;
      const tag = `[${ts()}] [${level.toUpperCase()}]${scope ? ' [' + scope + ']' : ''}`;
      const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
      if (typeof fn === 'function') fn(tag, ...(args || []));
    } catch (_) {
      // nunca crashar o plugin por causa de log
    }
  }
  return {
    debug: (...a) => { try { emit('debug', a); } catch (_) {} },
    info: (...a) => { try { emit('info', a); } catch (_) {} },
    warn: (...a) => { try { emit('warn', a); } catch (_) {} },
    error: (...a) => { try { emit('error', a); } catch (_) {} },
  };
}

export default makeLogger;
export { makeLogger };
