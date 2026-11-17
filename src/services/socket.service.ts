import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { ENV } from '../config/env';
import { readTokenFromCookieHeader } from '../utils/authCookie';
import { SessionService, SessionServiceError } from './session.service';

/**
 * Socket.IO real-time transport for CineCircle group sessions.
 * 
 * Manages WebSocket connections, JWT authentication handshakes, 
 * and real-time room communication for group movie selection sessions.
 */
export class SocketService {
  // Holds the active Socket.IO server instance globally within this class
  private static io: SocketIOServer | null = null;
  private static onlineUsers = new Map<string, Set<string>>();

  /**
   * INITIALIZATION METHOD
   * Called from server.ts to boot up the real-time socket server.
   */
  static initialize(io: SocketIOServer): void {
    this.io = io;

    // STEP 1: Apply global authentication middleware to all incoming connections
    io.use(this.authMiddleware);

    // STEP 2: Listen for successful client connection handshakes
    io.on('connection', (socket: Socket) => {
      // Extract user info safely attached during the auth middleware step
      const user = socket.data.user;
      const userSockets = this.onlineUsers.get(user.id) ?? new Set<string>();
      const wasOnline = userSockets.size > 0;
      userSockets.add(socket.id);
      this.onlineUsers.set(user.id, userSockets);

      if (!wasOnline) {
        io.emit('presence:online', { userId: user.id });
      }

      /**
       * EVENT: Join a group session room using a 6-character join code
       */
      socket.on('session:join', async (payload: any, ack?: (r: any) => void) => {
        try {
          const { joinCode } = payload || {};

          // Call SessionService (same logic as REST API) to join and validate in MongoDB
          const { session, alreadyPresent } = await SessionService.joinByCode(
            joinCode,
            user.id
          );

          // Get the standardized room name and make the socket join it
          const room = SessionService.roomName(session._id.toString());
          await socket.join(room);

          // Fetch current votes for the session
          const votes = await SessionService.getVotes(session._id.toString());

          // If the user wasn't already in the room, notify other participants
          if (!alreadyPresent) {
            socket.to(room).emit('participant:joined', {
              sessionId: session._id.toString(),
              user: { id: user.id, name: socket.data.name },
            });
          }

          // Send success acknowledgment back to the specific client who requested it
          ack?.({
            ok: true,
            sessionId: session._id.toString(),
            joinCode: session.joinCode,
            votes,
          });
        } catch (err: any) {
          // Handle service errors gracefully and notify the client
          const message =
            err instanceof SessionServiceError ? err.message : 'Could not join that room';
          ack?.({ ok: false, error: message });
          socket.emit('session:error', { event: 'session:join', error: message });
        }
      });

      /**
       * EVENT: Cast or update a movie vote in real-time
       */
      socket.on('vote:cast', async (payload: any, ack?: (r: any) => void) => {
        try {
          const { sessionId, titleId, reaction, strength } = payload || {};

          // Process the vote through the database session service first
          const result = await SessionService.castVote({
            sessionId,
            userId: user.id,
            titleId,
            reaction,
            strength,
          });

          // Broadcast the updated votes to EVERYONE in the session room instantly
          this.emitToSession(sessionId, 'vote:updated', {
            sessionId,
            votes: result.votes,
            vote: result.vote,
          });

          ack?.({ ok: true, vote: result.vote });
        } catch (err: any) {
          const message =
            err instanceof SessionServiceError ? err.message : 'Could not record your vote';
          ack?.({ ok: false, error: message });
          socket.emit('session:error', { event: 'vote:cast', error: message });
        }
      });

      /**
       * EVENT: Finalize/lock the session decision (choose the winning movie)
       */
      socket.on('session:lock', async (payload: any, ack?: (r: any) => void) => {
        try {
          const { sessionId } = payload || {};
          const result = await SessionService.finalize(sessionId, user.id);

          // Broadcast the finalized session result and AI pitch to all room members
          this.emitToSession(sessionId, 'session:finalized', result);

          ack?.({ ok: true, winnerId: result.winnerId, aiPitch: result.aiPitch });
        } catch (err: any) {
          const message =
            err instanceof SessionServiceError ? err.message : 'Could not finalize the decision';
          ack?.({ ok: false, error: message });
          socket.emit('session:error', { event: 'session:lock', error: message });
        }
      });

      /**
       * EVENT: Leave a session room manually
       */
      socket.on('session:leave', async (payload: any) => {
        const { sessionId } = payload || {};
        if (!sessionId) return;
        await socket.leave(SessionService.roomName(sessionId));
      });

      /**
       * EVENT: Client disconnects from the socket server
       */
      socket.on('disconnect', (reason: string) => {
        const activeSockets = this.onlineUsers.get(user.id);
        activeSockets?.delete(socket.id);
        if (activeSockets && activeSockets.size === 0) {
          this.onlineUsers.delete(user.id);
          io.emit('presence:offline', { userId: user.id });
        }
        console.log(`[Socket] user ${user?.id} disconnected (${reason})`);
      });
    });

    console.log('[Socket] Socket.IO initialised with JWT handshake auth');
  }

  /**
   * AUTHENTICATION MIDDLEWARE
   * Intercepts incoming socket connections to verify the JWT.
   *
   * Browsers send the HttpOnly session cookie on the WebSocket handshake, so
   * page scripts never need to hold the token. `auth.token` and `?token=`
   * remain supported for non-browser clients.
   */
  private static authMiddleware(socket: Socket, next: (err?: Error) => void): void {
    const token =
      readTokenFromCookieHeader(socket.handshake.headers.cookie) ||
      socket.handshake.auth?.token ||
      (typeof socket.handshake.query?.token === 'string' ? socket.handshake.query.token : undefined);

    // Reject connection if no token is provided
    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      // Verify token authenticity and expiration
      const decoded = jwt.verify(String(token), ENV.JWT_SECRET) as any;

      // Attach user details directly to the socket instance for later use
      socket.data.user = { id: decoded.id, role: decoded.role, email: decoded.email };
      socket.data.name = decoded.email;

      return next(); // Allow connection to proceed
    } catch {
      return next(new Error('Invalid or expired token')); // Reject connection
    }
  }

  /**
   * HELPER: Broadcast messages to all clients inside a specific session room.
   * Safe to call from anywhere in the application.
   */
  static emitToSession(sessionId: string, event: string, payload: any): void {
    if (!this.io) return;
    this.io.to(SessionService.roomName(sessionId)).emit(event, payload);
  }

  /**
   * HELPER: Retrieve the raw IO server instance. Throws an error if uninitialized.
   */
  static getIO(): SocketIOServer {
    if (!this.io) {
      throw new Error('Socket.IO not initialized');
    }
    return this.io;
  }
}