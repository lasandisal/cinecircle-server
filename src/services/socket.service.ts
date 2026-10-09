import { Server as SocketIOServer, Socket } from 'socket.io';

/**
 * Socket.IO Real-time Service Skeleton for CineCircle Group Sessions
 */
export class SocketService {
  private static io: SocketIOServer | null = null;

  static initialize(io: SocketIOServer): void {
    this.io = io;

    io.on('connection', (socket: Socket) => {
      console.log(`[Socket] User connected: ${socket.id}`);

      socket.on('join_session', ({ sessionCode, userId }) => {
        socket.join(sessionCode);
        console.log(`[Socket] User ${userId} joined session room: ${sessionCode}`);
      });

      socket.on('submit_reaction', ({ sessionCode, voteData }) => {
        // Broadcast reaction to participants
        io.to(sessionCode).emit('reaction_updated', voteData);
      });

      socket.on('lock_pick', ({ sessionCode, finalPick }) => {
        // Broadcast final compromise pick
        io.to(sessionCode).emit('session_finalized', finalPick);
      });

      socket.on('disconnect', () => {
        console.log(`[Socket] User disconnected: ${socket.id}`);
      });
    });
  }

  static getIO(): SocketIOServer {
    if (!this.io) {
      throw new Error('Socket.IO not initialized');
    }
    return this.io;
  }
}
