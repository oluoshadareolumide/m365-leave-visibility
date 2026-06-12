import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { logger } from './logger';
import leaveRouter from './routes/leave';
import syncRouter from './routes/sync';
import authRouter from './routes/auth';
import { startSyncScheduler, stopSyncScheduler } from './services/syncService';

const app = express();

// ─── Security middleware ──────────────────────────────────────────────────────

app.use(
  helmet({
    crossOriginEmbedderPolicy: false, // Office.js frames require this
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (server-to-server) and known origins
      if (!origin || config.cors.allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: origin ${origin} not allowed`));
      }
    },
    credentials: false,
    methods: ['GET', 'POST'],
  })
);

// ─── Rate limiting ────────────────────────────────────────────────────────────

const apiLimiter = rateLimit({
  windowMs: 60_000,           // 1 minute
  max: 120,                   // 120 req/min per IP — enough for the add-in
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' },
});

// ─── Body parsing ─────────────────────────────────────────────────────────────

app.use(express.json({ limit: '64kb' }));

// ─── Routes ───────────────────────────────────────────────────────────────────

app.use('/api/leave', apiLimiter, leaveRouter);
app.use('/api/sync', apiLimiter, syncRouter);
app.use('/api/auth', apiLimiter, authRouter);

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: process.env.npm_package_version ?? '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error(`Unhandled error: ${err.message}`, { stack: err.stack });
  res.status(500).json({ code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' });
});

// ─── Start ────────────────────────────────────────────────────────────────────

const server = app.listen(config.port, () => {
  logger.info(`Leave Visibility API running on port ${config.port} (${config.nodeEnv})`);
  if (config.devMode) {
    logger.warn('DEV MODE ENABLED — auth is bypassed and mock data is served. Never use in production.');
  }
  startSyncScheduler();
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down...');
  stopSyncScheduler();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

export default app;
