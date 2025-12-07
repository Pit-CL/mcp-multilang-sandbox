/**
 * Logger utility using Pino
 */

import pino from 'pino';

const logLevel = (process.env.LOG_LEVEL || 'info') as pino.Level;

export const logger = pino({
  level: logLevel,
});

/**
 * Create child logger with context
 */
export function createLogger(context: Record<string, any>) {
  return logger.child(context);
}
