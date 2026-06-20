import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key: string, fallback = ''): string {
  return process.env[key] ?? fallback;
}

// DEV_MODE is an explicit opt-in. When enabled the server boots without real
// Azure/iTrent credentials, serves mock leave data, and bypasses SSO so the
// add-in can be tested locally. It must never be set in production.
const isDevMode = optional('DEV_MODE', 'false') === 'true';

// In dev mode, secrets become optional with throwaway fallbacks so the server
// can start. In production these remain hard requirements.
function requiredUnlessDev(key: string, devFallback: string): string {
  if (isDevMode) return optional(key, devFallback);
  return required(key);
}

export const config = {
  port: parseInt(optional('PORT', '3001'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  isDev: optional('NODE_ENV', 'development') !== 'production',
  devMode: isDevMode,

  azure: {
    tenantId: requiredUnlessDev('AZURE_TENANT_ID', 'dev-tenant'),
    clientId: requiredUnlessDev('AZURE_CLIENT_ID', 'dev-client'),
    clientSecret: requiredUnlessDev('AZURE_CLIENT_SECRET', 'dev-secret'),
    addinUrl: optional('ADDIN_URL', 'https://localhost:3000'),
  },

  cors: {
    allowedOrigins: optional('ALLOWED_ORIGINS', 'https://localhost:3000').split(','),
  },

  itrent: {
    baseUrl: optional('ITRENT_BASE_URL', ''),
    apiPath: optional('ITRENT_API_PATH', '/api/odata/v1'),
    authMethod: optional('ITRENT_AUTH_METHOD', 'basic') as 'basic' | 'apikey' | 'oauth2',
    username: optional('ITRENT_USERNAME'),
    password: optional('ITRENT_PASSWORD'),
    apiKey: optional('ITRENT_API_KEY'),
    oauthClientId: optional('ITRENT_CLIENT_ID'),
    oauthClientSecret: optional('ITRENT_CLIENT_SECRET'),
    oauthTokenUrl: optional('ITRENT_TOKEN_URL'),
  },

  cosmos: {
    endpoint: optional('COSMOS_DB_ENDPOINT'),
    key: optional('COSMOS_DB_KEY'),
    database: optional('COSMOS_DB_DATABASE', 'leave-visibility'),
    container: optional('COSMOS_DB_CONTAINER', 'leave-records'),
  },

  sync: {
    cronExpression: optional('SYNC_CRON', '*/30 * * * *'),
    cacheBackend: optional('CACHE_BACKEND', 'memory') as 'memory' | 'cosmos',
  },

  // ─── IT Support Portal ──────────────────────────────────────────────────────
  support: {
    // Master switch for the portal API + static hosting.
    enabled: optional('SUPPORT_PORTAL_ENABLED', 'true') === 'true',
    // Whether the API also serves the static portal frontend.
    servePortal: optional('SERVE_PORTAL', 'true') === 'true',
    // Filesystem path to the static portal (defaults to <repo>/support-portal).
    portalDir: optional('PORTAL_DIR', ''),
    // Public origin the portal is served from — added to the CORS allowlist so
    // same-origin form posts are accepted in production.
    portalBaseUrl: optional('PORTAL_BASE_URL', ''),

    // Mailbox that urgent + standard tickets are routed to.
    supportEmail: optional('SUPPORT_EMAIL', 'it.support@hakimgroup.co.uk'),
    // Friendly name for the standard (non-urgent) queue.
    standardQueue: optional('SUPPORT_STANDARD_QUEUE', 'standard-support-queue'),
    // Email the requester a confirmation when they supply an address.
    sendConfirmation: optional('SEND_CONFIRMATION_EMAIL', 'true') === 'true',

    // CAPTCHA / spam protection.
    captcha: {
      // builtin (server-issued math challenge) | turnstile | recaptcha | hcaptcha
      provider: optional('CAPTCHA_PROVIDER', 'builtin') as
        | 'builtin'
        | 'turnstile'
        | 'recaptcha'
        | 'hcaptcha',
      // HMAC secret for signing builtin challenges. A throwaway dev default is
      // used in DEV_MODE; production MUST set a long random value.
      secret: requiredUnlessDev('CAPTCHA_SECRET', 'dev-captcha-secret-not-for-prod'),
      // For 3rd-party providers:
      siteKey: optional('CAPTCHA_SITE_KEY'),
      secretKey: optional('CAPTCHA_SECRET_KEY'),
      // How long a builtin challenge stays valid.
      ttlMs: parseInt(optional('CAPTCHA_TTL_MS', '300000'), 10), // 5 min
      // Minimum seconds the form must be open before a human could submit.
      minFillSeconds: parseInt(optional('CAPTCHA_MIN_FILL_SECONDS', '2'), 10),
    },

    // Microsoft Teams alerting for urgent tickets.
    teams: {
      // Incoming-webhook / Power Automate "When a webhook request is received" URL.
      webhookUrl: optional('TEAMS_WEBHOOK_URL'),
    },

    // SMTP transport for transactional email.
    smtp: {
      host: optional('SMTP_HOST'),
      port: parseInt(optional('SMTP_PORT', '587'), 10),
      secure: optional('SMTP_SECURE', 'false') === 'true',
      user: optional('SMTP_USER'),
      pass: optional('SMTP_PASS'),
      from: optional('MAIL_FROM', 'Hakim Group IT Support <it.support@hakimgroup.co.uk>'),
    },

    // Where tickets are stored. "file" appends JSONL on disk (good for dev /
    // small deployments); "cosmos" uses the configured Cosmos DB account.
    store: {
      backend: optional('TICKET_STORE_BACKEND', 'file') as 'file' | 'cosmos' | 'memory',
      filePath: optional('TICKET_STORE_FILE', ''), // defaults to server/data/tickets.jsonl
      cosmosContainer: optional('COSMOS_DB_TICKETS_CONTAINER', 'support-tickets'),
    },

    // Optional API key guarding the admin ticket-list endpoint. Blank = disabled.
    adminApiKey: optional('ADMIN_API_KEY'),
  },
};
