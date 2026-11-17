import { NextFunction, Request, Response } from 'express';
import { ZodType } from 'zod';
import { AppError } from './error.middleware';

/**
 * Validate (and sanitise) `req.body` against a Zod schema.
 *
 * On success the parsed value replaces req.body, so controllers receive
 * trimmed strings, coerced numbers and no unexpected keys.
 */
export const validateBody = <T>(schema: ZodType<T>) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body ?? {});

    if (!result.success) {
      const issue = result.error.issues[0];
      const field = issue?.path?.length ? issue.path.join('.') : null;
      const message = issue?.message || 'Invalid request body.';
      return next(new AppError(field ? `${field}: ${message}` : message, 400));
    }

    req.body = result.data;
    next();
  };
};
