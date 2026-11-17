import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import app from './app';
import { ENV } from './config/env';
import { isAllowedOrigin } from './config/cors';
import prisma from './config/prisma';
import { SocketService } from './services/socket.service';
import { SeedService } from './services/seed.service';
import { rateLimitStoreKind } from './middleware/rateLimit.middleware';


/**
 * ==========================================
 * STEP 1: SERVER & WEBSOCKET INITIALIZATION
 * ==========================================
 * Create an HTTP server using the Express app and 
 * attach Socket.io for real-time communication.
 */
const server = http.createServer(app);

/**
 * Configure Socket.io with allowed origins and WebSocket transport
 */
const io = new SocketIOServer(server, {
  cors: {
    origin: (origin, callback) => {
      if (isAllowedOrigin(origin)) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// Initialize global socket event listeners and handlers
SocketService.initialize(io);

let isInitialized = false;
export const initServer = async (): Promise<void> => {
  if (isInitialized) return;
  isInitialized = true;
  await prisma.$connect();
  await SeedService.autoSeedIfEmpty();
};

/**
 * ==========================================
 * STEP 2: ASYNCHRONOUS STARTUP ROUTINE
 * ==========================================
 * Handles database connection, initial seeding, 
 * and binds the server to the configured port.
 */
const startServer = async (): Promise<void> => {
  try {
    await initServer();
    console.log('[Server] Database connected successfully.');

    server.listen(ENV.PORT, () => {
      console.log(`[Server] CineCircle Backend is running on http://localhost:${ENV.PORT}`);
      console.log(`[Server] Environment: ${ENV.NODE_ENV}`);
      console.log(
        `[Server] Rate limiting store: ${
          rateLimitStoreKind === 'redis'
            ? 'Upstash Redis (shared across instances)'
            : 'in-process memory (per instance)'
        }`
      );
    });
  } catch (error) {
    console.error('[Server] Initialization error during startup:', error);
    process.exit(1);
  }
};

/**
 * ==========================================
 * STEP 3: EXECUTION INITIATION
 * ==========================================
 * In local environment, start the standalone listener.
 * On Vercel, server is exported for the serverless/WebSocket runtime.
 */
if (!process.env.VERCEL) {
  startServer().catch((err) => {
    console.error('[Server] Failed to start:', err);
  });
}

export default server;
