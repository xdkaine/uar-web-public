import winston from 'winston';
import { createHash } from 'crypto';

export function hashLogValue(value: string | undefined | null): string {
  if (!value) return 'unknown';
  return createHash('sha256').update(value).digest('hex').substring(0, 8);
}

const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');
const useJsonFormat = isProduction || process.env.LOG_FORMAT === 'json';

const sanitizeFormat = winston.format((info) => {
  if (info.message && typeof info.message === 'string') {
    const message = info.message as string;
    info.message = message
      .replace(/password["\s:=]+[^\s,}]*/gi, 'password=[REDACTED]')
      .replace(/token["\s:=]+[^\s,}]*/gi, 'token=[REDACTED]')
      .replace(/secret["\s:=]+[^\s,}]*/gi, 'secret=[REDACTED]')
      .replace(/credential[s]?["\s:=]+[^\s,}]*/gi, 'credential=[REDACTED]')
      .replace(/apiKey["\s:=]+[^\s,}]*/gi, 'apiKey=[REDACTED]')
      .replace(/api_key["\s:=]+[^\s,}]*/gi, 'api_key=[REDACTED]')
      .replace(/authorization["\s:=]+[^\s,}]*/gi, 'authorization=[REDACTED]')
      .replace(/bearer\s+[^\s,}]+/gi, 'bearer [REDACTED]')
      .replace(/DN:\s*[^\s,}]*/gi, 'DN=[REDACTED]')
      .replace(/distinguishedName["\s:=]+[^\s,}]*/gi, 'distinguishedName=[REDACTED]');
  }
  return info;
});

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  sanitizeFormat(),
  winston.format.errors({ stack: true }),
  useJsonFormat
    ? winston.format.json()
    : winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
        const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
        return `${timestamp} [${service}] ${level}: ${message} ${metaStr}`;
      })
    )
);

const logger = winston.createLogger({
  level: logLevel,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'uar-web' },
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
  ],
});

if (isProduction && process.env.LOG_FILE_PATH) {
  logger.add(new winston.transports.File({
    filename: process.env.LOG_FILE_PATH,
    maxsize: 10485760,
    maxFiles: 5,
  }));
}

export const ldapLogger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    logger.info(message, { context: 'LDAP', ...meta });
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    logger.warn(message, { context: 'LDAP', ...meta });
  },
  error: (message: string, error?: unknown, meta?: Record<string, unknown>) => {
    const errorMeta = error instanceof Error ? { error: error.message, stack: error.stack } : { error };
    logger.error(message, { context: 'LDAP', ...errorMeta, ...meta });
  },
  debug: (message: string, meta?: Record<string, unknown>) => {
    logger.debug(message, { context: 'LDAP', ...meta });
  },
};

export const appLogger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    logger.info(message, meta);
  },
  warn: (message: string, meta?: Record<string, unknown>) => {
    logger.warn(message, meta);
  },
  error: (message: string, error?: unknown, meta?: Record<string, unknown>) => {
    const errorMeta = error instanceof Error ? { error: error.message, stack: error.stack } : { error };
    logger.error(message, { ...errorMeta, ...meta });
  },
  debug: (message: string, meta?: Record<string, unknown>) => {
    logger.debug(message, meta);
  },
};

export const requestLogger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    logger.info(message, { type: 'access_log', ...meta });
  }
};

export default logger;
