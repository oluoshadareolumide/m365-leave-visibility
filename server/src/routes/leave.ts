import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { getLeaveStatusForEmails } from '../services/leaveStatusService';
import type { LeaveStatusResponse } from '../shared/types';

const router = Router();

/**
 * GET /api/leave/status?emails=a@b.com,c@d.com
 *
 * Returns leave status for a comma-separated list of email addresses.
 * Maximum 50 addresses per request.
 */
router.get('/status', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const raw = (req.query.emails as string) ?? '';
  if (!raw) {
    res.status(400).json({ code: 'MISSING_EMAILS', message: 'emails query param is required' });
    return;
  }

  const emails = raw
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes('@'));

  if (emails.length === 0) {
    res.status(400).json({ code: 'INVALID_EMAILS', message: 'No valid email addresses provided' });
    return;
  }

  if (emails.length > 50) {
    res.status(400).json({ code: 'TOO_MANY_EMAILS', message: 'Maximum 50 email addresses per request' });
    return;
  }

  const results = await getLeaveStatusForEmails(emails);

  const response: LeaveStatusResponse = {
    results,
    queriedAt: new Date().toISOString(),
  };

  res.json(response);
});

/**
 * GET /api/leave/employee/:email
 *
 * Detailed leave info for a single employee.
 */
router.get('/employee/:email', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  const email = decodeURIComponent(req.params.email).toLowerCase();
  if (!email.includes('@')) {
    res.status(400).json({ code: 'INVALID_EMAIL', message: 'Invalid email address' });
    return;
  }

  const results = await getLeaveStatusForEmails([email]);

  if (results.length === 0) {
    res.status(404).json({ code: 'NOT_FOUND', message: 'Employee not found' });
    return;
  }

  res.json(results[0]);
});

export default router;
