export const RETURNING_SOON_THRESHOLD_DAYS = 2;
export const UPCOMING_LEAVE_WINDOW_DAYS = 7;
export const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

export const ADDIN_URL =
  typeof window !== 'undefined' && (window as Window & { ADDIN_URL?: string }).ADDIN_URL
    ? (window as Window & { ADDIN_URL?: string }).ADDIN_URL!
    : 'https://localhost:3000';

export const API_BASE_URL =
  typeof window !== 'undefined' && (window as Window & { API_BASE_URL?: string }).API_BASE_URL
    ? (window as Window & { API_BASE_URL?: string }).API_BASE_URL!
    : 'https://localhost:3001';

export const GRAPH_SCOPES = [
  'openid',
  'profile',
  'email',
  'User.Read',
];

export const LEAVE_STATUS_COLORS = {
  onLeave: '#D13438',
  returningSoon: '#F7630C',
  available: '#107C10',
} as const;

export const LEAVE_STATUS_LABELS = {
  onLeave: 'On Leave',
  returningSoon: 'Returning Soon',
  available: 'Available',
} as const;

export const DEFAULT_SETTINGS = {
  returningSoonThresholdDays: RETURNING_SOON_THRESHOLD_DAYS,
  upcomingLeaveWindowDays: UPCOMING_LEAVE_WINDOW_DAYS,
  autoRefreshOnEmailLoad: true,
  enableTeamsPresenceSync: false,
  privacyMode: false,
};

export const ADDON_DISPLAY_NAME = 'Leave Visibility';
export const ADDON_VERSION = '1.0.0';
