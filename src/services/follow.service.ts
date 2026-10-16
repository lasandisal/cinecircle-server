import mongoose from 'mongoose';
import { Follow, User } from '../models';

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

const PUBLIC_FIELDS = 'name handle avatar bio role';

const personCard = (u: any) => ({
  id: u._id.toString(),
  name: u.name,
  handle: u.handle || `@${(u.email?.split('@')[0] || u.name || '').toLowerCase().replace(/\s+/g, '')}`,
  avatar: u.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name || 'U')}&background=6366f1&color=fff`,
  bio: u.bio || '',
  role: u.role,
});

/**
 * The social graph.
 *
 * Previously all of this was inline in the controller and there was no notion of
 * a two-way relationship at all - "mutual" elsewhere in the app always meant
 * mutual *watched titles*, which is a completely different idea and was easy to
 * confuse with mutual connections.
 */
export class FollowService {
  /**
   * Toggle a follow edge.
   *
   * Adds the validation the original handler lacked: a self-follow guard, a
   * malformed-id check, and an existence check on the target. Without these you
   * could follow yourself (inflating your own follower count) or write a
   * dangling reference to a non-existent user.
   */
  public static async toggle(followerId: string, targetUserId: string): Promise<Relationship> {
    if (!mongoose.Types.ObjectId.isValid(followerId) || !mongoose.Types.ObjectId.isValid(targetUserId)) {
      throw new FollowError('Invalid user id', 400);
    }
    if (followerId === targetUserId) {
      throw new FollowError('You cannot follow yourself', 400);
    }

    const target = await User.findById(targetUserId).select('_id').lean();
    if (!target) {
      throw new FollowError('That member no longer exists', 404);
    }

    const existing = await Follow.findOne({
      follower: followerId,
      followedType: 'user',
      followedUser: targetUserId,
    });

    if (existing) {
      await Follow.deleteOne({ _id: existing._id });
    } else {
      await Follow.create({
        follower: followerId,
        followedType: 'user',
        followedUser: targetUserId,
      });
    }

    return this.getRelationship(followerId, targetUserId);
  }

  /**
   * Relationship of the viewer to one specific member.
   * Both directions are resolved in a single query.
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

    const edges = await Follow.find({
      followedType: 'user',
      $or: [
        { follower: viewerId, followedUser: targetUserId },
        { follower: targetUserId, followedUser: viewerId },
      ],
    })
      .select('follower followedUser')
      .lean();

    const isFollowing = edges.some(
      (e: any) => e.follower.toString() === viewerId && e.followedUser.toString() === targetUserId
    );
    const isFollowedBy = edges.some(
      (e: any) => e.follower.toString() === targetUserId && e.followedUser.toString() === viewerId
    );

    return { viewerId, isFollowing, isFollowedBy, isMutual: isFollowing && isFollowedBy };
  }

  /** Ids of everyone the user follows (user-follow edges only). */
  public static async getFollowingIds(userId: string): Promise<string[]> {
    if (!mongoose.Types.ObjectId.isValid(userId)) return [];
    const rows = await Follow.find({ follower: userId, followedType: 'user' })
      .select('followedUser')
      .lean();
    return rows.map((r: any) => r.followedUser?.toString()).filter(Boolean);
  }

  /**
   * Full two-way graph: who I follow, who follows me, and the intersection
   * (real connections).
   */
  public static async getGraph(userId: string): Promise<ConnectionGraph> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return { following: [], followers: [], mutuals: [] };
    }

    const [followingRows, followerRows] = await Promise.all([
      Follow.find({ follower: userId, followedType: 'user' }).select('followedUser').lean(),
      Follow.find({ followedType: 'user', followedUser: userId }).select('follower').lean(),
    ]);

    const followingIds = followingRows
      .map((r: any) => r.followedUser?.toString())
      .filter(Boolean);
    const followerIds = followerRows.map((r: any) => r.follower?.toString()).filter(Boolean);

    // Intersection = a two-way edge.
    const followingSet = new Set(followingIds);
    const mutualIds = followerIds.filter((id) => followingSet.has(id));

    // One query for every referenced user, not one per id.
    const allIds = Array.from(new Set([...followingIds, ...followerIds]));
    const users = allIds.length
      ? await User.find({ _id: { $in: allIds } }).select(`${PUBLIC_FIELDS} email`).lean()
      : [];
    const byId = new Map(users.map((u: any) => [u._id.toString(), u]));

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
   * Counted graph, used for profile stats.
   *
   * Both directions are filtered by `followedType: 'user'` so the two numbers
   * can never disagree the way the previous pair of countDocuments calls did
   * (one filtered, one not).
   */
  public static async getCounts(userId: string): Promise<{
    followingCount: number;
    followersCount: number;
    mutualConnectionsCount: number;
  }> {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return { followingCount: 0, followersCount: 0, mutualConnectionsCount: 0 };
    }

    const [followingCount, followersCount] = await Promise.all([
      Follow.countDocuments({ follower: userId, followedType: 'user' }),
      Follow.countDocuments({ followedType: 'user', followedUser: userId }),
    ]);

    let mutualConnectionsCount = 0;
    if (followingCount > 0 && followersCount > 0) {
      const [followingIds, followerIds] = await Promise.all([
        this.getFollowingIds(userId),
        Follow.find({ followedType: 'user', followedUser: userId })
          .select('follower')
          .lean()
          .then((rows) => rows.map((r: any) => r.follower?.toString()).filter(Boolean)),
      ]);
      const set = new Set(followingIds);
      mutualConnectionsCount = followerIds.filter((id) => set.has(id)).length;
    }

    return { followingCount, followersCount, mutualConnectionsCount };
  }
}