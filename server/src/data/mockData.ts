/**
 * Sample leave data for local development.
 *
 * Only used when DEV_MODE=true and iTrent is not configured (see syncService).
 * Dates are relative to "today" so the statuses always stay realistic:
 *   - Alice  : On Leave (annual)
 *   - Dave   : On Leave (sick) + delegate
 *   - Bob    : Returning Soon (ends tomorrow)
 *   - Carol  : Upcoming leave (starts in 3 days)
 *   - Erin   : Available (only a past leave on record)
 *
 * The recipient list in src/taskpane/devMockOffice.ts intentionally matches
 * these email addresses so the taskpane shows meaningful results.
 */
import type { LeaveRecord } from '../shared/types';

function isoDay(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function record(partial: Omit<LeaveRecord, 'approvalStatus' | 'createdAt' | 'updatedAt'>): LeaveRecord {
  const now = new Date().toISOString();
  return {
    ...partial,
    approvalStatus: 'approved',
    createdAt: now,
    updatedAt: now,
  };
}

export function getMockLeaveRecords(): LeaveRecord[] {
  return [
    record({
      id: 'mock-1',
      employeeId: 'E001',
      email: 'alice.smith@contoso.com',
      displayName: 'Alice Smith',
      leaveType: 'Annual Leave',
      startDate: isoDay(-3),
      endDate: isoDay(5),
    }),
    record({
      id: 'mock-2',
      employeeId: 'E002',
      email: 'bob.jones@contoso.com',
      displayName: 'Bob Jones',
      leaveType: 'Annual Leave',
      startDate: isoDay(-4),
      endDate: isoDay(1),
    }),
    record({
      id: 'mock-3',
      employeeId: 'E003',
      email: 'carol.white@contoso.com',
      displayName: 'Carol White',
      leaveType: 'Annual Leave',
      startDate: isoDay(3),
      endDate: isoDay(10),
    }),
    record({
      id: 'mock-4',
      employeeId: 'E004',
      email: 'dave.brown@contoso.com',
      displayName: 'Dave Brown',
      leaveType: 'Sick Leave',
      startDate: isoDay(-1),
      endDate: isoDay(2),
      delegate: {
        email: 'frank.green@contoso.com',
        displayName: 'Frank Green',
      },
    }),
    record({
      id: 'mock-5',
      employeeId: 'E005',
      email: 'erin.davis@contoso.com',
      displayName: 'Erin Davis',
      leaveType: 'Annual Leave',
      startDate: isoDay(-10),
      endDate: isoDay(-5),
    }),
  ];
}
