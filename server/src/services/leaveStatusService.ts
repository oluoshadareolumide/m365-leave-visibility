/**
 * Computes leave status for a list of email addresses by combining:
 *  - Cached iTrent sync data (fast path, preferred)
 *  - Live iTrent query fallback (when cache is stale/empty)
 *  - Graph user display names (to fill gaps)
 */

import { leaveCache } from '../data/leaveCache';
import { fetchLeaveForEmails } from './itrentService';
import { getUsersByEmails } from './graphService';
import { config } from '../config';
import { logger } from '../logger';
import type {
  EmployeeLeaveStatus,
  EmployeeLeaveStatusType,
  LeaveRecord,
} from '../shared/types';

const RETURNING_SOON_DAYS = 2;
const UPCOMING_DAYS = 7;

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function computeStatus(
  records: LeaveRecord[],
  now: Date
): { status: EmployeeLeaveStatusType; currentLeave?: LeaveRecord; upcomingLeave?: LeaveRecord } {
  const today = startOfDay(now);

  // Active leave: started ≤ today, ends ≥ today
  const active = records.find((r) => {
    const start = startOfDay(new Date(r.startDate));
    const end = startOfDay(new Date(r.endDate));
    return start <= today && end >= today;
  });

  if (active) {
    const end = startOfDay(new Date(active.endDate));
    const returnDay = addDays(end, 1);
    const threshold = addDays(today, RETURNING_SOON_DAYS);
    const status: EmployeeLeaveStatusType =
      returnDay <= threshold ? 'returningSoon' : 'onLeave';
    return { status, currentLeave: active };
  }

  // Upcoming leave: starts within the window
  const upcoming = records
    .filter((r) => {
      const start = startOfDay(new Date(r.startDate));
      return start > today && start <= addDays(today, UPCOMING_DAYS);
    })
    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];

  return { status: 'available', upcomingLeave: upcoming };
}

export async function getLeaveStatusForEmails(
  emails: string[]
): Promise<EmployeeLeaveStatus[]> {
  const uniqueEmails = [...new Set(emails.map((e) => e.toLowerCase()))];
  const now = new Date();

  // Try cache first
  const recordsByEmail = leaveCache.getByEmails(uniqueEmails);
  const uncached = uniqueEmails.filter(
    (e) => !leaveCache.isFresh() || recordsByEmail.get(e) === undefined
  );

  // Live fallback for uncached/stale emails (skipped in dev — no iTrent)
  if (uncached.length > 0 && !config.devMode) {
    try {
      const liveRecords = await fetchLeaveForEmails(uncached);
      for (const record of liveRecords) {
        const key = record.email.toLowerCase();
        const existing = recordsByEmail.get(key) ?? [];
        existing.push(record);
        recordsByEmail.set(key, existing);
      }
    } catch (err) {
      logger.warn(`Live iTrent query failed, using cache only: ${String(err)}`);
    }
  }

  // Resolve display names from Graph for any emails we have no displayName for.
  // Skipped in dev mode (no Graph credentials) — falls back to the raw email.
  const emailsMissingDisplayName = uniqueEmails.filter((e) => {
    const records = recordsByEmail.get(e) ?? [];
    return records.length === 0 || !records[0].displayName;
  });

  const graphUsers =
    !config.devMode && emailsMissingDisplayName.length > 0
      ? await getUsersByEmails(emailsMissingDisplayName)
      : new Map();

  return uniqueEmails.map((email) => {
    const records = recordsByEmail.get(email) ?? [];
    const { status, currentLeave, upcomingLeave } = computeStatus(records, now);
    const graphUser = graphUsers.get(email);

    const displayName =
      records[0]?.displayName ||
      graphUser?.displayName ||
      email;

    const delegate = currentLeave?.delegate ?? upcomingLeave?.delegate;

    return {
      email,
      displayName,
      status,
      currentLeave,
      upcomingLeave,
      delegate,
      lastUpdated: now.toISOString(),
    } satisfies EmployeeLeaveStatus;
  });
}
