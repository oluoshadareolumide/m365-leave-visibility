// Types for the IT Support Portal ticket-intake feature.
//
// These are server-only (the Outlook add-in does not consume them), so they
// live separately from the mirrored add-in contract in `types.ts`.

/** Urgency chosen by the requester on the form. */
export type TicketUrgency = 'emergency' | 'next-business-day';

/** Priority the ticket is triaged at (derived from urgency). */
export type TicketPriority = 'high' | 'normal';

/** Lifecycle state of a stored ticket. */
export type TicketStatus = 'received' | 'routed' | 'failed';

/** Outcome of a single notification channel for a ticket. */
export type NotificationOutcome = 'sent' | 'logged' | 'skipped' | 'failed';

/**
 * Raw submission as received from the browser, before validation.
 * Every field is treated as untrusted until validated.
 */
export interface TicketSubmission {
  practiceName?: unknown;
  practiceLocation?: unknown;
  contactName?: unknown;
  phone?: unknown;
  email?: unknown;
  problemDescription?: unknown;
  urgency?: unknown;
  // Anti-spam fields
  captchaToken?: unknown;
  captchaAnswer?: unknown;
  website?: unknown; // honeypot — must be empty
  formLoadedAt?: unknown; // epoch ms when the form was rendered (timing trap)
}

/** A validated, sanitised submission ready to become a ticket. */
export interface ValidatedTicketInput {
  practiceName: string;
  practiceLocation: string;
  contactName: string;
  phone: string;
  email?: string;
  problemDescription: string;
  urgency: TicketUrgency;
}

/** A persisted support ticket. */
export interface SupportTicket extends ValidatedTicketInput {
  id: string; // also the human-facing reference, e.g. HG-20260620-7F3K
  reference: string;
  priority: TicketPriority;
  status: TicketStatus;
  routedTo: string; // support inbox or queue name
  createdAt: string; // ISO timestamp
  sourceIp?: string;
  userAgent?: string;
  notifications: {
    supportEmail: NotificationOutcome;
    teams: NotificationOutcome;
    confirmation: NotificationOutcome;
  };
}

/** Public response returned to the browser after a successful submission. */
export interface TicketSubmitResponse {
  reference: string;
  priority: TicketPriority;
  urgency: TicketUrgency;
  message: string;
}

/** A field-level validation error. */
export interface FieldError {
  field: string;
  message: string;
}
