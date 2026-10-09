import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import app from './app';
import { ENV } from './config/env';
import { connectDB } from './config/db';
import { SocketService } from './services/socket.service';

const server = http.createServer(app);

const io = new SocketIOServer(server, {
  cors: {
    origin: ENV.CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

SocketService.initialize(io);

const startServer = async () => {
  // Connect to MongoDB
  await connectDB();

  server.listen(ENV.PORT, () => {
    console.log(`[Server] CineCircle Backend is running on http://localhost:${ENV.PORT}`);
    console.log(`[Server] Environment: ${ENV.NODE_ENV}`);
  });
};

startServer().catch((err) => {
  console.error('[Server] Failed to start:', err);
});
