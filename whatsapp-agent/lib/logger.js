// Logger minimal sem dependencia externa.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const CURRENT = LEVELS[process.env.LOG_LEVEL] || LEVELS.info;

function fmt(level, msg, ctx) {
  const ts = new Date().toISOString();
  const ctxStr = ctx && Object.keys(ctx).length ? ` ${JSON.stringify(ctx)}` : '';
  return `${ts} [${level.toUpperCase()}] ${msg}${ctxStr}`;
}

export const log = {
  debug: (msg, ctx) => LEVELS.debug >= CURRENT && console.log(fmt('debug', msg, ctx)),
  info:  (msg, ctx) => LEVELS.info  >= CURRENT && console.log(fmt('info',  msg, ctx)),
  warn:  (msg, ctx) => LEVELS.warn  >= CURRENT && console.warn(fmt('warn', msg, ctx)),
  error: (msg, ctx) => LEVELS.error >= CURRENT && console.error(fmt('error', msg, ctx)),
};
