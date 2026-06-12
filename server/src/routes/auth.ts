/**
 * Auth routes.
 *
 * /api/auth/token  – exchanges an Office SSO bootstrap token (via OBO)
 *                    for a Graph token scoped to User.Read.
 *                    The add-in calls this once per session to warm up the
 *                    OBO token cache and validate that the user has access.
 */
import { Router, Response } from 'express';
import { requireAuth, AuthenticatedRequest } from '../middleware/auth';
import { exchangeTokenOBO } from '../services/graphService';

const router = Router();

router.post('/token', requireAuth, async (req: AuthenticatedRequest, res: Response) => {
  if (!req.accessToken) {
    res.status(401).json({ code: 'NO_TOKEN' });
    return;
  }

  try {
    const graphToken = await exchangeTokenOBO(
      req.accessToken,
      'https://graph.microsoft.com/User.Read'
    );
    // Return just enough to confirm success — never log or store Graph tokens
    res.json({ ok: true, expiresIn: 3600 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Token exchange failed';
    res.status(401).json({ code: 'OBO_FAILED', message: msg });
  }
});

/**
 * GET /api/auth/me
 *
 * Returns the current user's identity from the validated JWT claims.
 */
router.get('/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
  res.json({
    userId: req.userId,
    email: req.userEmail,
    tenantId: req.tenantId,
  });
});

export default router;
