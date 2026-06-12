import * as React from 'react';
import type { AppSettings } from '@shared/types';
import { DEFAULT_SETTINGS } from '@shared/constants';

const STORAGE_KEY = 'lv_settings';

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    // ignore
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s: AppSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

interface SettingsProps {
  onClose: () => void;
}

export const Settings: React.FC<SettingsProps> = ({ onClose }) => {
  const [settings, setSettings] = React.useState<AppSettings>(loadSettings);

  function update<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((prev) => {
      const next = { ...prev, [key]: value };
      saveSettings(next);
      return next;
    });
  }

  return (
    <div className="lv-settings">
      <div className="lv-settings-row">
        <div>
          <div className="lv-settings-label">Auto-refresh on email load</div>
          <div className="lv-settings-desc">
            Automatically fetch leave status when an email is opened
          </div>
        </div>
        <input
          type="checkbox"
          checked={settings.autoRefreshOnEmailLoad}
          onChange={(e) => update('autoRefreshOnEmailLoad', e.target.checked)}
          aria-label="Auto-refresh on email load"
        />
      </div>

      <div className="lv-settings-row">
        <div>
          <div className="lv-settings-label">"Returning soon" threshold (days)</div>
          <div className="lv-settings-desc">
            Highlight employees returning within this many days
          </div>
        </div>
        <input
          type="number"
          min={1}
          max={14}
          value={settings.returningSoonThresholdDays}
          onChange={(e) => update('returningSoonThresholdDays', Number(e.target.value))}
          style={{ width: 48, textAlign: 'center' }}
          aria-label="Returning soon threshold"
        />
      </div>

      <div className="lv-settings-row">
        <div>
          <div className="lv-settings-label">Upcoming leave window (days)</div>
          <div className="lv-settings-desc">
            Show upcoming leave starting within this many days
          </div>
        </div>
        <input
          type="number"
          min={1}
          max={30}
          value={settings.upcomingLeaveWindowDays}
          onChange={(e) => update('upcomingLeaveWindowDays', Number(e.target.value))}
          style={{ width: 48, textAlign: 'center' }}
          aria-label="Upcoming leave window"
        />
      </div>

      <div className="lv-settings-row">
        <div>
          <div className="lv-settings-label">Sync leave to Teams presence</div>
          <div className="lv-settings-desc">
            Update Microsoft Teams presence for users on leave (requires admin consent)
          </div>
        </div>
        <input
          type="checkbox"
          checked={settings.enableTeamsPresenceSync}
          onChange={(e) => update('enableTeamsPresenceSync', e.target.checked)}
          aria-label="Sync leave to Teams presence"
        />
      </div>

      <div className="lv-settings-row">
        <div>
          <div className="lv-settings-label">Privacy mode</div>
          <div className="lv-settings-desc">
            Hide leave dates — show only on-leave / available status
          </div>
        </div>
        <input
          type="checkbox"
          checked={settings.privacyMode}
          onChange={(e) => update('privacyMode', e.target.checked)}
          aria-label="Privacy mode"
        />
      </div>

      <div style={{ marginTop: 16, textAlign: 'right' }}>
        <button
          onClick={onClose}
          style={{
            background: '#0078d4',
            color: '#fff',
            border: 'none',
            borderRadius: 2,
            padding: '6px 16px',
            cursor: 'pointer',
            fontSize: 13,
          }}
        >
          Done
        </button>
      </div>
    </div>
  );
};

export { loadSettings };
