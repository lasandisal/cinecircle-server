import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import apiRouter from './routes';
import { errorHandler } from './middleware/error.middleware';
import { isAllowedOrigin } from './config/cors';
import { requireTrustedOrigin } from './middleware/origin.middleware';
import { apiLimiter } from './middleware/rateLimit.middleware';

// Create the Express application instance
const app: Application = express();

/**
 * ==========================================
 * GLOBAL MIDDLEWARE CONFIGURATION
 * ==========================================
 */

// Running behind Vercel's proxy: trust exactly one hop so rate limiting and
// `req.ip` see the real client address from X-Forwarded-For.
app.set('trust proxy', 1);

// Security headers. CORP is opened up for the API because the frontend is a
// different origin; CSP/COOP/HSTS still apply as helmet defaults.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
);

// CORS for the allow-listed client origins only. `credentials` is required so
// the browser stores and sends the HttpOnly session cookie.
app.use(
  cors({
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
  })
);

// Reject mutating requests that a foreign page forged (CSRF defence for
// cookie-based sessions).
app.use(requireTrustedOrigin);

// Parse incoming requests with JSON payloads (e.g., req.body).
// 100kb is far more than any endpoint needs and caps abuse.
app.use(express.json({ limit: '100kb' }));

// Parse incoming requests with url-encoded payloads (form data)
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

/**
 * ==========================================
 * APPLICATION ROUTES
 * ==========================================
 */

// Root health-check / welcome route
app.get('/', (req: Request, res: Response) => {
  res.json({
    message: 'Welcome to CineCircle API',
    docs: '/api/health',
  });
});

// Mount all main API routes under the '/api' prefix, behind a broad backstop
// limiter. Individual routers add stricter limits where it matters.
app.use('/api', apiLimiter, apiRouter);

/**
 * ==========================================
 * ERROR HANDLING MIDDLEWARE
 * ==========================================
 * Must be registered AFTER all routes to catch unhandled errors.
 */
app.use(errorHandler);

export default app;
