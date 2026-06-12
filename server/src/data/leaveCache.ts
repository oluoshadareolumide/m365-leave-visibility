import type { LeaveRecord, SyncStatus } from '../../../src/shared/types';

const CACHE_TTL_MS = 35 * 60 * 1000; // 35 min (slightly longer than sync interval)

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class LeaveCache {
  // email (lowercase) → current leave records for that employee
  private byEmail = new Map<string, CacheEntry<LeaveRecord[]>>();
  // all approved future/active leave records (populated by sync)
  private allRecords: LeaveRecord[] = [];
  private syncStatus: SyncStatus = {
    lastSyncTime: null,
    state: 'idle',
    recordCount: 0,
  };

  /** Replace all cached records (called after every successful iTrent sync). */
  setAll(records: LeaveRecord[]): void {
    this.allRecords = records;
    this.byEmail.clear();

    const grouped = new Map<string, LeaveRecord[]>();
    for (const r of records) {
      const key = r.email.toLowerCase();
      const list = grouped.get(key) ?? [];
      list.push(r);
      grouped.set(key, list);
    }

    const expiresAt = Date.now() + CACHE_TTL_MS;
    grouped.forEach((list, email) => {
      this.byEmail.set(email, { value: list, expiresAt });
    });
  }

  /** Get all leave records for an email address (may be empty). */
  getByEmail(email: string): LeaveRecord[] {
    const entry = this.byEmail.get(email.toLowerCase());
    if (!entry) return [];
    if (Date.now() > entry.expiresAt) {
      this.byEmail.delete(email.toLowerCase());
      return [];
    }
    return entry.value;
  }

  /** Get leave records for multiple emails in one call. */
  getByEmails(emails: string[]): Map<string, LeaveRecord[]> {
    const result = new Map<string, LeaveRecord[]>();
    for (const email of emails) {
      result.set(email.toLowerCase(), this.getByEmail(email));
    }
    return result;
  }

  getAllRecords(): LeaveRecord[] {
    return this.allRecords;
  }

  updateSyncStatus(update: Partial<SyncStatus>): void {
    this.syncStatus = { ...this.syncStatus, ...update };
  }

  getSyncStatus(): SyncStatus {
    return { ...this.syncStatus };
  }

  /** Returns true if the cache is fresh enough that a full re-sync is not needed. */
  isFresh(): boolean {
    if (!this.syncStatus.lastSyncTime) return false;
    const age = Date.now() - new Date(this.syncStatus.lastSyncTime).getTime();
    return age < CACHE_TTL_MS;
  }
}

// Singleton — shared across all requests in the same process
export const leaveCache = new LeaveCache();
