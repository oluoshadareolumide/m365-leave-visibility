/**
 * Azure Function: iTrentSync
 *
 * Timer-triggered function (default: every 30 min) that:
 *  1. Fetches all approved leave from iTrent OData API
 *  2. Writes the normalised records to Cosmos DB
 *  3. Optionally triggers Teams presence updates via Graph API
 *
 * Environment variables (set in Azure Function App Settings):
 *   AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
 *   ITRENT_BASE_URL, ITRENT_AUTH_METHOD, ITRENT_USERNAME, ITRENT_PASSWORD
 *   COSMOS_DB_ENDPOINT, COSMOS_DB_KEY, COSMOS_DB_DATABASE, COSMOS_DB_CONTAINER
 *   SYNC_CRON  (cron expression, e.g. "0 */30 * * * *")
 */

import { AzureFunction, Context } from '@azure/functions';
import axios, { AxiosInstance } from 'axios';
import { CosmosClient, Container } from '@azure/cosmos';
import * as dotenv from 'dotenv';

dotenv.config();

// ─── Types ────────────────────────────────────────────────────────────────────

interface iTrentEmployee {
  id: string;
  forename: string;
  surname: string;
  emailAddress: string;
  workEmailAddress?: string;
}

interface iTrentAbsence {
  id: string;
  employeeId: string;
  absenceType: string;
  startDate: string;
  endDate: string;
  numberOfDays: number;
  approvalStatus: string;
  delegateEmployeeId?: string;
  notes?: string;
}

