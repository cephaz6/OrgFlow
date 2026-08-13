import pino from 'pino';

export function createLogger(level: string) {
  return pino({ level });
}

export type Logger = ReturnType<typeof createLogger>;
