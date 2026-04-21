import pino, { type LoggerOptions } from 'pino';

import { env } from './env.js';

const base: LoggerOptions = {
  level: env.LOG_LEVEL,
  base: { service: 'parkwalk-backend', env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.passwordHash', '*.refreshToken', '*.accessToken'],
    censor: '[REDACTED]',
  },
};

export const logger = env.NODE_ENV === 'development'
  ? pino({
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss.l', ignore: 'pid,hostname,service' },
      },
    })
  : pino(base);
