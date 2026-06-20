/**
 * Microsoft Teams alerting via an incoming webhook.
 *
 * Posts an Adaptive Card wrapped in the envelope expected by the Power Automate
 * "When a Teams webhook request is received" workflow (the supported successor
 * to the retiring Office 365 connector webhooks). Set `TEAMS_WEBHOOK_URL` to
 * the flow/connector URL.
 *
 * When no webhook is configured (e.g. local dev) the alert is logged instead of
 * sent, so the rest of the intake flow still works end-to-end.
 */

import axios from 'axios';
import { config } from '../config';
import { logger } from '../logger';
import type { SupportTicket, NotificationOutcome } from '../shared/ticketTypes';

function buildAdaptiveCard(ticket: SupportTicket): Record<string, unknown> {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          msteams: { width: 'Full' },
          body: [
            {
              type: 'Container',
              style: 'attention',
              bleed: true,
              items: [
                {
                  type: 'TextBlock',
                  text: '🚨 Urgent IT Support Ticket',
                  weight: 'Bolder',
                  size: 'Large',
                  wrap: true,
                },
                {
                  type: 'TextBlock',
                  text: `Reference ${ticket.reference} · High priority`,
                  spacing: 'None',
                  isSubtle: true,
                  wrap: true,
                },
              ],
            },
            {
              type: 'FactSet',
              facts: [
                { title: 'Practice', value: ticket.practiceName },
                { title: 'Location', value: ticket.practiceLocation },
                { title: 'Contact', value: ticket.contactName },
                { title: 'Phone', value: ticket.phone },
                ...(ticket.email ? [{ title: 'Email', value: ticket.email }] : []),
                { title: 'Logged', value: new Date(ticket.createdAt).toUTCString() },
              ],
            },
            {
              type: 'TextBlock',
              text: 'Problem description',
              weight: 'Bolder',
              spacing: 'Medium',
              wrap: true,
            },
            {
              type: 'TextBlock',
              // Adaptive Card text is rendered as text/markdown, not HTML, so
              // user content cannot inject markup here. We still cap length.
              text: ticket.problemDescription.slice(0, 1500),
              wrap: true,
            },
          ],
          actions: ticket.email
            ? [
                {
                  type: 'Action.OpenUrl',
                  title: 'Reply by email',
                  url: `mailto:${ticket.email}?subject=${encodeURIComponent(
                    `Re: IT support ticket ${ticket.reference}`
                  )}`,
                },
              ]
            : [],
        },
      },
    ],
  };
}

/** Post an urgent-ticket alert to Teams. Never throws. */
export async function postUrgentTicketAlert(ticket: SupportTicket): Promise<NotificationOutcome> {
  const url = config.support.teams.webhookUrl;
  if (!url) {
    logger.info(
      `Teams alert skipped (no TEAMS_WEBHOOK_URL): urgent ticket ${ticket.reference} for ${ticket.practiceName}`
    );
    return config.devMode ? 'logged' : 'skipped';
  }

  try {
    await axios.post(url, buildAdaptiveCard(ticket), {
      headers: { 'Content-Type': 'application/json' },
      timeout: 8000,
    });
    logger.info(`Teams alert sent for urgent ticket ${ticket.reference}`);
    return 'sent';
  } catch (err) {
    logger.error(`Teams alert failed for ticket ${ticket.reference}: ${String(err)}`);
    return 'failed';
  }
}
