import * as React from 'react';
import type { EmployeeLeaveStatus, LeaveStatusResponse } from '@shared/types';
import { RecipientLeaveList } from './RecipientLeaveList';
import { LeaveStatusBanner } from './LeaveStatusBanner';
import { Settings, loadSettings } from './Settings';

/* global Office */

declare const __API_BASE_URL__: string;

type View = 'main' | 'settings';

interface State {
  view: View;
  statuses: EmployeeLeaveStatus[];
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
  signingIn: boolean;
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function getOfficeToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    Office.auth
      .getAccessToken({ allowSignInPrompt: true, allowConsentPrompt: true })
      .then(resolve)
      .catch(reject);
  });
}

// ─── API ─────────────────────────────────────────────────────────────────────

async function fetchLeaveStatuses(
  emails: string[],
  token: string
): Promise<LeaveStatusResponse> {
  const base = typeof __API_BASE_URL__ !== 'undefined' ? __API_BASE_URL__ : '';
  const params = new URLSearchParams({ emails: emails.join(',') });
  const res = await fetch(`${base}/api/leave/status?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<LeaveStatusResponse>;
}

// ─── Recipient extraction ─────────────────────────────────────────────────────

type EmailRecipient = { emailAddress: string; displayName?: string };

function extractReadRecipients(): string[] {
  const item = Office.context.mailbox.item as Office.MessageRead | null;
  if (!item) return [];

  const emails = new Set<string>();

  // Sender
  if (item.from?.emailAddress) emails.add(item.from.emailAddress.toLowerCase());

  // To
  (item.to || []).forEach((r: EmailRecipient) => {
    if (r.emailAddress) emails.add(r.emailAddress.toLowerCase());
  });

  // CC
  (item.cc || []).forEach((r: EmailRecipient) => {
    if (r.emailAddress) emails.add(r.emailAddress.toLowerCase());
  });

  return Array.from(emails);
}

async function extractComposeRecipients(): Promise<string[]> {
  const item = Office.context.mailbox.item as Office.MessageCompose | null;
  if (!item) return [];

  const emails = new Set<string>();

  const getAsync = (
    field: Office.Recipients | undefined
  ): Promise<EmailRecipient[]> =>
    new Promise((resolve) => {
      if (!field) return resolve([]);
      field.getAsync((result) => {
        if (result.status === Office.AsyncResultStatus.Succeeded) {
          resolve(result.value as unknown as EmailRecipient[]);
        } else {
          resolve([]);
        }
      });
    });

  const [toRecips, ccRecips] = await Promise.all([
    getAsync(item.to),
    getAsync(item.cc),
  ]);

  [...toRecips, ...ccRecips].forEach((r) => {
    if (r.emailAddress) emails.add(r.emailAddress.toLowerCase());
  });

  return Array.from(emails);
}

// ─── Component ────────────────────────────────────────────────────────────────

export const App: React.FC = () => {
  const [state, setState] = React.useState<State>({
    view: 'main',
    statuses: [],
    loading: false,
    error: null,
    lastUpdated: null,
    signingIn: false,
  });

  const settings = loadSettings();

  const load = React.useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const token = await getOfficeToken();

      // Detect compose vs read mode
      const item = Office.context.mailbox.item;
      const isCompose =
        item &&
        'to' in item &&
        typeof (item as Office.MessageCompose).to?.getAsync === 'function';

      const emails = isCompose
        ? await extractComposeRecipients()
        : extractReadRecipients();

      // Filter out the current user (they don't need to see their own leave)
      const currentUserEmail =
        Office.context.mailbox.userProfile.emailAddress?.toLowerCase();
      const filteredEmails = emails.filter((e) => e !== currentUserEmail);

      if (filteredEmails.length === 0) {
        setState((s) => ({
          ...s,
          loading: false,
          statuses: [],
          lastUpdated: new Date().toISOString(),
        }));
        return;
      }

      const response = await fetchLeaveStatuses(filteredEmails, token);

      setState((s) => ({
        ...s,
        loading: false,
        statuses: response.results,
        lastUpdated: response.queriedAt,
      }));
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to load leave status.';
      setState((s) => ({ ...s, loading: false, error: msg }));
    }
  }, []);

  React.useEffect(() => {
    if (settings.autoRefreshOnEmailLoad) {
      load();
    }
  }, [load, settings.autoRefreshOnEmailLoad]);

  const { view, statuses, loading, error, lastUpdated, signingIn } = state;

  if (signingIn) {
    return (
      <div className="lv-app">
        <div className="lv-auth">
          <p>Signing in…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="lv-app">
      {/* Header */}
      <div className="lv-header">
        <span style={{ fontSize: 16 }} aria-hidden="true">
          🗓️
        </span>
        <h1>Leave Visibility</h1>
        <div style={{ flex: 1 }} />
        {view === 'main' && (
          <button
            className="lv-refresh-btn"
            onClick={load}
            disabled={loading}
            aria-label="Refresh"
            title="Refresh"
          >
            ↻
          </button>
        )}
        <button
          className="lv-refresh-btn"
          onClick={() =>
            setState((s) => ({
              ...s,
              view: s.view === 'settings' ? 'main' : 'settings',
            }))
          }
          aria-label={view === 'settings' ? 'Back' : 'Settings'}
          title={view === 'settings' ? 'Back' : 'Settings'}
          style={{ marginLeft: 8 }}
        >
          {view === 'settings' ? '←' : '⚙'}
        </button>
      </div>

      {/* Body */}
      <div className="lv-body">
        {view === 'settings' ? (
          <Settings onClose={() => setState((s) => ({ ...s, view: 'main' }))} />
        ) : (
          <>
            {error && <div className="lv-error">{error}</div>}

            {loading ? (
              <div className="lv-loading">
                <span>Checking leave status…</span>
              </div>
            ) : (
              <>
                {statuses.length > 0 && <LeaveStatusBanner statuses={statuses} />}
                <RecipientLeaveList statuses={statuses} />
              </>
            )}

            {!loading && statuses.length === 0 && !error && (
              <div className="lv-empty">
                <p>
                  Click{' '}
                  <button className="lv-refresh-btn" onClick={load}>
                    Refresh
                  </button>{' '}
                  to check leave status for recipients.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {view === 'main' && (
        <div className="lv-footer">
          <span>Powered by iTrent</span>
          {lastUpdated && (
            <span>
              Updated{' '}
              {new Date(lastUpdated).toLocaleTimeString('en-GB', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
          )}
        </div>
      )}
    </div>
  );
};
