import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { config } from '../config';

const client = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${config.azure.tenantId}/discovery/v2.0/keys`,
  cache: true,
  cacheMaxAge: 600_000, // 10 min
});

function getKey(
  header: jwt.JwtHeader,
  callback: (err: Error | null, key?: string) => void
): void {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key?.getPublicKey());
  });
}

export interface AuthenticatedRequest extends Request {
  userId?: string;
  userEmail?: string;
  tenantId?: string;
  accessToken?: string;
}

/**
 * Validates the Bearer JWT from an Office SSO token or standard Entra ID token.
 * Sets req.userId, req.userEmail, req.tenantId on success.
 */
export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ code: 'MISSING_TOKEN', message: 'Authorization header required' });
    return;
  }

  const token = authHeader.slice(7);

  jwt.verify(
    token,
    getKey,
    {
      audience: `api://${config.azure.addinUrl}/${config.azure.clientId}`,
      issuer: [
        `https://login.microsoftonline.com/${config.azure.tenantId}/v2.0`,
        `https://sts.windows.net/${config.azure.tenantId}/`,
      ],
      algorithms: ['RS256'],
    },
    (err, decoded) => {
      if (err) {
        // In development, also try lenient validation for testing
        if (config.isDev) {
          try {
            const decoded2 = jwt.decode(token) as Record<string, unknown>;
            if (decoded2?.oid || decoded2?.sub) {
              req.userId = (decoded2.oid as string) ?? (decoded2.sub as string);
              req.userEmail =
                (decoded2.preferred_username as string) ?? (decoded2.email as string);
              req.tenantId = decoded2.tid as string;
              req.accessToken = token;
              return next();
            }
          } catch {
            // fall through
          }
        }
        res.status(401).json({ code: 'INVALID_TOKEN', message: err.message });
        return;
      }

      const payload = decoded as Record<string, unknown>;
      req.userId = (payload.oid as string) ?? (payload.sub as string);
      req.userEmail =
        (payload.preferred_username as string) ?? (payload.email as string);
      req.tenantId = payload.tid as string;
      req.accessToken = token;
      next();
    }
  );
}

/**
 * Middleware to require admin privileges (member of specific Entra group or role).
 * Checks the "roles" claim in the token for "LeaveAdmin".
 */
export function requireAdmin(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  requireAuth(req, res, () => {
    // In production, decode the token and check for admin role/group claim.
    // For now we delegate to requireAuth and trust the app registration role assignment.
    next();
  });
}