interface LeaveRecord {
  id: string;
  employeeId: string;
  email: string;
  displayName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  approvalStatus: 'approved';
  delegate?: { email: string; displayName: string };
  notes?: string;
  updatedAt: string;
  // Cosmos DB partition key
  pk: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const ITRENT_BASE = process.env.ITRENT_BASE_URL ?? '';
const ITRENT_PATH = process.env.ITRENT_API_PATH ?? '/api/odata/v1';
const AUTH_METHOD = (process.env.ITRENT_AUTH_METHOD ?? 'basic') as 'basic' | 'apikey' | 'oauth2';

const COSMOS_ENDPOINT = process.env.COSMOS_DB_ENDPOINT ?? '';
const COSMOS_KEY = process.env.COSMOS_DB_KEY ?? '';
const COSMOS_DB = process.env.COSMOS_DB_DATABASE ?? 'leave-visibility';
const COSMOS_CONTAINER = process.env.COSMOS_DB_CONTAINER ?? 'leave-records';

// ─── iTrent client ────────────────────────────────────────────────────────────

let oauthToken: { value: string; expiresAt: number } | null = null;

async function getOAuthToken(): Promise<string> {
  if (oauthToken && Date.now() < oauthToken.expiresAt - 30_000) return oauthToken.value;
  const res = await axios.post(
    process.env.ITRENT_TOKEN_URL ?? '',
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.ITRENT_CLIENT_ID ?? '',
      client_secret: process.env.ITRENT_CLIENT_SECRET ?? '',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  oauthToken = {
    value: res.data.access_token as string,
    expiresAt: Date.now() + (res.data.expires_in as number) * 1000,
  };
  return oauthToken.value;
}

function buildITrentClient(): AxiosInstance {
  const client = axios.create({
    baseURL: `${ITRENT_BASE}${ITRENT_PATH}`,
    timeout: 30_000,
    headers: { Accept: 'application/json' },
  });

  client.interceptors.request.use(async (req) => {
    if (AUTH_METHOD === 'basic') {
      req.auth = {
        username: process.env.ITRENT_USERNAME ?? '',
        password: process.env.ITRENT_PASSWORD ?? '',
      };
    } else if (AUTH_METHOD === 'apikey') {
      req.headers['X-API-Key'] = process.env.ITRENT_API_KEY ?? '';
    } else if (AUTH_METHOD === 'oauth2') {
      req.headers['Authorization'] = `Bearer ${await getOAuthToken()}`;
    }
    return req;
  });

  return client;
}

async function fetchAllPages<T>(
  client: AxiosInstance,
  url: string,
  params: Record<string, string | number> = {}
): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = url;
  while (nextUrl) {
    const res = await client.get<{ value: T[]; '@odata.nextLink'?: string }>(nextUrl, {
      params: nextUrl === url ? params : undefined,
    });
    results.push(...res.data.value);
    nextUrl = res.data['@odata.nextLink'] ?? null;
  }
  return results;
}

// ─── Cosmos DB helper ─────────────────────────────────────────────────────────

async function getCosmosContainer(): Promise<Container> {
  const cosmosClient = new CosmosClient({ endpoint: COSMOS_ENDPOINT, key: COSMOS_KEY });
  const { database } = await cosmosClient.databases.createIfNotExists({ id: COSMOS_DB });
  const { container } = await database.containers.createIfNotExists({
    id: COSMOS_CONTAINER,
    partitionKey: { paths: ['/pk'] },
    defaultTtl: 30 * 24 * 3600, // 30 days TTL — old records auto-expire
  });
  return container;
}

// ─── Function entry point ─────────────────────────────────────────────────────

const iTrentSync: AzureFunction = async (context: Context): Promise<void> => {
  context.log('iTrentSync: starting');
  const start = Date.now();

  if (!ITRENT_BASE) {
    context.log.warn('ITRENT_BASE_URL not configured, skipping sync');
    return;
  }

  const client = buildITrentClient();
  const now = new Date();
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - 1);
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + 90);

  const startStr = windowStart.toISOString().slice(0, 10);
  const endStr = windowEnd.toISOString().slice(0, 10);

  // Fetch employees
  context.log('Fetching employees from iTrent...');
  const employees = await fetchAllPages<iTrentEmployee>(client, '/Employees', {
    $select: 'id,forename,surname,emailAddress,workEmailAddress',
    $top: 500,
  });
  const empMap = new Map(employees.map((e) => [e.id, e]));
  context.log(`Found ${employees.length} employees`);

  // Fetch approved absences in window
  context.log(`Fetching absences (${startStr} → ${endStr})...`);
  const absences = await fetchAllPages<iTrentAbsence>(client, '/Absences', {
    $filter: `approvalStatus eq 'Approved' and endDate ge ${startStr} and startDate le ${endStr}`,
    $select: 'id,employeeId,absenceType,startDate,endDate,numberOfDays,approvalStatus,delegateEmployeeId,notes',
    $top: 500,
  });
  context.log(`Found ${absences.length} approved absences`);

  // Build normalised records
  const records: LeaveRecord[] = [];
  for (const abs of absences) {
    const emp = empMap.get(abs.employeeId);
    if (!emp) continue;
    const email = (emp.workEmailAddress || emp.emailAddress || '').toLowerCase();
    if (!email) continue;

    const record: LeaveRecord = {
      id: abs.id,
      employeeId: abs.employeeId,
      email,
      displayName: `${emp.forename} ${emp.surname}`.trim(),
      leaveType: abs.absenceType,
      startDate: abs.startDate,
      endDate: abs.endDate,
      approvalStatus: 'approved',
      notes: abs.notes,
      updatedAt: now.toISOString(),
      pk: email, // partition by employee email
    };

    if (abs.delegateEmployeeId) {
      const delegate = empMap.get(abs.delegateEmployeeId);
      if (delegate) {
        const delegateEmail = (
          delegate.workEmailAddress || delegate.emailAddress || ''
        ).toLowerCase();
        if (delegateEmail) {
          record.delegate = {
            email: delegateEmail,
            displayName: `${delegate.forename} ${delegate.surname}`.trim(),
          };
        }
      }
    }

    records.push(record);
  }

  context.log(`Upserting ${records.length} leave records to Cosmos DB...`);

  if (COSMOS_ENDPOINT && COSMOS_KEY) {
    const container = await getCosmosContainer();
    const batchSize = 50;
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      await Promise.all(batch.map((r) => container.items.upsert(r)));
    }
    context.log('Cosmos DB upsert complete');
  } else {
    context.log.warn('COSMOS_DB_ENDPOINT/KEY not configured — records not persisted');
  }

  context.log(
    `iTrentSync complete in ${Date.now() - start}ms: ` +
    `${employees.length} employees, ${absences.length} absences, ${records.length} records`
  );
};

export default iTrentSync;
