import { NextFunction, Request, Response } from 'express';
import { isAllowedOrigin } from '../config/cors';
import { AppError } from './error.middleware';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-based sessions.
 *
 * CORS stops a foreign page from *reading* our responses, but it does not
 * stop the browser from *sending* a state-changing request with cookies
 * attached. Checking Origin on every mutating request closes that gap.
 *
 * Requests with no Origin header (curl, server-to-server, health checks) are
 * allowed through: browsers always send Origin on cross-site POST/PUT/PATCH/
 * DELETE, which is exactly the case we need to reject.
 */
export const requireTrustedOrigin = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (SAFE_METHODS.has(req.method)) return next();

  const origin = req.headers.origin;
  if (!origin) return next();

  if (!isAllowedOrigin(origin)) {
    return next(new AppError('Request origin is not allowed.', 403));
  }

  next();
};
