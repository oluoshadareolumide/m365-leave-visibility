/**
 * Microsoft Graph API service.
 *
 * Responsibilities:
 *  - OBO token exchange (Office SSO token → Graph token)
 *  - Resolving users by email
 *  - Reading / updating Teams presence for leave status
 *  - Sending adaptive card notifications to users
 */

import axios from 'axios';
import { Client, ResponseType } from '@microsoft/microsoft-graph-client';
import { config } from '../config';
import { logger } from '../logger';
import type { GraphUser, GraphPresenceUpdate } from '../shared/types';
import 'isomorphic-fetch';

// ─── OBO Token Exchange ───────────────────────────────────────────────────────

const oboTokenCache = new Map<string, { token: string; expiresAt: number }>();

export async function exchangeTokenOBO(
  assertion: string,
  scope: string
): Promise<string> {
  const cacheKey = `${assertion.slice(-16)}:${scope}`;
  const cached = oboTokenCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt - 30_000) {
    return cached.token;
  }

  const res = await axios.post(
    `https://login.microsoftonline.com/${config.azure.tenantId}/oauth2/v2.0/token`,
    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      client_id: config.azure.clientId,
      client_secret: config.azure.clientSecret,
      assertion,
      scope,
      requested_token_use: 'on_behalf_of',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  const { access_token, expires_in } = res.data as {
    access_token: string;
    expires_in: number;
  };

  oboTokenCache.set(cacheKey, {
    token: access_token,
    expiresAt: Date.now() + expires_in * 1000,
  });

  return access_token;
}

// ─── Client factory ────────────────────────────────────────────────────────────

function buildClientWithToken(token: string): Client {
  return Client.init({
    authProvider: (done) => done(null, token),
  });
}

/** Get a Graph client authenticated as the service principal (app-only). */
let appOnlyToken: { value: string; expiresAt: number } | null = null;

