/**
 * Notification service.
 *
 * Handles:
 *  - Detecting leave records that are newly starting or ending today
 *  - Sending Teams messages to managers / configured channels
 *  - Optionally setting Teams presence and OOF replies via Graph
 */

import { leaveCache } from '../data/leaveCache';
import { getUserByEmail, setUserPresenceStatusMessage, setOofSettings, sendTeamsNotification } from './graphService';
import { config } from '../config';
import { logger } from '../logger';
import type { LeaveRecord } from '../../../src/shared/types';

function isToday(dateStr: string): boolean {
  const date = new Date(dateStr);
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

function isTomorrow(dateStr: string): boolean {
  const date = new Date(dateStr);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return (
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Process leave records for today:
 *  - For any record starting today, set Teams presence message + OOF (if enabled)
 *  - For any record ending today, clear the status
 */
export async function processLeaveNotificationsForToday(): Promise<void> {
  const records = leaveCache.getAllRecords();
  const startingToday = records.filter((r) => isToday(r.startDate));
  const endingToday = records.filter((r) => isToday(r.endDate));

  logger.info(
    `Notification sweep: ${startingToday.length} starting today, ${endingToday.length} ending today`
  );

  await Promise.all([
    ...startingToday.map((r) => handleLeaveStart(r)),
    ...endingToday.map((r) => handleLeaveEnd(r)),
  ]);
}

async function handleLeaveStart(record: LeaveRecord): Promise<void> {
  const user = await getUserByEmail(record.email);
  if (!user) return;

  const delegateText = record.delegate
    ? ` For urgent matters, contact ${record.delegate.displayName} (${record.delegate.email}).`
    : '';

  const statusMessage = `I am on ${record.leaveType} until ${formatDate(record.endDate)}.${delegateText}`;

  // Set Teams presence status message
  const returnDate = new Date(record.endDate);
  returnDate.setDate(returnDate.getDate() + 1);

  await setUserPresenceStatusMessage(user.id, statusMessage, returnDate);
  logger.info(`Set Teams status for ${record.email}: "${statusMessage}"`);

  // Optionally set OOF via Graph (requires MailboxSettings.ReadWrite)
  // await setOofSettings(user.id, true, record.startDate, record.endDate, statusMessage);
}

async function handleLeaveEnd(record: LeaveRecord): Promise<void> {
  const user = await getUserByEmail(record.email);
  if (!user) return;

  // Clear presence status message
  await setUserPresenceStatusMessage(user.id, '');
  logger.info(`Cleared Teams status for ${record.email} (leave ended)`);
}

/**
 * Send a leave-start notification to a specific user (e.g. a manager).
 */
export async function notifyManagerOfLeave(
  managerEmail: string,
  employeeName: string,
  record: LeaveRecord,
  notifierUserId: string
): Promise<void> {
  const manager = await getUserByEmail(managerEmail);
  if (!manager) return;

  const msg =
    `📅 Leave notification: ${employeeName} is on ${record.leaveType} ` +
    `from ${formatDate(record.startDate)} to ${formatDate(record.endDate)}.` +
    (record.delegate ? ` Delegate: ${record.delegate.displayName}.` : '');

  await sendTeamsNotification(manager.id, notifierUserId, msg);
}

/**
 * Process records that will start tomorrow — used for advance notifications.
 */
export async function processAdvanceNotifications(notifierUserId: string): Promise<void> {
  const records = leaveCache.getAllRecords();
  const startingTomorrow = records.filter((r) => isTomorrow(r.startDate));

  logger.info(`Advance notifications: ${startingTomorrow.length} starting tomorrow`);

  // Example: notify the HR service account or a teams channel
  // In a real deployment, query the employee's manager via Graph and notify them
  await Promise.all(
    startingTomorrow.map(async (r) => {
      logger.info(`Tomorrow: ${r.displayName} starts ${r.leaveType} leave`);
      // await notifyManagerOfLeave(managerEmail, r.displayName, r, notifierUserId);
    })
  );
}
