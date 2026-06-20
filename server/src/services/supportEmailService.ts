/**
 * Transactional email for the support portal.
 *
 * Sends two kinds of message:
 *   1. The support-team email (the ticket itself), routed to SUPPORT_EMAIL.
 *      Urgent tickets are flagged high-importance.
 *   2. An optional confirmation to the requester when they supply an address.
 *
 * Transport is SMTP via nodemailer. If SMTP is not configured (or in DEV_MODE)
 * the message is logged instead of sent, so the intake flow works end-to-end
 * without a mail server. User-supplied content is HTML-escaped before being
 * placed in any HTML body.
 */

import nodemailer, { type Transporter } from 'nodemailer';
import { config } from '../config';
import { logger } from '../logger';
import type { SupportTicket, NotificationOutcome } from '../shared/ticketTypes';

const smtp = config.support.smtp;

let transporter: Transporter | null = null;
let transportReady = false;

function getTransporter(): Transporter | null {
  if (transportReady) return transporter;
  transportReady = true;
  if (!smtp.host) {
    transporter = null;
    return null;
  }
  transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  return transporter;
}

/** Escape the five HTML-significant characters. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Convert plain text to safe HTML, preserving line breaks. */
function textToHtml(s: string): string {
  return esc(s).replace(/\r?\n/g, '<br>');
}

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
  highPriority?: boolean;
  replyTo?: string;
}

async function send(mail: Mail, context: string): Promise<NotificationOutcome> {
  const t = getTransporter();
  if (!t) {
    logger.info(
      `Email logged (SMTP not configured) → ${context}: to="${mail.to}" subject="${mail.subject}"`
    );
    return config.devMode ? 'logged' : 'skipped';
  }
  try {
    await t.sendMail({
      from: smtp.from,
      to: mail.to,
      replyTo: mail.replyTo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      priority: mail.highPriority ? 'high' : 'normal',
      headers: mail.highPriority
        ? { 'X-Priority': '1', Importance: 'high', 'X-MSMail-Priority': 'High' }
        : undefined,
    });
    logger.info(`Email sent → ${context}: to="${mail.to}"`);
    return 'sent';
  } catch (err) {
    logger.error(`Email failed → ${context}: ${String(err)}`);
    return 'failed';
  }
}

function ticketFieldsText(ticket: SupportTicket): string {
  return [
    `Reference:   ${ticket.reference}`,
    `Priority:    ${ticket.priority.toUpperCase()}`,
    `Urgency:     ${ticket.urgency === 'emergency' ? 'Emergency / Urgent' : 'Can wait until next business day'}`,
    `Practice:    ${ticket.practiceName}`,
    `Location:    ${ticket.practiceLocation}`,
    `Contact:     ${ticket.contactName}`,
    `Phone:       ${ticket.phone}`,
    ...(ticket.email ? [`Email:       ${ticket.email}`] : []),
    `Logged:      ${new Date(ticket.createdAt).toUTCString()}`,
    '',
    'Problem description:',
    ticket.problemDescription,
  ].join('\n');
}

function ticketFieldsHtml(ticket: SupportTicket): string {
  const rows: Array<[string, string]> = [
    ['Reference', ticket.reference],
    ['Priority', ticket.priority.toUpperCase()],
    ['Urgency', ticket.urgency === 'emergency' ? 'Emergency / Urgent' : 'Can wait until next business day'],
    ['Practice', ticket.practiceName],
    ['Location', ticket.practiceLocation],
    ['Contact', ticket.contactName],
    ['Phone', ticket.phone],
    ...(ticket.email ? ([['Email', ticket.email]] as Array<[string, string]>) : []),
    ['Logged', new Date(ticket.createdAt).toUTCString()],
  ];
  const tableRows = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#5b6470;white-space:nowrap;vertical-align:top">${esc(
          k
        )}</td><td style="padding:4px 0;color:#10203a;font-weight:600">${esc(v)}</td></tr>`
    )
    .join('');

  const accent = ticket.priority === 'high' ? '#c0392b' : '#0b6b66';
  return `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;color:#10203a">
    <div style="border-left:4px solid ${accent};padding:4px 0 4px 16px;margin-bottom:16px">
      <div style="font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:${accent};font-weight:700">
        ${ticket.priority === 'high' ? 'Urgent · High priority' : 'Standard · Normal priority'}
      </div>
      <div style="font-size:20px;font-weight:700">IT Support Ticket ${esc(ticket.reference)}</div>
    </div>
    <table style="border-collapse:collapse;font-size:14px;margin-bottom:16px">${tableRows}</table>
    <div style="font-size:13px;color:#5b6470;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">Problem description</div>
    <div style="background:#f5f7fa;border:1px solid #e3e8ef;border-radius:8px;padding:14px;font-size:14px;line-height:1.5">${textToHtml(
      ticket.problemDescription
    )}</div>
  </div>`;
}

/** Email the ticket to the support team. */
export async function sendSupportTeamEmail(ticket: SupportTicket): Promise<NotificationOutcome> {
  const urgent = ticket.priority === 'high';
  const subject = `${urgent ? '[URGENT] ' : ''}IT Support — ${ticket.practiceName} (${ticket.reference})`;
  return send(
    {
      to: config.support.supportEmail,
      subject,
      text: ticketFieldsText(ticket),
      html: ticketFieldsHtml(ticket),
      highPriority: urgent,
      // Let the team reply straight to the requester where possible.
      replyTo: ticket.email,
    },
    'support-team'
  );
}

/** Send the requester a confirmation, if they gave an email + it's enabled. */
export async function sendRequesterConfirmation(ticket: SupportTicket): Promise<NotificationOutcome> {
  if (!config.support.sendConfirmation || !ticket.email) return 'skipped';

  const eta = ticket.priority === 'high'
    ? 'Our IT team has been alerted and will respond as a priority.'
    : 'Your request has been added to our support queue and will be handled on the next business day.';

  const text = [
    `Hi ${ticket.contactName},`,
    '',
    `Thanks — we've received your IT support request and logged it as ${ticket.reference}.`,
    eta,
    '',
    'Summary of what you told us:',
    ticketFieldsText(ticket),
    '',
    'If anything changes, reply to this email and quote your reference number.',
    '',
    'Hakim Group IT Support',
  ].join('\n');

  const html = `
  <div style="font-family:'Segoe UI',Arial,sans-serif;max-width:640px;margin:0 auto;color:#10203a">
    <p>Hi ${esc(ticket.contactName)},</p>
    <p>Thanks — we've received your IT support request and logged it as
       <strong>${esc(ticket.reference)}</strong>.</p>
    <p>${esc(eta)}</p>
    ${ticketFieldsHtml(ticket)}
    <p style="font-size:13px;color:#5b6470">If anything changes, reply to this email and quote your reference number.</p>
    <p style="font-weight:600">Hakim Group IT Support</p>
  </div>`;

  return send(
    {
      to: ticket.email,
      subject: `We've logged your IT request (${ticket.reference})`,
      text,
      html,
    },
    'requester-confirmation'
  );
}
