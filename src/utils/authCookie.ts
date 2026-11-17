import { CookieOptions, Response } from 'express';
import { ENV } from '../config/env';

/**
 * Session cookie helpers.
 *
 * The JWT is delivered as an HttpOnly cookie so page scripts (and therefore
 * any injected XSS payload) cannot read it. The browser still attaches it to
 * every request to the API host, and to the Socket.IO handshake.
 *
 * SameSite policy:
 *  - development: `lax` over http://localhost (frontend 5173 -> backend 5000
 *    is same-site, different port).
 *  - production: `none` + `secure` + `partitioned`. vercel.app is on the
 *    public suffix list, so client and server are cross-site. `partitioned`
 *    (CHIPS) lets Chrome keep the cookie when the request is still cross-origin
 *    (Socket.IO). Same-origin `/api` rewrites on the frontend make the cookie
 *    first-party for REST.
 */

const DURATION_UNITS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export const parseDurationMs = (value: string | undefined, fallbackMs: number): number => {
  if (!value) return fallbackMs;
  const match = /^(\d+)\s*([smhd])$/i.exec(value.trim());
  if (!match) return fallbackMs;
  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const ms = amount * (DURATION_UNITS[unit] || 0);
  return ms > 0 ? ms : fallbackMs;
};

const isProduction = (): boolean => ENV.NODE_ENV === 'production';

const baseCookieOptions = (): CookieOptions => {
  const production = isProduction();
  return {
    httpOnly: true,
    secure: production,
    sameSite: production ? 'none' : 'lax',
    path: '/',
    // CHIPS: required for Chrome to accept a cross-site session cookie.
    ...(production ? { partitioned: true } : {}),
  };
};

export const AUTH_COOKIE_NAME = ENV.AUTH_COOKIE_NAME;

export const setAuthCookie = (res: Response, token: string): void => {
  res.cookie(AUTH_COOKIE_NAME, token, {
    ...baseCookieOptions(),
    maxAge: parseDurationMs(ENV.JWT_EXPIRES_IN, 7 * DURATION_UNITS.d),
  });
};

export const clearAuthCookie = (res: Response): void => {
  // clearCookie only removes the cookie when the attributes match the ones
  // used to set it, so reuse the same options (minus maxAge).
  res.clearCookie(AUTH_COOKIE_NAME, baseCookieOptions());
};

/**
 * Read the session token out of a raw `Cookie` header.
 *
 * Used by the Express auth middleware and by the Socket.IO handshake, which
 * has no cookie-parser middleware available.
 */
export const readTokenFromCookieHeader = (cookieHeader?: string): string | undefined => {
  if (!cookieHeader) return undefined;

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim();
    if (name !== AUTH_COOKIE_NAME) continue;

    const rawValue = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return undefined;
};

/** Extract a bearer token from the Authorization header, if present. */
export const readTokenFromAuthHeader = (authorization?: string): string | undefined => {
  if (!authorization || !authorization.startsWith('Bearer ')) return undefined;
  const token = authorization.slice('Bearer '.length).trim();
  return token || undefined;
};
