/**
 * Ticket orchestration: turn a validated submission into a routed, persisted,
 * notified support ticket.
 *
 * Routing rules (from the portal spec):
 *   - urgency = "emergency"          → HIGH priority, routed to the support
 *                                       inbox, Teams alert raised.
 *   - urgency = "next-business-day"  → NORMAL priority, routed to the standard
 *                                       support queue, no Teams alert.
 * Either way the requester gets a confirmation email if they supplied an address.
 */

import crypto from 'crypto';
import { config } from '../config';
import { logger } from '../logger';
import { ticketStore } from '../data/ticketStore';
import { postUrgentTicketAlert } from './teamsWebhookService';
import { sendSupportTeamEmail, sendRequesterConfirmation } from './supportEmailService';
import type {
  ValidatedTicketInput,
  SupportTicket,
  TicketPriority,
  TicketUrgency,
} from '../shared/ticketTypes';

export interface RoutingDecision {
  priority: TicketPriority;
  routedTo: string;
  raiseTeamsAlert: boolean;
}

/** Pure routing logic — easy to unit test. */
export function deriveRouting(urgency: TicketUrgency): RoutingDecision {
  if (urgency === 'emergency') {
    return {
      priority: 'high',
      routedTo: config.support.supportEmail,
      raiseTeamsAlert: true,
    };
  }
  return {
    priority: 'normal',
    routedTo: config.support.standardQueue,
    raiseTeamsAlert: false,
  };
}

// Unambiguous reference: HG-YYYYMMDD-XXXX using Crockford-ish base32 (no
// 0/O/1/I confusion), random and effectively collision-free per day.
const REF_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function makeReference(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += REF_ALPHABET[crypto.randomInt(REF_ALPHABET.length)];
  return `HG-${y}${m}${d}-${suffix}`;
}

export interface CreateTicketMeta {
  sourceIp?: string;
  userAgent?: string;
}

/** Create, persist, route and notify for a validated submission. */
export async function createTicket(
  input: ValidatedTicketInput,
  meta: CreateTicketMeta = {}
): Promise<SupportTicket> {
  const now = new Date();
  const routing = deriveRouting(input.urgency);

  // Generate a reference, retrying on the (astronomically unlikely) collision.
  let reference = makeReference(now);
  for (let i = 0; i < 5 && ticketStore.has(reference); i++) reference = makeReference(now);

  const ticket: SupportTicket = {
    ...input,
    id: reference,
    reference,
    priority: routing.priority,
    status: 'received',
    routedTo: routing.routedTo,
    createdAt: now.toISOString(),
    sourceIp: meta.sourceIp,
    userAgent: meta.userAgent,
    notifications: { supportEmail: 'skipped', teams: 'skipped', confirmation: 'skipped' },
  };

  // Persist first so a notification failure never loses the ticket.
  await ticketStore.save(ticket);
  logger.info(
    `Ticket ${ticket.reference} received — priority=${ticket.priority} ` +
      `routedTo=${ticket.routedTo} practice="${ticket.practiceName}"`
  );

  // Fire notifications concurrently; capture each outcome on the record.
  const [supportEmail, teams, confirmation] = await Promise.all([
    sendSupportTeamEmail(ticket),
    routing.raiseTeamsAlert ? postUrgentTicketAlert(ticket) : Promise.resolve('skipped' as const),
    sendRequesterConfirmation(ticket),
  ]);

  ticket.notifications = { supportEmail, teams, confirmation };
  ticket.status =
    supportEmail === 'failed' || (routing.raiseTeamsAlert && teams === 'failed')
      ? 'failed'
      : 'routed';

  // Record the final routed state + notification outcomes. Best-effort: the
  // ticket is already durably captured above, so a failure here is non-fatal.
  try {
    await ticketStore.update(ticket);
  } catch (err) {
    logger.warn(`Ticket ${ticket.reference}: could not persist final state: ${String(err)}`);
  }

  return ticket;
}
