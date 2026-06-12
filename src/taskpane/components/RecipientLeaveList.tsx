import * as React from 'react';
import type { EmployeeLeaveStatus } from '@shared/types';
import { LeaveCard } from './LeaveCard';

interface RecipientLeaveListProps {
  statuses: EmployeeLeaveStatus[];
}

function partition(statuses: EmployeeLeaveStatus[]) {
  const onLeave: EmployeeLeaveStatus[] = [];
  const upcoming: EmployeeLeaveStatus[] = [];
  const available: EmployeeLeaveStatus[] = [];

  for (const s of statuses) {
    if (s.status === 'onLeave' || s.status === 'returningSoon') {
      onLeave.push(s);
    } else if (s.upcomingLeave) {
      upcoming.push(s);
    } else {
      available.push(s);
    }
  }

  return { onLeave, upcoming, available };
}

export const RecipientLeaveList: React.FC<RecipientLeaveListProps> = ({ statuses }) => {
  const { onLeave, upcoming, available } = partition(statuses);

  if (statuses.length === 0) {
    return (
      <div className="lv-empty">
        <span>No recipients to check.</span>
      </div>
    );
  }

  return (
    <div>
      {onLeave.length > 0 && (
        <>
          <div className="lv-section-title">On Leave</div>
          {onLeave.map((s) => (
            <LeaveCard key={s.email} employee={s} />
          ))}
        </>
      )}

      {upcoming.length > 0 && (
        <>
          <div className="lv-section-title">Upcoming Leave</div>
          {upcoming.map((s) => (
            <LeaveCard key={s.email} employee={s} showUpcomingBadge />
          ))}
        </>
      )}

      {available.length > 0 && onLeave.length === 0 && upcoming.length === 0 && (
        <div className="lv-empty">
          <span>All recipients are available.</span>
        </div>
      )}

      {available.length > 0 && (onLeave.length > 0 || upcoming.length > 0) && (
        <>
          <div className="lv-section-title">Available</div>
          {available.map((s) => (
            <LeaveCard key={s.email} employee={s} />
          ))}
        </>
      )}
    </div>
  );
};