async function getAppOnlyToken(): Promise<string> {
  if (appOnlyToken && Date.now() < appOnlyToken.expiresAt - 30_000) {
    return appOnlyToken.value;
  }
  const res = await axios.post(
    `https://login.microsoftonline.com/${config.azure.tenantId}/oauth2/v2.0/token`,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: config.azure.clientId,
      client_secret: config.azure.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  const { access_token, expires_in } = res.data as {
    access_token: string;
    expires_in: number;
  };
  appOnlyToken = { value: access_token, expiresAt: Date.now() + expires_in * 1000 };
  return appOnlyToken.value;
}

export async function getAppOnlyClient(): Promise<Client> {
  const token = await getAppOnlyToken();
  return buildClientWithToken(token);
}

// ─── User resolution ─────────────────────────────────────────────────────────

const userCache = new Map<string, { user: GraphUser; expiresAt: number }>();

export async function getUserByEmail(email: string): Promise<GraphUser | null> {
  const key = email.toLowerCase();
  const cached = userCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.user;

  try {
    const client = await getAppOnlyClient();
    const user = (await client
      .api(`/users/${encodeURIComponent(email)}`)
      .select('id,displayName,mail,userPrincipalName,jobTitle,department')
      .get()) as GraphUser;

    userCache.set(key, { user, expiresAt: Date.now() + 3_600_000 }); // 1 hr
    return user;
  } catch (err) {
    logger.warn(`Graph: could not resolve user ${email}: ${String(err)}`);
    return null;
  }
}

export async function getUsersByEmails(emails: string[]): Promise<Map<string, GraphUser>> {
  const result = new Map<string, GraphUser>();
  await Promise.all(
    emails.map(async (email) => {
      const user = await getUserByEmail(email);
      if (user) result.set(email.toLowerCase(), user);
    })
  );
  return result;
}

// ─── Presence management ─────────────────────────────────────────────────────

/**
 * Set a user's Teams presence status message (requires Presence.ReadWrite.All).
 * Note: App-only presence write requires delegated context in most tenants.
 * This sets a "status note" rather than hard-overriding availability.
 */
export async function setUserPresenceStatusMessage(
  userId: string,
  message: string,
  expiry?: Date
): Promise<void> {
  try {
    const client = await getAppOnlyClient();
    const body: Record<string, unknown> = {
      message: {
        content: message,
        contentType: 'text',
      },
    };
    if (expiry) {
      body.expiryDateTime = {
        dateTime: expiry.toISOString(),
        timeZone: 'UTC',
      };
    }
    await client.api(`/users/${userId}/presence/statusMessage`).put(body);
  } catch (err) {
    logger.warn(`Graph: failed to set presence for ${userId}: ${String(err)}`);
  }
}

/**
 * Prefer status message over hard-overriding presence.
 * Hard override requires Presence.ReadWrite.All with specific Graph permissions.
 */
export async function setUserPresence(
  userId: string,
  update: GraphPresenceUpdate
): Promise<void> {
  try {
    const client = await getAppOnlyClient();
    await client.api(`/users/${userId}/presence/setPresence`).post({
      sessionId: 'leave-visibility-addin',
      availability: update.availability,
      activity: update.activity,
      expirationDuration: 'PT8H',
    });
  } catch (err) {
    logger.warn(`Graph: failed to set presence for ${userId}: ${String(err)}`);
  }
}

/**
 * Send a notification to a user via Teams chat (using Graph chat message API).
 * Requires Chat.ReadWrite.All or equivalent.
 */
export async function sendTeamsNotification(
  recipientUserId: string,
  senderUserId: string,
  message: string
): Promise<void> {
  try {
    const client = await getAppOnlyClient();

    // Create or retrieve 1:1 chat
    const chat = (await client.api('/chats').post({
      chatType: 'oneOnOne',
      members: [
        {
          '@odata.type': '#microsoft.graph.aadUserConversationMember',
          roles: ['owner'],
          'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${senderUserId}')`,
        },
        {
          '@odata.type': '#microsoft.graph.aadUserConversationMember',
          roles: ['owner'],
          'user@odata.bind': `https://graph.microsoft.com/v1.0/users('${recipientUserId}')`,
        },
      ],
    })) as { id: string };

    await client.api(`/chats/${chat.id}/messages`).post({
      body: {
        content: message,
        contentType: 'text',
      },
    });
  } catch (err) {
    logger.warn(`Graph: failed to send Teams notification: ${String(err)}`);
  }
}

/**
 * Read a user's current auto-reply (OOF) settings.
 */
export async function getOofSettings(
  userId: string,
  delegatedToken: string
): Promise<{enabled: boolean; internalMessage?: string; externalMessage?: string} | null> {
  try {
    const client = buildClientWithToken(delegatedToken);
    const settings = await client
      .api(`/users/${userId}/mailboxSettings/automaticRepliesSetting`)
      .get() as Record<string, unknown>;

    return {
      enabled: settings.status === 'alwaysEnabled' || settings.status === 'scheduled',
      internalMessage: settings.internalReplyMessage as string | undefined,
      externalMessage: settings.externalReplyMessage as string | undefined,
    };
  } catch (err) {
    logger.warn(`Graph: failed to get OOF settings for ${userId}: ${String(err)}`);
    return null;
  }
}

/**
 * Set automatic reply (out-of-office) for a user.
 * Requires MailboxSettings.ReadWrite (delegated or app-only).
 */
export async function setOofSettings(
  userId: string,
  enabled: boolean,
  startDate: string,
  endDate: string,
  message: string
): Promise<void> {
  try {
    const client = await getAppOnlyClient();
    await client.api(`/users/${userId}/mailboxSettings`).patch({
      automaticRepliesSetting: {
        status: enabled ? 'scheduled' : 'disabled',
        scheduledStartDateTime: { dateTime: `${startDate}T00:00:00`, timeZone: 'UTC' },
        scheduledEndDateTime: { dateTime: `${endDate}T23:59:59`, timeZone: 'UTC' },
        internalReplyMessage: message,
        externalReplyMessage: message,
      },
    });
  } catch (err) {
    logger.warn(`Graph: failed to set OOF for ${userId}: ${String(err)}`);
  }
}
