/**
 * iTrent HR integration service.
 *
 * iTrent (MHR International) exposes an OData REST API (v1) and a legacy SOAP API.
 * This service implements the REST approach with a file-import fallback.
 *
 * Configuration is driven by the ITRENT_* environment variables in .env.
 */

import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { config } from '../config';
import { logger } from '../logger';
import type { iTrentEmployee, iTrentAbsence, LeaveRecord } from '../shared/types';

interface ODataListResponse<T> {
  '@odata.context'?: string;
  '@odata.count'?: number;
  value: T[];
  '@odata.nextLink'?: string;
}

let cachedToken: { value: string; expiresAt: number } | null = null;

async function getOAuthToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 30_000) {
    return cachedToken.value;
  }
  const { oauthClientId, oauthClientSecret, oauthTokenUrl } = config.itrent;
  const res = await axios.post(
    oauthTokenUrl,
    new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: oauthClientId,
      client_secret: oauthClientSecret,
      scope: 'openid',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  cachedToken = {
    value: res.data.access_token as string,
    expiresAt: Date.now() + (res.data.expires_in as number) * 1000,
  };
  return cachedToken.value;
}

function buildClient(): AxiosInstance {
  const { baseUrl, apiPath, authMethod, username, password, apiKey } = config.itrent;
  const baseURL = `${baseUrl}${apiPath}`;

  const instance = axios.create({
    baseURL,
    timeout: 30_000,
    headers: { Accept: 'application/json' },
  });

  instance.interceptors.request.use(async (req) => {
    switch (authMethod) {
      case 'basic':
        req.auth = { username, password };
        break;
      case 'apikey':
        req.headers['X-API-Key'] = apiKey;
        break;
      case 'oauth2': {
        const token = await getOAuthToken();
        req.headers['Authorization'] = `Bearer ${token}`;
        break;
      }
    }
    return req;
  });

  return instance;
}

/** Fetch all pages of an OData endpoint. */
async function fetchAllPages<T>(
  client: AxiosInstance,
  url: string,
  params: Record<string, string | number> = {}
): Promise<T[]> {
  const results: T[] = [];
  let nextUrl: string | null = url;

  while (nextUrl) {
    const res: AxiosResponse<ODataListResponse<T>> = await client.get<ODataListResponse<T>>(
      nextUrl,
      { params: nextUrl === url ? params : undefined }
    );
    results.push(...res.data.value);
    nextUrl = res.data['@odata.nextLink'] ?? null;
  }

  return results;
}

/** Map iTrent absence record to a normalised LeaveRecord. */
function mapAbsence(
  absence: iTrentAbsence,
  employeeMap: Map<string, iTrentEmployee>
): LeaveRecord | null {
  if (absence.approvalStatus.toLowerCase() !== 'approved') return null;

  const employee = employeeMap.get(absence.employeeId);
  if (!employee) {
    logger.warn(`iTrent sync: no employee found for id ${absence.employeeId}`);
    return null;
  }

  const email = (employee.workEmailAddress || employee.emailAddress || '').toLowerCase();
  if (!email) return null;

  return {
    id: absence.id,
    employeeId: absence.employeeId,
    email,
    displayName: `${employee.forename} ${employee.surname}`.trim(),
    leaveType: absence.absenceType,
    startDate: absence.startDate,
    endDate: absence.endDate,
    approvalStatus: 'approved',
    notes: absence.notes,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export interface SyncResult {
  records: LeaveRecord[];
  employeeCount: number;
  absenceCount: number;
}

/**
 * Full sync: fetch all employees + their approved absences from iTrent.
 * Returns only approved leave records that start within the next 90 days
 * or ended within the last 1 day.
 */
export async function syncFromITrent(): Promise<SyncResult> {
  if (!config.itrent.baseUrl) {
    logger.warn('iTrent base URL not configured — skipping sync');
    return { records: [], employeeCount: 0, absenceCount: 0 };
  }

  const client = buildClient();
  const now = new Date();

  // Inclusive window: yesterday through 90 days ahead
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - 1);
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + 90);

  const startStr = windowStart.toISOString().slice(0, 10);
  const endStr = windowEnd.toISOString().slice(0, 10);

  logger.info(`iTrent sync: fetching employees...`);
  const employees = await fetchAllPages<iTrentEmployee>(client, '/Employees', {
    $select: 'id,forename,surname,emailAddress,workEmailAddress',
    $top: 500,
  });

  const employeeMap = new Map(employees.map((e) => [e.id, e]));
  logger.info(`iTrent sync: found ${employees.length} employees`);

  logger.info(`iTrent sync: fetching absences (${startStr} to ${endStr})...`);
  const absences = await fetchAllPages<iTrentAbsence>(client, '/Absences', {
    $filter: `approvalStatus eq 'Approved' and endDate ge ${startStr} and startDate le ${endStr}`,
    $select: 'id,employeeId,absenceType,startDate,endDate,numberOfDays,approvalStatus,delegateEmployeeId,notes',
    $top: 500,
  });

  logger.info(`iTrent sync: found ${absences.length} approved absences`);

  const records: LeaveRecord[] = [];
  for (const absence of absences) {
    // Resolve delegate employee email if present
    const mapped = mapAbsence(absence, employeeMap);
    if (!mapped) continue;

    if (absence.delegateEmployeeId) {
      const delegate = employeeMap.get(absence.delegateEmployeeId);
      if (delegate) {
        const delegateEmail = (
          delegate.workEmailAddress || delegate.emailAddress || ''
        ).toLowerCase();
        if (delegateEmail) {
          mapped.delegate = {
            email: delegateEmail,
            displayName: `${delegate.forename} ${delegate.surname}`.trim(),
          };
        }
      }
    }

    records.push(mapped);
  }

  return {
    records,
    employeeCount: employees.length,
    absenceCount: absences.length,
  };
}

/**
 * Fetch leave status for a specific set of employee email addresses.
 * Used for on-demand queries when a full sync result is not available.
 */
export async function fetchLeaveForEmails(emails: string[]): Promise<LeaveRecord[]> {
  if (!config.itrent.baseUrl || emails.length === 0) return [];

  const client = buildClient();
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const futureWindow = new Date(now);
  futureWindow.setDate(futureWindow.getDate() + 90);
  const futureStr = futureWindow.toISOString().slice(0, 10);

  const employees = await fetchAllPages<iTrentEmployee>(client, '/Employees', {
    $filter: emails
      .map((e) => `workEmailAddress eq '${e}' or emailAddress eq '${e}'`)
      .join(' or '),
    $select: 'id,forename,surname,emailAddress,workEmailAddress',
  });

  if (employees.length === 0) return [];
  const employeeMap = new Map(employees.map((e) => [e.id, e]));
  const employeeIds = employees.map((e) => `'${e.id}'`).join(',');

  const absences = await fetchAllPages<iTrentAbsence>(client, '/Absences', {
    $filter: `employeeId in (${employeeIds}) and approvalStatus eq 'Approved' and endDate ge ${today} and startDate le ${futureStr}`,
    $select: 'id,employeeId,absenceType,startDate,endDate,approvalStatus,delegateEmployeeId,notes',
  });

  const records: LeaveRecord[] = [];
  for (const absence of absences) {
    const mapped = mapAbsence(absence, employeeMap);
    if (mapped) records.push(mapped);
  }
  return records;
}
