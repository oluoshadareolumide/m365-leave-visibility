import * as React from 'react';
import type { EmployeeLeaveStatus } from '@shared/types';

interface LeaveStatusBannerProps {
  statuses: EmployeeLeaveStatus[];
}

export const LeaveStatusBanner: React.FC<LeaveStatusBannerProps> = ({ statuses }) => {
  const onLeaveCount = statuses.filter(
    (s) => s.status === 'onLeave' || s.status === 'returningSoon'
  ).length;

  if (onLeaveCount === 0) return null;

  return (
    <div
      style={{
        background: '#fff4ce',
        border: '1px solid #c8a600',
        borderRadius: 4,
        padding: '8px 12px',
        marginBottom: 10,
        fontSize: 12,
        color: '#323130',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
      }}
      role="alert"
    >
      <span aria-hidden="true">⚠️</span>
      <span>
        {onLeaveCount === 1
          ? '1 recipient is currently on leave.'
          : `${onLeaveCount} recipients are currently on leave.`}
      </span>
    </div>
  );
};
