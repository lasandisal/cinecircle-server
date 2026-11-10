import prisma from '../config/prisma';

export interface ConnectionGraph {
  connections: any[];
}

const personCard = (u: any) => ({
  id: u.id,
  _id: u.id,
  name: u.name,
  handle: u.handle || `@${(u.email?.split('@')[0] || u.name || '').toLowerCase().replace(/\s+/g, '')}`,
  avatar:
    u.avatar ||
    `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name || 'U')}&background=6366f1&color=fff`,
  bio: u.bio || '',
  role: u.role,
});

export class ConnectionGraphService {
  public static async getConnectionIds(userId: string): Promise<string[]> {
    if (!userId) return [];
    const requests = await prisma.connectionRequest.findMany({
      where: {
        status: 'accepted',
        OR: [{ senderId: userId }, { recipientId: userId }],
      },
      select: { senderId: true, recipientId: true },
    });
    return requests.map((request) =>
      request.senderId === userId ? request.recipientId : request.senderId
    );
  }

  public static async getGraph(userId: string): Promise<ConnectionGraph> {
    const connectionIds = await this.getConnectionIds(userId);
    const users = connectionIds.length
      ? await prisma.user.findMany({
          where: { id: { in: connectionIds } },
          select: { id: true, name: true, handle: true, avatar: true, bio: true, role: true, email: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    return {
      connections: connectionIds
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map(personCard)
        .sort((a, b) => a.name.localeCompare(b.name)),
    };
  }

  public static async getCounts(userId: string): Promise<{ connectionsCount: number }> {
    return { connectionsCount: (await this.getConnectionIds(userId)).length };
  }
}
