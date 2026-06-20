import express from 'express';
import path from 'path';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { logger } from './logger';
import leaveRouter from './routes/leave';
import syncRouter from './routes/sync';
import authRouter from './routes/auth';
import ticketsRouter from './routes/tickets';
import { startSyncScheduler, stopSyncScheduler } from './services/syncService';
import { ticketStore } from './data/ticketStore';

const app = express();

// Behind Azure App Service / a reverse proxy, trust the first proxy hop so
// req.ip reflects the real client (used for rate limiting + abuse logging).
app.set('trust proxy', 1);

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

// Origins allowed to call the API cross-origin: the add-in origins plus the
// support portal's public origin (so a separately-hosted portal can post).
const allowedOrigins = [
  ...config.cors.allowedOrigins,
  config.support.portalBaseUrl,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no Origin (server-to-server, same-origin GETs) and
      // known origins. DEV_MODE is permissive to ease local testing — it is an
      // explicit opt-in that is never set in production.
      if (!origin || config.devMode || allowedOrigins.includes(origin)) {
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

if (config.support.enabled) {
  app.use('/api/tickets', apiLimiter, ticketsRouter);
}

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: process.env.npm_package_version ?? '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── Static IT Support Portal ─────────────────────────────────────────────────
// Served from the same app so the form and its API share an origin (no CORS
// needed for the bundled portal). Disable with SERVE_PORTAL=false to host the
// frontend separately (e.g. Azure Static Web Apps / SharePoint).
if (config.support.enabled && config.support.servePortal) {
  const portalDir =
    config.support.portalDir || path.resolve(__dirname, '../../support-portal');
  app.use(
    express.static(portalDir, {
      index: 'index.html',
      maxAge: config.isDev ? 0 : '1h',
      setHeaders: (res) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
      },
    })
  );
  logger.info(`Serving IT Support Portal from ${portalDir}`);
}

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
  if (config.support.enabled) {
    ticketStore.init().catch((err) => logger.error(`Ticket store init failed: ${String(err)}`));
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
