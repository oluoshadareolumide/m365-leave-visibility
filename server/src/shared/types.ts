// NOTE: This mirrors src/shared/types.ts (the add-in's copy). Keep the two in
// sync — they are the API contract between the Office add-in and this backend.
// Duplicated rather than cross-imported so the server stays independently
// buildable and deployable.

export type EmployeeLeaveStatusType = 'onLeave' | 'returningSoon' | 'available';
export type LeaveApprovalStatus = 'approved' | 'pending' | 'cancelled';
export type SyncState = 'idle' | 'syncing' | 'error';

export interface DelegateContact {
  email: string;
  displayName: string;
  phone?: string;
}

export interface LeaveRecord {
  id: string;
  employeeId: string;
  email: string;
  displayName: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  approvalStatus: LeaveApprovalStatus;
  delegate?: DelegateContact;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface EmployeeLeaveStatus {
  email: string;
  displayName: string;
  status: EmployeeLeaveStatusType;
  currentLeave?: LeaveRecord;
  upcomingLeave?: LeaveRecord;
  delegate?: DelegateContact;
  lastUpdated: string;
}

export interface LeaveStatusResponse {
  results: EmployeeLeaveStatus[];
  queriedAt: string;
}

export interface SyncStatus {
  lastSyncTime: string | null;
  state: SyncState;
  recordCount: number;
  error?: string;
}

export interface AppSettings {
  returningSoonThresholdDays: number;
  upcomingLeaveWindowDays: number;
  autoRefreshOnEmailLoad: boolean;
  enableTeamsPresenceSync: boolean;
  privacyMode: boolean;
}

export interface iTrentEmployee {
  id: string;
  forename: string;
  surname: string;
  emailAddress: string;
  workEmailAddress?: string;
  position?: string;
  department?: string;
}

export interface iTrentAbsence {
  id: string;
  employeeId: string;
  absenceType: string;
  startDate: string;
  endDate: string;
  numberOfDays: number;
  status: string;
  approvalStatus: string;
  approvedBy?: string;
  delegateEmployeeId?: string;
  notes?: string;
}

export interface GraphUser {
  id: string;
  displayName: string;
  mail: string;
  userPrincipalName: string;
  jobTitle?: string;
  department?: string;
}

export interface GraphPresenceUpdate {
  availability:
    | 'Available'
    | 'Away'
    | 'BeRightBack'
    | 'Busy'
    | 'DoNotDisturb'
    | 'Offline'
    | 'PresenceUnknown';
  activity: string;
  statusMessage?: string;
}

export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
}
