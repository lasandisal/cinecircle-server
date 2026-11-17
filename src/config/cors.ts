import { ENV } from './env';

/**
 * Origin allow-list shared by Express (CORS) and Socket.IO.
 *
 * Kept in one place so the HTTP API and the WebSocket handshake can never
 * drift apart. Previously this lived in app.ts and blanked trusted any
 * `*.vercel.app` deployment, which let any Vercel-hosted site call the API
 * with the user's cookies attached.
 */

const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/** Production frontend that this API is built for. */
const STATIC_ORIGINS = ['https://cinecircle-client.vercel.app'];

export const isAllowedOrigin = (origin: string | undefined): boolean => {
  // No Origin header: server-to-server calls, curl, same-origin navigations.
  // Browser CORS/CSRF checks are only meaningful when an Origin is present.
  if (!origin) return true;

  if (LOCAL_ORIGIN.test(origin)) return true;
  if (STATIC_ORIGINS.includes(origin)) return true;
  if (ENV.CLIENT_URL && origin === ENV.CLIENT_URL) return true;

  // Extra origins (preview deployments, staging) must be listed explicitly.
  if (ENV.ALLOWED_ORIGINS.includes(origin)) return true;

  return false;
};
