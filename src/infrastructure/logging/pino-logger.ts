import pino from 'pino';
import type { LoggerPort } from './logger.port.js';

function wrap(logger: pino.Logger): LoggerPort {
  return {
    debug: (o, m) => (m ? logger.debug(o, m) : logger.debug(o)),
    info: (o, m) => (m ? logger.info(o, m) : logger.info(o)),
    warn: (o, m) => (m ? logger.warn(o, m) : logger.warn(o)),
    error: (o, m) => (m ? logger.error(o, m) : logger.error(o)),
    child: (b) => wrap(logger.child(b)),
  };
}

export function createPinoLogger(level: string): LoggerPort {
  const logger = pino({
    level,
    base: { service: 'lims' },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
  return wrap(logger);
}
