/**
 * CAPTCHA / human-verification service.
 *
 * Two modes, selected by `CAPTCHA_PROVIDER`:
 *
 *  - **builtin** (default): a server-issued arithmetic challenge. The operands
 *    are signed into an opaque, time-limited, single-use HMAC token so the
 *    server never has to keep per-session state. No third-party calls, works
 *    offline, and is accessible (plain text question, no images).
 *
 *  - **turnstile | recaptcha | hcaptcha**: verifies a client widget token
 *    against the provider's siteverify endpoint.
 *
 * The builtin challenge is deliberately modest on its own — its job is to stop
 * trivial bots. It is layered with a honeypot field, a submit-timing trap and
 * IP rate limiting (see ticketValidation + the route limiter) for defence in
 * depth.
 */

import crypto from 'crypto';
import axios from 'axios';
import { config } from '../config';
import { logger } from '../logger';

export interface CaptchaChallenge {
  /** Opaque token to round-trip back on submit. */
  token: string;
  /** Human-readable question, e.g. "What is 6 plus 3?". */
  question: string;
  /** Which provider the frontend should render. */
  provider: string;
  /** Site key for third-party widgets (empty for builtin). */
  siteKey?: string;
}

interface ChallengePayload {
  a: number;
  b: number;
  op: '+' | '-' | '×';
  exp: number; // expiry epoch ms
  n: string; // nonce
}

const cfg = config.support.captcha;

// Single-use nonce tracking for builtin challenges (prevents token replay
// within the validity window). Pruned lazily on access.
const usedNonces = new Map<string, number>();

function pruneNonces(now: number): void {
  if (usedNonces.size < 1000) return;
  for (const [nonce, exp] of usedNonces) {
    if (exp < now) usedNonces.delete(nonce);
  }
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(data: string): string {
  return crypto.createHmac('sha256', cfg.secret).update(data).digest('base64url');
}

function expectedAnswer(p: ChallengePayload): number {
  switch (p.op) {
    case '+':
      return p.a + p.b;
    case '-':
      return p.a - p.b;
    case '×':
      return p.a * p.b;
  }
}

function spellOperator(op: ChallengePayload['op']): string {
  return op === '+' ? 'plus' : op === '-' ? 'minus' : 'times';
}

/** Issue a fresh builtin challenge. */
export function issueChallenge(): CaptchaChallenge {
  if (cfg.provider !== 'builtin') {
    return {
      token: '',
      question: '',
      provider: cfg.provider,
      siteKey: cfg.siteKey,
    };
  }

  // Keep the arithmetic easy & unambiguous: small operands, non-negative result.
  const ops: ChallengePayload['op'][] = ['+', '-', '×'];
  const op = ops[crypto.randomInt(ops.length)];
  let a = crypto.randomInt(2, 10);
  let b = crypto.randomInt(1, 9);
  if (op === '-' && b > a) [a, b] = [b, a]; // avoid negatives
  if (op === '×') b = crypto.randomInt(2, 6); // keep products small

  const payload: ChallengePayload = {
    a,
    b,
    op,
    exp: Date.now() + cfg.ttlMs,
    n: crypto.randomBytes(9).toString('base64url'),
  };

  const body = b64url(JSON.stringify(payload));
  const token = `${body}.${sign(body)}`;

  return {
    token,
    question: `What is ${a} ${spellOperator(op)} ${b}?`,
    provider: 'builtin',
  };
}

/** Decode + verify the integrity/expiry of a builtin token. */
function parseToken(token: string): ChallengePayload | null {
  const dot = token.indexOf('.');
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  // Timing-safe signature comparison.
  const expectedSig = sign(body);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ChallengePayload;
    if (
      typeof payload.a !== 'number' ||
      typeof payload.b !== 'number' ||
      typeof payload.exp !== 'number' ||
      typeof payload.n !== 'string'
    ) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

async function verifyThirdParty(responseToken: string, remoteIp?: string): Promise<boolean> {
  const endpoints: Record<string, string> = {
    turnstile: 'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    recaptcha: 'https://www.google.com/recaptcha/api/siteverify',
    hcaptcha: 'https://hcaptcha.com/siteverify',
  };
  const url = endpoints[cfg.provider];
  if (!url) return false;
  if (!cfg.secretKey) {
    logger.error(`CAPTCHA provider "${cfg.provider}" selected but CAPTCHA_SECRET_KEY is not set`);
    return false;
  }

  try {
    const params = new URLSearchParams({ secret: cfg.secretKey, response: responseToken });
    if (remoteIp) params.set('remoteip', remoteIp);
    const res = await axios.post(url, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 8000,
    });
    return Boolean((res.data as { success?: boolean }).success);
  } catch (err) {
    logger.warn(`CAPTCHA: third-party verification failed: ${String(err)}`);
    return false;
  }
}

/**
 * Verify a CAPTCHA response.
 * @param token   the challenge token (builtin) or unused (third-party)
 * @param answer  the user's answer (builtin) or the widget response token (3rd-party)
 */
export async function verifyCaptcha(
  token: string,
  answer: string,
  remoteIp?: string
): Promise<boolean> {
  if (cfg.provider !== 'builtin') {
    // For widgets the client sends the provider response token as `answer`.
    return verifyThirdParty(answer || token, remoteIp);
  }

  if (!token || answer === undefined || answer === null) return false;

  const payload = parseToken(token);
  if (!payload) return false;

  const now = Date.now();
  if (payload.exp < now) return false;

  // Single-use: reject a nonce we've already accepted.
  pruneNonces(now);
  if (usedNonces.has(payload.n)) return false;

  const provided = parseInt(String(answer).trim(), 10);
  if (Number.isNaN(provided)) return false;
  if (provided !== expectedAnswer(payload)) return false;

  usedNonces.set(payload.n, payload.exp);
  return true;
}
