import cron from 'node-cron';
import { syncFromITrent } from './itrentService';
import { leaveCache } from '../data/leaveCache';
import { processLeaveNotificationsForToday, processAdvanceNotifications } from './notificationService';
import { config } from '../config';
import { logger } from '../logger';

let scheduledTask: cron.ScheduledTask | null = null;

export async function runSync(): Promise<void> {
  if (leaveCache.getSyncStatus().state === 'syncing') {
    logger.info('Sync already in progress, skipping');
    return;
  }

  leaveCache.updateSyncStatus({ state: 'syncing' });
  const startTime = Date.now();

  try {
    logger.info('Starting iTrent data sync...');
    const result = await syncFromITrent();

    leaveCache.setAll(result.records);
    leaveCache.updateSyncStatus({
      state: 'idle',
      lastSyncTime: new Date().toISOString(),
      recordCount: result.records.length,
      error: undefined,
    });

    logger.info(
      `Sync complete in ${Date.now() - startTime}ms: ` +
      `${result.employeeCount} employees, ${result.absenceCount} absences, ` +
      `${result.records.length} active/upcoming leave records`
    );

    // Process notifications after sync
    await processLeaveNotificationsForToday();

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Sync failed: ${message}`);
    leaveCache.updateSyncStatus({ state: 'error', error: message });
  }
}

export function startSyncScheduler(): void {
  if (!cron.validate(config.sync.cronExpression)) {
    logger.error(`Invalid cron expression: ${config.sync.cronExpression}`);
    return;
  }

  scheduledTask = cron.schedule(config.sync.cronExpression, () => {
    runSync().catch((err) => logger.error(`Scheduled sync error: ${String(err)}`));
  });

  logger.info(`Sync scheduler started (${config.sync.cronExpression})`);

  // Run immediately on startup
  runSync().catch((err) => logger.warn(`Initial sync failed: ${String(err)}`));
}

export function stopSyncScheduler(): void {
  scheduledTask?.stop();
  scheduledTask = null;
}
