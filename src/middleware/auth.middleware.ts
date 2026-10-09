import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { ENV } from '../config/env';
import { IAuthRequest, UserRole } from '../types';
import { AppError } from './error.middleware';

interface JwtPayload {
  id: string;
  email: string;
  role: UserRole;
}

/**
 * Authentication Middleware
 * Extracts and verifies JWT from the Authorization header.
 */
export const authenticate = (req: IAuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new AppError('Authentication required. No token provided.', 401));
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, ENV.JWT_SECRET) as JwtPayload;
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };
    next();
  } catch (error: any) {
    if (error.name === 'TokenExpiredError') {
      return next(new AppError('Token has expired. Please sign in again.', 401));
    }
    return next(new AppError('Invalid authentication token.', 401));
  }
};

/**
 * Optional Authentication Middleware
 * Populates req.user if a valid token is provided, but does not block guests.
 */
export const optionalAuthenticate = (req: IAuthRequest, res: Response, next: NextFunction): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, ENV.JWT_SECRET) as JwtPayload;
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };
  } catch {
    // Proceed as unauthenticated guest
  }
  next();
};

/**
 * Role-Based Access Control (RBAC) Middleware
 * Restricts access to specific user roles (e.g. 'admin').
 */
export const requireRole = (...roles: UserRole[]) => {
  return (req: IAuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AppError('Authentication required.', 401));
    }

    if (!roles.includes(req.user.role)) {
      return next(
        new AppError(
          `Forbidden. Access restricted to roles: ${roles.join(', ')}.`,
          403
        )
      );
    }

    next();
  };
};

/**
 * Curator Or Webhook Key Authentication Middleware
 * Allows access if:
 * 1. Header `x-curator-key` matches ENV.CURATOR_WEBHOOK_KEY, OR
 * 2. Authorization header is `Bearer <CURATOR_WEBHOOK_KEY>`, OR
 * 3. Valid Admin JWT token is provided.
 */
export const authenticateCuratorOrKey = (req: IAuthRequest, res: Response, next: NextFunction): void => {
  const curatorKey = (req.headers['x-curator-key'] as string) || (req.headers['x-api-key'] as string);
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : undefined;

  // 1. Check direct webhook secret key
  if (
    (curatorKey && curatorKey === ENV.CURATOR_WEBHOOK_KEY) ||
    (bearerToken && bearerToken === ENV.CURATOR_WEBHOOK_KEY)
  ) {
    req.user = {
      id: 'tasklet-autonomous-curator',
      email: 'curator@tasklet.ai',
      role: 'admin',
    };
    return next();
  }

  // 2. Fallback to standard Admin JWT verification
  if (!bearerToken) {
    return next(new AppError('Unauthorized: Provide x-curator-key header or Admin JWT token', 401));
  }

  try {
    const decoded = jwt.verify(bearerToken, ENV.JWT_SECRET) as JwtPayload;
    if (decoded.role !== 'admin') {
      return next(new AppError('Forbidden: Admin role required for curator actions', 403));
    }
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
    };
    next();
  } catch {
    return next(new AppError('Unauthorized: Invalid token or curator key', 401));
  }
};
