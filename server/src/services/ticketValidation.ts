/**
 * Server-side validation & sanitisation for ticket submissions.
 *
 * This is the security boundary: the browser performs its own checks for UX,
 * but nothing here trusts client input. All functions are pure so they can be
 * unit-tested in isolation.
 */

import type {
  TicketSubmission,
  ValidatedTicketInput,
  TicketUrgency,
  FieldError,
} from '../shared/ticketTypes';

export interface ValidationResult {
  ok: boolean;
  errors: FieldError[];
  value?: ValidatedTicketInput;
}

// Field bounds — generous for humans, tight enough to bound payload size.
const LIMITS = {
  practiceName: { min: 2, max: 120 },
  practiceLocation: { min: 2, max: 160 },
  contactName: { min: 2, max: 120 },
  phone: { min: 7, max: 20 },
  email: { max: 254 },
  problemDescription: { min: 10, max: 4000 },
} as const;

// Permissive international phone format: digits with optional +, spaces,
// hyphens, parentheses and dots. Must be 7–20 chars long.
const PHONE_RE = /^[+0-9 ()./-]{7,20}$/;
// Pragmatic email check (full RFC 5322 is overkill and error-prone).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const VALID_URGENCIES: TicketUrgency[] = ['emergency', 'next-business-day'];

/** Coerce unknown input to a trimmed string. */
function asString(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return '';
}

/**
 * Strip control characters (except tab/newline) that could corrupt logs,
 * emails or stored records. Does NOT attempt HTML escaping — that is the
 * responsibility of each output sink (email body, Adaptive Card, etc.).
 */
function sanitiseText(v: string): string {
  // Drop C0/C1 control chars but keep tab (\x09) and newline (\x0A).
  // eslint-disable-next-line no-control-regex
  return v.replace(/[\x00-\x08\x0B-\x1F\x7F-\x9F]/g, '').trim();
}

function lenError(
  field: string,
  label: string,
  len: number,
  min: number,
  max: number
): FieldError | null {
  if (len < min) return { field, message: `${label} must be at least ${min} characters.` };
  if (len > max) return { field, message: `${label} must be ${max} characters or fewer.` };
  return null;
}

/** Validate + sanitise a raw submission. */
export function validateSubmission(body: TicketSubmission): ValidationResult {
  const errors: FieldError[] = [];

  const practiceName = sanitiseText(asString(body.practiceName));
  const practiceLocation = sanitiseText(asString(body.practiceLocation));
  const contactName = sanitiseText(asString(body.contactName));
  const phone = sanitiseText(asString(body.phone));
  const email = sanitiseText(asString(body.email));
  const problemDescription = sanitiseText(asString(body.problemDescription));
  const urgencyRaw = asString(body.urgency);

  const push = (e: FieldError | null) => {
    if (e) errors.push(e);
  };

  if (!practiceName) {
    errors.push({ field: 'practiceName', message: 'Practice name is required.' });
  } else {
    push(
      lenError('practiceName', 'Practice name', practiceName.length, LIMITS.practiceName.min, LIMITS.practiceName.max)
    );
  }

  if (!practiceLocation) {
    errors.push({ field: 'practiceLocation', message: 'Practice location is required.' });
  } else {
    push(
      lenError('practiceLocation', 'Practice location', practiceLocation.length, LIMITS.practiceLocation.min, LIMITS.practiceLocation.max)
    );
  }

  if (!contactName) {
    errors.push({ field: 'contactName', message: 'Contact name is required.' });
  } else {
    push(
      lenError('contactName', 'Contact name', contactName.length, LIMITS.contactName.min, LIMITS.contactName.max)
    );
  }

  if (!phone) {
    errors.push({ field: 'phone', message: 'Phone number is required.' });
  } else if (!PHONE_RE.test(phone)) {
    errors.push({
      field: 'phone',
      message: 'Enter a valid phone number (digits, spaces, +, - and brackets only).',
    });
  }

  // Email is optional, but if supplied it must be valid (it drives confirmations).
  if (email) {
    if (email.length > LIMITS.email.max || !EMAIL_RE.test(email)) {
      errors.push({ field: 'email', message: 'Enter a valid email address, or leave it blank.' });
    }
  }

  if (!problemDescription) {
    errors.push({ field: 'problemDescription', message: 'Problem description is required.' });
  } else {
    push(
      lenError('problemDescription', 'Problem description', problemDescription.length, LIMITS.problemDescription.min, LIMITS.problemDescription.max)
    );
  }

  if (!VALID_URGENCIES.includes(urgencyRaw as TicketUrgency)) {
    errors.push({ field: 'urgency', message: 'Select how urgent the issue is.' });
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    errors: [],
    value: {
      practiceName,
      practiceLocation,
      contactName,
      phone,
      email: email || undefined,
      problemDescription,
      urgency: urgencyRaw as TicketUrgency,
    },
  };
}

/**
 * Lightweight bot heuristics that don't depend on the CAPTCHA:
 *  - honeypot field must be empty (bots fill every input)
 *  - the form must have been open for a minimum number of seconds
 * Returns a reason string when the submission looks automated, else null.
 */
export function detectBot(body: TicketSubmission, minFillSeconds: number): string | null {
  const honeypot = asString(body.website);
  if (honeypot) return 'honeypot';

  const loadedAt = Number(body.formLoadedAt);
  if (Number.isFinite(loadedAt) && loadedAt > 0) {
    const elapsed = (Date.now() - loadedAt) / 1000;
    // Reject only clearly-too-fast submits. A negative elapsed means the client
    // clock is ahead of the server — treat that as skew, not a bot, so we never
    // falsely block a real (possibly urgent) request on timing alone. The
    // honeypot, CAPTCHA and rate limiter still apply in that case.
    if (elapsed >= 0 && elapsed < minFillSeconds) return 'too-fast';
  }
  return null;
}
