import prisma from '../config/prisma';

export class FollowError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface Relationship {
  /** The viewer follows this person. */
  isFollowing: boolean;
  /** This person follows the viewer. */
  isFollowedBy: boolean;
  /** Both directions - i.e. a genuine mutual connection. */
  isMutual: boolean;
}

export interface ConnectionGraph {
  following: any[];
  followers: any[];
  /** People with a two-way follow edge. */
  mutuals: any[];
}

const personCard = (u: any) => ({
  id: u.id,
  _id: u.id,
  name: u.name,
  handle: u.handle || `@${(u.email?.split('@')[0] || u.name || '').toLowerCase().replace(/\s+/g, '')}`,
  avatar: u.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name || 'U')}&background=6366f1&color=fff`,
  bio: u.bio || '',
  role: u.role,
});

export class FollowService {
  /**
   * Toggle a follow edge with validation
   */
  public static async toggle(followerId: string, targetUserId: string): Promise<Relationship> {
    if (!followerId || !targetUserId) {
      throw new FollowError('Invalid user id', 400);
    }
    if (followerId === targetUserId) {
      throw new FollowError('You cannot follow yourself', 400);
    }

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true },
    });
    if (!target) {
      throw new FollowError('That member no longer exists', 404);
    }

    const existing = await prisma.follow.findFirst({
      where: {
        followerId,
        followedType: 'user',
        followedUserId: targetUserId,
      },
    });

    if (existing) {
      await prisma.follow.delete({ where: { id: existing.id } });
    } else {
      await prisma.follow.create({
        data: {
          followerId,
          followedType: 'user',
          followedUserId: targetUserId,
        },
      });
    }

    return this.getRelationship(followerId, targetUserId);
  }

  /**
   * Relationship of the viewer to one specific member
   */
  public static async getRelationship(
    viewerId: string | undefined,
    targetUserId: string
  ): Promise<Relationship & { viewerId: string | null }> {
    if (!viewerId || viewerId === targetUserId) {
      return {
        viewerId: viewerId || null,
        isFollowing: false,
        isFollowedBy: false,
        isMutual: false,
      };
    }

    const edges = await prisma.follow.findMany({
      where: {
        followedType: 'user',
        OR: [
          { followerId: viewerId, followedUserId: targetUserId },
          { followerId: targetUserId, followedUserId: viewerId },
        ],
      },
      select: { followerId: true, followedUserId: true },
    });

    const isFollowing = edges.some(
      (e) => e.followerId === viewerId && e.followedUserId === targetUserId
    );
    const isFollowedBy = edges.some(
      (e) => e.followerId === targetUserId && e.followedUserId === viewerId
    );

    return { viewerId, isFollowing, isFollowedBy, isMutual: isFollowing && isFollowedBy };
  }

  /** Ids of everyone the user follows (user-follow edges only). */
  public static async getFollowingIds(userId: string): Promise<string[]> {
    if (!userId) return [];
    const rows = await prisma.follow.findMany({
      where: { followerId: userId, followedType: 'user' },
      select: { followedUserId: true },
    });
    return rows.map((r) => r.followedUserId).filter((id): id is string => Boolean(id));
  }

  /**
   * Full two-way graph: who I follow, who follows me, and the intersection
   */
  public static async getGraph(userId: string): Promise<ConnectionGraph> {
    if (!userId) {
      return { following: [], followers: [], mutuals: [] };
    }

    const [followingRows, followerRows] = await Promise.all([
      prisma.follow.findMany({
        where: { followerId: userId, followedType: 'user' },
        select: { followedUserId: true },
      }),
      prisma.follow.findMany({
        where: { followedType: 'user', followedUserId: userId },
        select: { followerId: true },
      }),
    ]);

    const followingIds = followingRows
      .map((r) => r.followedUserId)
      .filter((id): id is string => Boolean(id));
    const followerIds = followerRows.map((r) => r.followerId).filter(Boolean);

    const followingSet = new Set(followingIds);
    const mutualIds = followerIds.filter((id) => followingSet.has(id));

    const allIds = Array.from(new Set([...followingIds, ...followerIds]));
    const users = allIds.length
      ? await prisma.user.findMany({
          where: { id: { in: allIds } },
          select: { id: true, name: true, handle: true, avatar: true, bio: true, role: true, email: true },
        })
      : [];
    const byId = new Map(users.map((u) => [u.id, u]));

    const cardsFor = (ids: string[]) =>
      ids
        .map((id) => byId.get(id))
        .filter(Boolean)
        .map(personCard)
        .sort((a, b) => a.name.localeCompare(b.name));

    return {
      following: cardsFor(followingIds),
      followers: cardsFor(followerIds),
      mutuals: cardsFor(mutualIds),
    };
  }

  /**
   * Counted graph, used for profile stats
   */
  public static async getCounts(userId: string): Promise<{
    followingCount: number;
    followersCount: number;
    mutualConnectionsCount: number;
  }> {
    if (!userId) {
      return { followingCount: 0, followersCount: 0, mutualConnectionsCount: 0 };
    }

    const [followingCount, followersCount] = await Promise.all([
      prisma.follow.count({
        where: { followerId: userId, followedType: 'user' },
      }),
      prisma.follow.count({
        where: { followedType: 'user', followedUserId: userId },
      }),
    ]);

    let mutualConnectionsCount = 0;
    if (followingCount > 0 && followersCount > 0) {
      const [followingIds, followerRows] = await Promise.all([
        this.getFollowingIds(userId),
        prisma.follow.findMany({
          where: { followedType: 'user', followedUserId: userId },
          select: { followerId: true },
        }),
      ]);
      const followerIds = followerRows.map((r) => r.followerId);
      const set = new Set(followingIds);
      mutualConnectionsCount = followerIds.filter((id) => set.has(id)).length;
    }

    return { followingCount, followersCount, mutualConnectionsCount };
  }
}
