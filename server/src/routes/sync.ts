import { Router, Response } from 'express';
import { requireAuth, requireAdmin, AuthenticatedRequest } from '../middleware/auth';
import { leaveCache } from '../data/leaveCache';
import { runSync } from '../services/syncService';

const router = Router();

/**
 * GET /api/sync/status
 *
 * Returns current sync state, last sync time and record count.
 * Available to any authenticated user.
 */
router.get('/status', requireAuth, (_req: AuthenticatedRequest, res: Response) => {
  res.json(leaveCache.getSyncStatus());
});

/**
 * POST /api/sync/trigger
 *
 * Manually triggers an iTrent sync.
 * Restricted to users with the LeaveAdmin role (see requireAdmin middleware).
 */
router.post('/trigger', requireAdmin, async (_req: AuthenticatedRequest, res: Response) => {
  // Fire-and-forget; response is immediate
  runSync().catch(() => {});
  res.json({ message: 'Sync triggered', startedAt: new Date().toISOString() });
});

export default router;
