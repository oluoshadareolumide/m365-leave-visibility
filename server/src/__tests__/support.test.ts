import crypto from 'crypto';
import { validateSubmission, detectBot } from '../services/ticketValidation';
import { deriveRouting } from '../services/ticketService';
import { issueChallenge, verifyCaptcha } from '../services/captchaService';
import type { TicketSubmission } from '../shared/ticketTypes';

const VALID: TicketSubmission = {
  practiceName: 'Bayfield Opticians',
  practiceLocation: 'Bolton — Bradshawgate',
  contactName: 'Jane Smith',
  phone: '01204 123456',
  email: 'jane@bayfield.example',
  problemDescription: 'The till PC will not boot — black screen since 9am.',
  urgency: 'emergency',
};

describe('validateSubmission', () => {
  it('accepts a well-formed submission and returns sanitised values', () => {
    const r = validateSubmission(VALID);
    expect(r.ok).toBe(true);
    expect(r.value?.urgency).toBe('emergency');
  });

  it.each(['practiceName', 'practiceLocation', 'contactName', 'phone', 'problemDescription'])(
    'rejects a missing %s',
    (field) => {
      const r = validateSubmission({ ...VALID, [field]: '' });
      expect(r.ok).toBe(false);
      expect(r.errors.some((e) => e.field === field)).toBe(true);
    }
  );

  it('accepts international / formatted phone numbers', () => {
    expect(validateSubmission({ ...VALID, phone: '+44 (0)1204 123456' }).ok).toBe(true);
  });

  it.each(['call-me', '12345', 'phone-number-please'])('rejects invalid phone "%s"', (phone) => {
    expect(validateSubmission({ ...VALID, phone }).ok).toBe(false);
  });

  it('treats email as optional but validates it when present', () => {
    expect(validateSubmission({ ...VALID, email: '' }).ok).toBe(true);
    expect(validateSubmission({ ...VALID, email: 'not-an-email' }).ok).toBe(false);
    expect(validateSubmission({ ...VALID, email: 'a@b.co' }).ok).toBe(true);
  });

  it('enforces description length bounds', () => {
    expect(validateSubmission({ ...VALID, problemDescription: 'help' }).ok).toBe(false);
    expect(validateSubmission({ ...VALID, problemDescription: 'x'.repeat(4001) }).ok).toBe(false);
  });

  it('only allows the two known urgencies', () => {
    expect(validateSubmission({ ...VALID, urgency: 'whenever' }).ok).toBe(false);
    expect(validateSubmission({ ...VALID, urgency: 'next-business-day' }).ok).toBe(true);
  });

  it('trims whitespace and strips control characters', () => {
    const r = validateSubmission({ ...VALID, practiceName: '  Bayfield  ' });
    expect(r.value?.practiceName).toBe('Bayfield');
  });

  it('stores angle-bracket content verbatim (escaping happens at output time)', () => {
    const r = validateSubmission({
      ...VALID,
      problemDescription: '<script>alert(1)</script> the printer is down',
    });
    expect(r.ok).toBe(true);
    expect(r.value?.problemDescription).toContain('<script>');
  });

  it('coerces non-string input safely', () => {
    const r = validateSubmission({ ...VALID, practiceName: { evil: true } as unknown });
    expect(r.ok).toBe(false);
  });
});

describe('detectBot', () => {
  it('flags a filled honeypot', () => {
    expect(detectBot({ website: 'http://spam' }, 2)).toBe('honeypot');
  });
  it('flags an instant (too-fast) submit', () => {
    expect(detectBot({ formLoadedAt: Date.now() }, 2)).toBe('too-fast');
  });
  it('tolerates a future timestamp (client clock skew, not a bot)', () => {
    expect(detectBot({ formLoadedAt: Date.now() + 60_000 }, 2)).toBeNull();
  });
  it('passes a human-paced submit', () => {
    expect(detectBot({ formLoadedAt: Date.now() - 9000 }, 2)).toBeNull();
  });
  it('passes when no timestamp is supplied', () => {
    expect(detectBot({}, 2)).toBeNull();
  });
});

describe('deriveRouting', () => {
  it('routes emergencies to high priority + Teams alert', () => {
    const r = deriveRouting('emergency');
    expect(r.priority).toBe('high');
    expect(r.raiseTeamsAlert).toBe(true);
    expect(r.routedTo).toBe('it.support@hakimgroup.co.uk');
  });
  it('routes routine issues to the standard queue at normal priority', () => {
    const r = deriveRouting('next-business-day');
    expect(r.priority).toBe('normal');
    expect(r.raiseTeamsAlert).toBe(false);
    expect(r.routedTo).toBe('standard-support-queue');
  });
});

describe('captchaService (builtin)', () => {
  const SECRET = 'test-captcha-secret';

  function answerFor(question: string): string {
    const m = question.match(/What is (\d+) (plus|minus|times) (\d+)/)!;
    const a = +m[1];
    const b = +m[3];
    return String(m[2] === 'plus' ? a + b : m[2] === 'minus' ? a - b : a * b);
  }

  function makeToken(payload: object, secret = SECRET): string {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    return `${body}.${sig}`;
  }

  it('issues a maths challenge with a token and question', () => {
    const c = issueChallenge();
    expect(c.provider).toBe('builtin');
    expect(c.token).toContain('.');
    expect(c.question).toMatch(/What is \d+ (plus|minus|times) \d+\?/);
  });

  it('accepts the correct answer', async () => {
    const c = issueChallenge();
    expect(await verifyCaptcha(c.token, answerFor(c.question))).toBe(true);
  });

  it('rejects an incorrect answer', async () => {
    const c = issueChallenge();
    expect(await verifyCaptcha(c.token, '9999')).toBe(false);
  });

  it('is single-use (replay is rejected)', async () => {
    const c = issueChallenge();
    const ans = answerFor(c.question);
    expect(await verifyCaptcha(c.token, ans)).toBe(true);
    expect(await verifyCaptcha(c.token, ans)).toBe(false);
  });

  it('rejects an expired token', async () => {
    const token = makeToken({ a: 2, b: 3, op: '+', exp: Date.now() - 1000, n: 'expired1' });
    expect(await verifyCaptcha(token, '5')).toBe(false);
  });

  it('rejects a tampered token (bad signature)', async () => {
    const good = makeToken({ a: 2, b: 3, op: '+', exp: Date.now() + 60_000, n: 'tamper1' });
    const tampered = good.slice(0, -2) + (good.endsWith('aa') ? 'bb' : 'aa');
    expect(await verifyCaptcha(tampered, '5')).toBe(false);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const forged = makeToken(
      { a: 2, b: 3, op: '+', exp: Date.now() + 60_000, n: 'forged1' },
      'wrong-secret'
    );
    expect(await verifyCaptcha(forged, '5')).toBe(false);
  });

  it('rejects malformed tokens', async () => {
    expect(await verifyCaptcha('', '5')).toBe(false);
    expect(await verifyCaptcha('not-a-token', '5')).toBe(false);
    expect(await verifyCaptcha('a.b.c', '5')).toBe(false);
  });
});
