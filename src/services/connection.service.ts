import prisma from '../config/prisma';

export type ConnectionRequestStatus = {
  status: 'none' | 'pending_sent' | 'pending_received' | 'accepted';
  requestId?: string;
};

export class ConnectionError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConnectionService {
  static async getStatus(viewerId: string | undefined, targetId: string): Promise<ConnectionRequestStatus> {
    if (!viewerId || viewerId === targetId) return { status: 'none' };
    const request = await prisma.connectionRequest.findFirst({
      where: {
        OR: [
          { senderId: viewerId, recipientId: targetId },
          { senderId: targetId, recipientId: viewerId },
        ],
      },
    });
    if (!request) return { status: 'none' };
    if (request.status === 'accepted') return { status: 'accepted', requestId: request.id };
    if (request.status !== 'pending') return { status: 'none' };
    return {
      status: request.senderId === viewerId ? 'pending_sent' : 'pending_received',
      requestId: request.id,
    };
  }

  static async countAccepted(userId: string): Promise<number> {
    return prisma.connectionRequest.count({
      where: {
        status: 'accepted',
        OR: [{ senderId: userId }, { recipientId: userId }],
      },
    });
  }

  static async request(senderId: string, recipientId: string) {
    if (senderId === recipientId) throw new ConnectionError('You cannot connect with yourself');
    const recipient = await prisma.user.findUnique({ where: { id: recipientId }, select: { id: true } });
    if (!recipient) throw new ConnectionError('That member no longer exists', 404);
    const existing = await prisma.connectionRequest.findFirst({
      where: {
        OR: [
          { senderId, recipientId },
          { senderId: recipientId, recipientId: senderId },
        ],
      },
    });
    if (existing?.status === 'accepted') throw new ConnectionError('You are already connected');
    if (existing?.status === 'pending') throw new ConnectionError('A connection request is already pending');
    const result = existing
      ? await prisma.connectionRequest.update({
          where: { id: existing.id },
          data: { senderId, recipientId, status: 'pending' },
        })
      : await prisma.connectionRequest.create({ data: { senderId, recipientId } });
    return result;
  }

  static async respond(viewerId: string, requestId: string, status: 'accepted' | 'rejected') {
    const request = await prisma.connectionRequest.findUnique({ where: { id: requestId } });
    if (!request || request.recipientId !== viewerId || request.status !== 'pending') {
      throw new ConnectionError('Connection request not found', 404);
    }
    return prisma.connectionRequest.update({ where: { id: requestId }, data: { status } });
  }
}
