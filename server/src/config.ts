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

export const config = {
  port: parseInt(optional('PORT', '3001'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  isDev: optional('NODE_ENV', 'development') !== 'production',

  azure: {
    tenantId: required('AZURE_TENANT_ID'),
    clientId: required('AZURE_CLIENT_ID'),
    clientSecret: required('AZURE_CLIENT_SECRET'),
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
};
