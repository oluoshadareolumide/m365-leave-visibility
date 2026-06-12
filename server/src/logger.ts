import winston from 'winston';
import { config } from './config';

export const logger = winston.createLogger({
  level: config.isDev ? 'debug' : 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    config.isDev
      ? winston.format.colorize()
      : winston.format.json()
  ),
  transports: [
    new winston.transports.Console({
      format: config.isDev
        ? winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
          )
        : winston.format.json(),
    }),
  ],
});
