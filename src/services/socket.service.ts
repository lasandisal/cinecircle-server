import { Server as SocketIOServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { ENV } from '../config/env';
import { SessionService, SessionServiceError } from './session.service';

/**
 * Socket.IO real-time transport for CineCircle group sessions.
 *
 * Before this was rewritten the handlers did three unsafe things: they trusted a
 * client-supplied `userId`, they used the client-supplied room name verbatim as
 * the Socket.IO room, and they re-broadcast payloads without ever writing to
 * MongoDB. The result was that a socket "vote" or "lock" produced a visible
 * result that did not exist in the database.
 *
 * Now every handler delegates to SessionService - the same code path the REST
 * routes use - and emits only after the database write has succeeded.
 */
export class SocketService {
  private static io: SocketIOServer | null = null;

  static initialize(io: SocketIOServer): void {
    this.io = io;
    io.use(this.authMiddleware);

    io.on('connection', (socket: Socket) => {
      const user = socket.data.user;

      socket.on('session:join', async (payload: any, ack?: (r: any) => void) => {
        try {
          const { joinCode } = payload || {};
          const { session, alreadyPresent } = await SessionService.joinByCode(
            joinCode,
            user.id
          );

          const room = SessionService.roomName(session._id.toString());
          await socket.join(room);

          const votes = await SessionService.getVotes(session._id.toString());

          if (!alreadyPresent) {
            socket.to(room).emit('participant:joined', {
              sessionId: session._id.toString(),
              user: { id: user.id, name: socket.data.name },
            });
          }

          ack?.({
            ok: true,
            sessionId: session._id.toString(),
            joinCode: session.joinCode,
            votes,
          });
        } catch (err: any) {
          const message =
            err instanceof SessionServiceError ? err.message : 'Could not join that room';
          ack?.({ ok: false, error: message });
          socket.emit('session:error', { event: 'session:join', error: message });
        }
      });

      socket.on('vote:cast', async (payload: any, ack?: (r: any) => void) => {
        try {
          const { sessionId, titleId, reaction, strength } = payload || {};
          const result = await SessionService.castVote({
            sessionId,
            userId: user.id,
            titleId,
            reaction,
            strength,
          });

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

      socket.on('session:lock', async (payload: any, ack?: (r: any) => void) => {
        try {
          const { sessionId } = payload || {};
          const result = await SessionService.finalize(sessionId, user.id);

          this.emitToSession(sessionId, 'session:finalized', result);

          ack?.({ ok: true, winnerId: result.winnerId, aiPitch: result.aiPitch });
        } catch (err: any) {
          const message =
            err instanceof SessionServiceError ? err.message : 'Could not finalize the decision';
          ack?.({ ok: false, error: message });
          socket.emit('session:error', { event: 'session:lock', error: message });
        }
      });

      socket.on('session:leave', async (payload: any) => {
        const { sessionId } = payload || {};
        if (!sessionId) return;
        await socket.leave(SessionService.roomName(sessionId));
      });

      socket.on('disconnect', (reason: string) => {
        console.log(`[Socket] user ${user?.id} disconnected (${reason})`);
      });
    });

    console.log('[Socket] Socket.IO initialised with JWT handshake auth');
  }

  /**
   * Verify the JWT supplied on the handshake. Unauthenticated sockets are
   * rejected outright, so a client can no longer join or write to any room
   * simply by guessing a six-character code.
   */
  private static authMiddleware(socket: Socket, next: (err?: Error) => void): void {
    const token =
      socket.handshake.auth?.token ||
      (typeof socket.handshake.query?.token === 'string' ? socket.handshake.query.token : undefined);

    if (!token) {
      return next(new Error('Authentication required'));
    }

    try {
      const decoded = jwt.verify(String(token), ENV.JWT_SECRET) as any;
      socket.data.user = { id: decoded.id, role: decoded.role, email: decoded.email };
      socket.data.name = decoded.email;
      return next();
    } catch {
      return next(new Error('Invalid or expired token'));
    }
  }

  /** Broadcast to a session room. Safe to call before initialisation. */
  static emitToSession(sessionId: string, event: string, payload: any): void {
    if (!this.io) return;
    this.io.to(SessionService.roomName(sessionId)).emit(event, payload);
  }

  static getIO(): SocketIOServer {
    if (!this.io) {
      throw new Error('Socket.IO not initialized');
    }
    return this.io;
  }
}