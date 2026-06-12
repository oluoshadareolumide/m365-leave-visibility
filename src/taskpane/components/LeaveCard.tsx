import * as React from 'react';
import type { EmployeeLeaveStatus } from '@shared/types';
import { LEAVE_STATUS_LABELS } from '@shared/constants';

interface LeaveCardProps {
  employee: EmployeeLeaveStatus;
  showUpcomingBadge?: boolean;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export const LeaveCard: React.FC<LeaveCardProps> = ({ employee, showUpcomingBadge }) => {
  const { status, displayName, currentLeave, upcomingLeave, delegate } = employee;

  const activeLeave = currentLeave ?? upcomingLeave;
  const statusLabel = LEAVE_STATUS_LABELS[status];

  return (
    <div className="lv-card">
      <div className={`lv-status-dot lv-status-dot--${status}`} aria-hidden="true" />
      <div className="lv-card-body">
        <div className="lv-card-name">
          {displayName}
          {showUpcomingBadge && status === 'available' && upcomingLeave && (
            <span className="lv-upcoming-badge">Upcoming</span>
          )}
        </div>

        <div className={`lv-card-status lv-card-status--${status}`}>{statusLabel}</div>

        {activeLeave && (
          <div className="lv-card-dates">
            {activeLeave.leaveType} &bull;{' '}
            {formatDate(activeLeave.startDate)} – {formatDate(activeLeave.endDate)}
          </div>
        )}

        {delegate && (status === 'onLeave' || status === 'returningSoon') && (
          <div className="lv-card-delegate">
            Delegate:{' '}
            <a href={`mailto:${delegate.email}`} title={delegate.email}>
              {delegate.displayName}
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
