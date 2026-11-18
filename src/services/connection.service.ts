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

type ConnectionActor = {
  id: string;
  name: string;
  avatar: string | null;
  handle: string | null;
};

const avatarFor = (name: string, avatar: string | null): string =>
  avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=6366f1&color=fff`;

/**
 * Connection history is terminal once a request is accepted, rejected or
 * removed. Pending requests are synthesised by GET /users/notifications from
 * the live request row, but those terminal events need a stored row or they
 * would disappear the moment the request changed.
 */
const notifyConnectionEvent = async (userId: string, actor: ConnectionActor, title: string): Promise<void> => {
  await prisma.notification.create({
    data: {
      userId,
      type: 'connection',
      actorName: actor.name,
      actorAvatar: avatarFor(actor.name, actor.avatar),
      title,
      detail: actor.handle || undefined,
      actionUrl: `/profile/${actor.id}`,
      actionText: 'View Profile',
    },
  });
};

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

  /**
   * Resolve the viewer's status against several members in one query.
   * Used by the community directory so each row can offer Connect,
   * Accept, Pending or Disconnect without issuing a request per person.
   */
  static async getStatusMap(
    viewerId: string | undefined,
    targetIds: string[]
  ): Promise<Map<string, ConnectionRequestStatus>> {
    const statuses = new Map<string, ConnectionRequestStatus>();
    if (!viewerId || targetIds.length === 0) return statuses;

    const targets = targetIds.filter((id) => id !== viewerId);
    if (targets.length === 0) return statuses;

    const requests = await prisma.connectionRequest.findMany({
      where: {
        OR: [
          { senderId: viewerId, recipientId: { in: targets } },
          { recipientId: viewerId, senderId: { in: targets } },
        ],
      },
      select: { id: true, senderId: true, recipientId: true, status: true },
    });

    for (const request of requests) {
      const otherId = request.senderId === viewerId ? request.recipientId : request.senderId;
      if (request.status === 'accepted') {
        statuses.set(otherId, { status: 'accepted', requestId: request.id });
      } else if (request.status === 'pending') {
        statuses.set(otherId, {
          status: request.senderId === viewerId ? 'pending_sent' : 'pending_received',
          requestId: request.id,
        });
      }
      // rejected rows are historical only: the two members are free to
      // request again, so they map to "none" by omission.
    }

    return statuses;
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
    const updated = await prisma.connectionRequest.update({ where: { id: requestId }, data: { status } });

    // Tell the original sender what happened. The recipient already saw the
    // pending request as a live notification, so only the sender needs a new
    // stored event here.
    const recipient = await prisma.user.findUnique({
      where: { id: viewerId },
      select: { id: true, name: true, avatar: true, handle: true },
    });
    if (recipient) {
      await notifyConnectionEvent(
        request.senderId,
        recipient,
        status === 'accepted'
          ? 'accepted your connection request.'
          : 'declined your connection request.'
      ).catch((error) => console.error('Failed to notify connection sender:', error));
    }

    return updated;
  }

  static async disconnect(viewerId: string, targetId: string) {
    if (viewerId === targetId) throw new ConnectionError('You cannot disconnect from yourself');

    const existing = await prisma.connectionRequest.findFirst({
      where: {
        status: 'accepted',
        OR: [
          { senderId: viewerId, recipientId: targetId },
          { senderId: targetId, recipientId: viewerId },
        ],
      },
    });
    if (!existing) throw new ConnectionError('You are not connected with this member', 404);

    // Delete rather than mark rejected: the unique (senderId, recipientId)
    // pair means a deleted row lets them reconnect cleanly later.
    await prisma.connectionRequest.delete({ where: { id: existing.id } });

    const viewer = await prisma.user.findUnique({
      where: { id: viewerId },
      select: { id: true, name: true, avatar: true, handle: true },
    });
    if (viewer) {
      await notifyConnectionEvent(targetId, viewer, 'removed you from their connections.')
        .catch((error) => console.error('Failed to notify disconnected member:', error));
    }

    return { status: 'none' as const };
  }
}
