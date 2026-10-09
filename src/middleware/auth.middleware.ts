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
