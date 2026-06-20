/**
 * IT Support Portal API.
 *
 *   GET  /api/tickets/config   public config for the frontend (captcha provider…)
 *   GET  /api/tickets/captcha  issue a CAPTCHA challenge
 *   POST /api/tickets          submit a support ticket (public, anti-spam guarded)
 *   GET  /api/tickets          admin list (requires x-admin-key === ADMIN_API_KEY)
 */

import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../logger';
import { issueChallenge, verifyCaptcha } from '../services/captchaService';
import { validateSubmission, detectBot } from '../services/ticketValidation';
import { createTicket } from '../services/ticketService';
import { ticketStore } from '../data/ticketStore';
import type { TicketSubmission, TicketSubmitResponse } from '../shared/ticketTypes';

const router = Router();

// Stricter limiter for the public submit endpoint: a practice submitting a few
// tickets is fine; hundreds/min is abuse.
const submitLimiter = rateLimit({
  windowMs: 60_000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: 'RATE_LIMITED',
    message: 'Too many submissions from this network. Please wait a minute and try again.',
  },
});

const captchaLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'RATE_LIMITED', message: 'Too many requests, please slow down.' },
});

/** Best-effort client IP, tolerant of proxies (see app.set('trust proxy')). */
function clientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

// ─── Public config ──────────────────────────────────────────────────────────
router.get('/config', (_req: Request, res: Response) => {
  res.json({
    captchaProvider: config.support.captcha.provider,
    captchaSiteKey: config.support.captcha.provider === 'builtin' ? '' : config.support.captcha.siteKey,
    supportEmail: config.support.supportEmail,
    minFillSeconds: config.support.captcha.minFillSeconds,
  });
});

// ─── Issue a CAPTCHA challenge ──────────────────────────────────────────────
router.get('/captcha', captchaLimiter, (_req: Request, res: Response) => {
  const challenge = issueChallenge();
  res.set('Cache-Control', 'no-store');
  res.json(challenge);
});

// ─── Submit a ticket ────────────────────────────────────────────────────────
router.post('/', submitLimiter, async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as TicketSubmission;
  const ip = clientIp(req);

  // 1) Bot heuristics (honeypot + timing) — fail silently with a generic error
  //    so bots learn nothing.
  const botReason = detectBot(body, config.support.captcha.minFillSeconds);
  if (botReason) {
    logger.warn(`Ticket rejected (bot:${botReason}) from ${ip}`);
    res.status(400).json({ code: 'SPAM_DETECTED', message: 'Submission could not be processed.' });
    return;
  }

  // 2) CAPTCHA.
  const captchaOk = await verifyCaptcha(
    typeof body.captchaToken === 'string' ? body.captchaToken : '',
    typeof body.captchaAnswer === 'string' ? body.captchaAnswer : '',
    ip
  );
  if (!captchaOk) {
    res.status(400).json({
      code: 'CAPTCHA_FAILED',
      message: 'The verification answer was incorrect or expired. Please try the new question.',
      errors: [{ field: 'captcha', message: 'Verification failed — please answer the new question.' }],
    });
    return;
  }

  // 3) Field validation (the real security boundary).
  const result = validateSubmission(body);
  if (!result.ok || !result.value) {
    res.status(400).json({
      code: 'VALIDATION_FAILED',
      message: 'Please correct the highlighted fields.',
      errors: result.errors,
    });
    return;
  }

  // 4) Create, route, persist, notify.
  try {
    const ticket = await createTicket(result.value, {
      sourceIp: ip,
      userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : undefined,
    });

    const response: TicketSubmitResponse = {
      reference: ticket.reference,
      priority: ticket.priority,
      urgency: ticket.urgency,
      message:
        ticket.priority === 'high'
          ? 'Your urgent request has been sent to our IT team for immediate attention.'
          : 'Your request has been added to our support queue and will be handled on the next business day.',
    };
    res.status(201).json(response);
  } catch (err) {
    logger.error(`Ticket creation failed: ${String(err)}`);
    res.status(500).json({ code: 'INTERNAL_ERROR', message: 'We could not log your request. Please try again.' });
  }
});

// ─── Admin: list recent tickets ─────────────────────────────────────────────
router.get('/', (req: Request, res: Response) => {
  const expected = config.support.adminApiKey;
  if (!expected) {
    // No key configured → endpoint disabled. 404 to avoid advertising it.
    res.status(404).json({ code: 'NOT_FOUND', message: 'Not found' });
    return;
  }
  const provided = req.header('x-admin-key') ?? '';
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    res.status(401).json({ code: 'UNAUTHORIZED', message: 'Unauthorized' });
    return;
  }

  const limit = Math.min(parseInt((req.query.limit as string) ?? '100', 10) || 100, 500);
  res.json({ count: ticketStore.count(), tickets: ticketStore.list(limit) });
});

export default router;
