import express, { Application, Request, Response } from 'express';
import cors from 'cors';
import apiRouter from './routes';
import { errorHandler } from './middleware/error.middleware';
import { ENV } from './config/env';

// Create the Express application instance
const app: Application = express();

export const isAllowedOrigin = (origin: string | undefined): boolean => {
  if (!origin) return true;
  if (
    origin === 'http://localhost:5173' ||
    origin === 'http://localhost:5000' ||
    origin === 'https://cinecircle-client.vercel.app'
  ) {
    return true;
  }
  if (ENV.CLIENT_URL && origin === ENV.CLIENT_URL) {
    return true;
  }
  if (origin.endsWith('.vercel.app')) {
    return true;
  }
  return false;
};

/**
 * ==========================================
 * GLOBAL MIDDLEWARE CONFIGURATION
 * ==========================================
 * Setup security, cross-origin resource sharing, and body parsers.
 */

/**
 * Enable CORS with credentials support for frontend client URLs
 */
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

// Parse incoming requests with JSON payloads (e.g., req.body)
app.use(express.json());

// Parse incoming requests with url-encoded payloads (form data)
app.use(express.urlencoded({ extended: true }));


/**
 * ==========================================
 * APPLICATION ROUTES
 * ==========================================
 * Define basic root checks and mount feature-specific routers.
 */

/**
 * http://localhost:5000/
 * 
 * GET / HTTP/1.1
 * Host: localhost:5000
 * User-Agent: Mozilla/5.0 (Windows NT...)
 * Accept: application/json
 */
// Root health-check / welcome route
app.get('/', (req: Request, res: Response) => {
  res.json({
    message: 'Welcome to CineCircle API',
    docs: '/api/health',
  });
});



// Mount all main API routes under the '/api' prefix
app.use('/api', apiRouter);


/**
 * ==========================================
 * ERROR HANDLING MIDDLEWARE
 * ==========================================
 * Must be registered AFTER all routes to catch unhandled errors.
 */
app.use(errorHandler);

export default app;