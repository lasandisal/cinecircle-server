import { Request, Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import { User, TasteProfile, Watchlist, Follow, Session, Comment } from '../models';
import { sendSuccess } from '../utils/response';
import { AppError } from '../middleware/error.middleware';
import { CompatibilityService } from '../services/compatibility.service';
import { RecommendationService } from '../services/recommendation.service';
import { FollowService, FollowError } from '../services/follow.service';
import mongoose from 'mongoose';

/** Escape user input before it reaches a MongoDB $regex. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Redact a user document for someone who is not the owner.
 *
 * Profiles are readable by anyone (including guests), so returning `email`,
 * `role`, `fatigueCount` and `onboarded` leaked personal data that was then
 * rendered publicly on the profile page.
 */
function redactUserForViewer(user: any, viewerId?: string, viewerRole?: string) {
  const isOwner = !!viewerId && user._id.toString() === viewerId;
  const isAdmin = viewerRole === 'admin';
  if (isOwner || isAdmin) return user;

  const { email, passwordHash, fatigueCount, onboarded, ...publicFields } = user;
  return {
    ...publicFields,
    // Masked so a member is still identifiable in the UI without exposing it.
    email: email ? maskEmail(email) : undefined,
  };
}

function maskEmail(email: string): string {
  const [local, domain] = String(email).split('@');
  if (!domain) return '•••';
  const visible = local.slice(0, 2);
  return `${visible}${'•'.repeat(Math.max(2, local.length - 2))}@${domain}`;
}

/**
 * Get Instagram-like comprehensive user profile
 * GET /api/users/:userId/profile or GET /api/users/me
 */
export const getProfile = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const targetUserId = req.params.userId && req.params.userId !== 'me' ? req.params.userId : req.user?.id;
    if (!targetUserId) {
      return next(new AppError('User ID is required', 400));
    }

    const user = await User.findById(targetUserId).select('-passwordHash').lean();
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const safeUser = redactUserForViewer(user, req.user?.id, req.user?.role);

    const [
      tasteProfile,
      watchlistCount,
      watchedCount,
      // Both follow counts come from one place and are filtered consistently,
      // plus the mutual-connection count. Previously followingCount skipped the
      // followedType filter while followersCount applied it.
      followCounts,
      circlesCount,
      reviewsCount,
      recentWatchedDocs,
      recentWatchlistDocs,
      recentReviewsDocs,
      userCirclesDocs,
    ] = await Promise.all([
      TasteProfile.findOne({ user: targetUserId }).lean(),
      Watchlist.countDocuments({ user: targetUserId, watched: false }),
      Watchlist.countDocuments({ user: targetUserId, watched: true }),
      FollowService.getCounts(targetUserId.toString()),
      Session.countDocuments({ participants: targetUserId }),
      Comment.countDocuments({ user: targetUserId }),
      Watchlist.find({ user: targetUserId, watched: true })
        .populate('title', 'name posterUrl releaseYear type voteAverage runtimeMinutes')
        .sort({ watchedAt: -1, addedAt: -1 })
        .limit(12)
        .lean(),
      Watchlist.find({ user: targetUserId, watched: false })
        .populate('title', 'name posterUrl releaseYear type voteAverage runtimeMinutes overview genres')
        .sort({ addedAt: -1 })
        .limit(18)
        .lean(),
      Comment.find({ user: targetUserId })
        .populate('title', 'name posterUrl releaseYear')
        .sort({ createdAt: -1 })
        .limit(8)
        .lean(),
      Session.find({ participants: targetUserId })
        .populate('host', 'name avatar')
        .populate('shortlist', 'name posterUrl')
        .sort({ createdAt: -1 })
        .limit(6)
        .lean(),
    ]);

    const relationship = await FollowService.getRelationship(req.user?.id, targetUserId.toString());
    const isFollowing = relationship.isFollowing;

    // Real compatibility between the viewer and this member. The UI previously
    // rendered a hardcoded "94% Circle Compatibility Synergy" derived from nothing.
    const compatibility = await CompatibilityService.compute(
      targetUserId.toString(),
      req.user?.id
    );

    let mutualWatchedTitles: any[] = [];
    if (req.user && req.user.id !== targetUserId.toString()) {
      const currentUserWatchedTitleIds = await Watchlist.find({
        user: req.user.id,
        watched: true,
      }).distinct('title');

      if (currentUserWatchedTitleIds.length > 0) {
        mutualWatchedTitles = await Watchlist.find({
          user: targetUserId,
          watched: true,
          title: { $in: currentUserWatchedTitleIds },
        })
          .populate('title', 'name posterUrl releaseYear type voteAverage runtimeMinutes')
          .sort({ watchedAt: -1, addedAt: -1 })
          .lean();
      }
    }

    sendSuccess(
      res,
      {
        profile: {
          ...safeUser,
          avatar: user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=6366f1&color=fff`,
          // Derive the handle from the raw email, not the possibly-masked copy.
          handle: user.handle || `@${(user.email.split('@')[0] || user.name).toLowerCase().replace(/\s+/g, '')}`,
          bio: user.bio || 'Film lover & decision maker on CineCircle 🍿',
          tasteProfile,
          stats: {
            watchlistCount,
            watchedCount,
            followingCount: followCounts.followingCount,
            followersCount: followCounts.followersCount,
            mutualConnectionsCount: followCounts.mutualConnectionsCount,
            circlesCount,
            reviewsCount,
            mutualWatchedCount: mutualWatchedTitles.length,
            // null when there is no shared signal - the UI must say so rather
            // than showing a flattering invented number.
            circleCompatibility: compatibility.score,
            circleCompatibilityBasis: compatibility.basis,
            circleCompatibilityExplanation: compatibility.explanation,
          },
          mutualWatchedTitles: mutualWatchedTitles.filter((w) => w.title != null),
          recentWatched: recentWatchedDocs.filter((w) => w.title != null),
          savedWatchlist: recentWatchlistDocs.filter((w) => w.title != null),
          recentReviews: recentReviewsDocs.filter((r) => r.title != null),
          userCircles: userCirclesDocs,
          isFollowing,
          isFollowedBy: relationship.isFollowedBy,
          // A genuine two-way follow edge - distinct from "mutual watched titles".
          isMutualConnection: relationship.isMutual,
          isSelf: req.user ? req.user.id === targetUserId.toString() : false,
        },
      },
      'User profile retrieved successfully'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Edit user profile details (Instagram style: Name, Bio, Handle, Avatar)
 * PUT /api/users/profile
 */
export const updateProfile = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { name, bio, handle, avatar, subscribedServices } = req.body;

    const updateFields: any = {};
    if (name && typeof name === 'string') updateFields.name = name.trim();
    if (bio !== undefined) updateFields.bio = String(bio).trim();
    if (handle && typeof handle === 'string') {
      const cleanHandle = handle.startsWith('@') ? handle : `@${handle.trim()}`;
      updateFields.handle = cleanHandle;
    }
    if (avatar && typeof avatar === 'string') updateFields.avatar = avatar.trim();
    if (Array.isArray(subscribedServices)) updateFields.subscribedServices = subscribedServices;

    const updatedUser = await User.findByIdAndUpdate(userId, updateFields, { new: true })
      .select('-passwordHash')
      .lean();

    sendSuccess(res, { user: updatedUser }, 'Profile updated successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Find more people / Community directory search
 * GET /api/users/search?q=...
 */
export const searchPeople = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { q = '' } = req.query;
    const currentUserId = req.user?.id;

    const query: any = {};
    if (currentUserId) {
      query._id = { $ne: currentUserId };
    }

    if (q && typeof q === 'string' && q.trim()) {
      const term = escapeRegex(q.trim());
      query.$or = [
        { name: { $regex: term, $options: 'i' } },
        { email: { $regex: term, $options: 'i' } },
        { handle: { $regex: term, $options: 'i' } },
      ];
    }

    // Never list the searcher themselves (they would always "match" at 100%).
    if (currentUserId) {
      query._id = { $ne: currentUserId };
    }

    const users = await User.find(query)
      .select('name email handle avatar bio role subscribedServices createdAt')
      .limit(20)
      .lean();

    // Check which users current user follows
    let followingIds = new Set<string>();
    if (currentUserId) {
      const follows = await Follow.find({ follower: currentUserId, followedType: 'user' }).select('followedUser').lean();
      followingIds = new Set(follows.map((f: any) => f.followedUser?.toString()));
    }

    // Real per-candidate counts in two group-by queries instead of 3N
    // countDocuments calls inside a map.
    const userIds = users.map((u: any) => u._id);
    const [watchedRows, circleRows, followerRows, compatByUser] = await Promise.all([
      Watchlist.aggregate([
        { $match: { user: { $in: userIds }, watched: true } },
        { $group: { _id: '$user', count: { $sum: 1 } } },
      ]),
      Session.aggregate([
        { $match: { participants: { $in: userIds } } },
        { $group: { _id: '$participants', count: { $sum: 1 } } },
      ]),
      Follow.aggregate([
        { $match: { followedType: 'user', followedUser: { $in: userIds } } },
        { $group: { _id: '$followedUser', count: { $sum: 1 } } },
      ]),
      CompatibilityService.computeBatch(currentUserId, userIds.map((id: any) => id.toString())),
    ]);

    const countFor = (rows: any[], keyField: string, id: string) => {
      const row = rows.find((r) => r._id?.toString() === id);
      return row ? row.count : 0;
    };

    const people = await Promise.all(
      users.map(async (u: any) => {
        const id = u._id.toString();
        const compat = compatByUser.get(id);

        return {
          id,
          name: u.name,
          email: u.email,
          handle: u.handle || `@${(u.email.split('@')[0] || u.name).toLowerCase().replace(/\s+/g, '')}`,
          avatar: u.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=6366f1&color=fff`,
          bio: u.bio || 'Movie enthusiast & CineCircle circle member',
          role: u.role,
          isFollowing: followingIds.has(id),
          stats: {
            watchedCount: countFor(watchedRows, 'user', id),
            circlesCount: countFor(circleRows, 'participants', id),
            followersCount: countFor(followerRows, 'followedUser', id),
          },
          // Real compatibility, or null when there is nothing to compare.
          matchScore: compat?.score ?? null,
          matchExplanation: compat?.explanation || '',
          mutualWatchedCount: compat?.mutualWatchedCount ?? 0,
        };
      })
    );

    sendSuccess(res, { people }, 'People search results retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Complete First-Time Onboarding Wizard (Genres, Seed Titles, Exclusions, Subscriptions)
 * POST /api/users/onboarding
 */
export const completeOnboarding = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { favoriteGenres = [], exclusions = [], favoriteTitles = [], subscribedServices = [] } = req.body;

    const profile = await TasteProfile.findOneAndUpdate(
      { user: userId },
      {
        user: userId,
        favoriteGenres,
        exclusions,
        favoriteTitles,
        updatedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const updatedUser = await User.findByIdAndUpdate(
      userId,
      {
        tasteProfile: profile._id,
        subscribedServices,
        onboarded: true,
      },
      { new: true }
    )
      .select('-passwordHash')
      .populate('tasteProfile')
      .lean();

    sendSuccess(
      res,
      {
        user: updatedUser,
        tasteProfile: profile,
      },
      'Onboarding completed successfully'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Read the member's taste profile, computing recency-weighted genre affinities
 * from their WatchHistory on first call.
 * GET /api/users/taste-profile
 */
export const getTasteProfile = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const profile = await TasteProfile.findOne({ user: userId }).lean();

    // Freshen the weighted profile on read so onboarding can report real numbers.
    const computed = await RecommendationService.computeRecencyWeightedTasteProfile(userId);

    sendSuccess(
      res,
      {
        tasteProfile: {
          favoriteGenres: profile?.favoriteGenres || [],
          favoriteTitles: (profile?.favoriteTitles || []).map((t: any) => t.toString()),
          exclusions: profile?.exclusions || [],
          // Use the freshly computed values. Reading the stored Map directly
          // returned the schema default `{}` on profiles never written to.
          genreScores: computed.genreScores,
          historyEvents: computed.totalEvents,
          tasteComputedAt: computed.lastComputedAt,
        },
      },
      'Taste profile retrieved'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Update taste profile (genres, favorites, exclusions)
 * PUT /api/users/taste-profile
 */
export const updateTasteProfile = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { favoriteGenres = [], exclusions = [], favoriteTitles = [] } = req.body;

    const profile = await TasteProfile.findOneAndUpdate(
      { user: userId },
      {
        user: userId,
        favoriteGenres,
        exclusions,
        favoriteTitles,
        updatedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    if (favoriteGenres.length > 0) {
      await User.findByIdAndUpdate(userId, { onboarded: true });
    }

    sendSuccess(res, { tasteProfile: profile }, 'Taste profile updated');
  } catch (error) {
    next(error);
  }
};

/**
 * Update subscribed streaming services
 * PUT /api/users/subscribed-services
 */
export const updateSubscribedServices = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { services = [] } = req.body;

    const user = await User.findByIdAndUpdate(
      userId,
      { subscribedServices: services },
      { new: true }
    ).select('subscribedServices');

    sendSuccess(res, { subscribedServices: user?.subscribedServices || [] }, 'Subscribed services updated');
  } catch (error) {
    next(error);
  }
};

/**
 * Toggle follow/unfollow a user
 * POST /api/users/follow
 */
export const toggleFollow = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const followerId = req.user?.id;
    const { targetUserId } = req.body;

    if (!followerId || !targetUserId) {
      return next(new AppError('targetUserId is required', 400));
    }

    // Validates self-follow, malformed ids and target existence, then returns
    // the resulting two-way relationship so the client does not have to guess.
    const relationship = await FollowService.toggle(followerId, targetUserId);

    sendSuccess(
      res,
      {
        following: relationship.isFollowing,
        isFollowedBy: relationship.isFollowedBy,
        isMutual: relationship.isMutual,
      },
      relationship.isFollowing ? 'Followed member' : 'Unfollowed member'
    );
  } catch (error: any) {
    next(error instanceof FollowError ? new AppError(error.message, error.statusCode) : error);
  }
};

/**
 * Full social graph for a member: who they follow, who follows them, and the
 * two-way intersection (genuine connections).
 * GET /api/users/:userId/connections
 */
export const getConnections = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rawParam = req.params.userId;
    const userId =
      typeof rawParam === 'string' && rawParam !== 'me' && rawParam !== '' ? rawParam : req.user?.id;
    if (!userId) {
      return next(new AppError('User ID is required', 400));
    }
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return next(new AppError('Invalid user id', 400));
    }

    const [graph, counts] = await Promise.all([
      FollowService.getGraph(userId),
      FollowService.getCounts(userId),
    ]);

    // The viewer's relationship to this member, so the UI can render
    // "Follows you" / "Mutual" badges.
    const relationship = await FollowService.getRelationship(req.user?.id, userId);

    sendSuccess(
      res,
      { ...graph, counts, viewerRelationship: relationship },
      'Connections retrieved'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve suggested real users from DB for social sidebar
 * GET /api/users/suggestions
 */
export const getUserSuggestions = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const currentUserId = req.user?.id;
    const query: any = {};
    if (currentUserId) {
      query._id = { $ne: currentUserId };
    }

    const users = await User.find(query)
      .select('name email role avatar handle bio createdAt')
      .limit(6)
      .lean();

    const currentUserWatchedTitleIds = currentUserId
      ? await Watchlist.find({ user: currentUserId, watched: true }).distinct('title')
      : [];
    const candidateUserIds = users.map((user: any) => user._id);
    const mutualCounts = new Map<string, number>();

    if (currentUserWatchedTitleIds.length > 0 && candidateUserIds.length > 0) {
      const mutualWatched = await Watchlist.aggregate([
        {
          $match: {
            user: { $in: candidateUserIds },
            watched: true,
            title: { $in: currentUserWatchedTitleIds },
          },
        },
        { $group: { _id: { user: '$user', title: '$title' } } },
        { $group: { _id: '$_id.user', count: { $sum: 1 } } },
      ]);

      mutualWatched.forEach((entry) => {
        mutualCounts.set(entry._id.toString(), entry.count);
      });
    }

    // Real compatibility per suggestion, or null when there is no shared signal.
    const compatByUser = await CompatibilityService.computeBatch(
      currentUserId,
      candidateUserIds.map((id: any) => id.toString())
    );

    const matches = users.map((u: any, idx: number) => {
      const handle = u.handle || (u.email ? `@${u.email.split('@')[0]}` : `@${u.name.toLowerCase().replace(/\s+/g, '')}`);
      const id = u._id.toString();
      const compat = compatByUser.get(id);
      return {
        id,
        name: u.name,
        handle,
        avatar: u.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=${idx % 2 === 0 ? '6366f1' : '8b5cf6'}&color=fff`,
        // null = "not enough shared history", not an invented number.
        matchScore: compat?.score ?? null,
        matchExplanation: compat?.explanation || '',
        mutualCount: compat?.mutualWatchedCount ?? 0,
      };
    });

    // Surface the genuinely most-compatible people first.
    matches.sort((a: any, b: any) => (b.matchScore ?? -1) - (a.matchScore ?? -1));

    sendSuccess(res, { users: matches }, 'User suggestions retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Get real dynamic notifications for the user
 * GET /api/users/notifications
 */
export const getNotifications = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      sendSuccess(res, { notifications: [] }, 'No notifications for guest');
      return;
    }

    const notifications: any[] = [];

    // 1. Real Circle Sessions where user is a participant or recent active rooms
    const userSessions = await Session.find({
      participants: userId,
      status: 'open',
    })
      .populate('host', 'name avatar handle')
      .sort({ createdAt: -1 })
      .limit(4)
      .lean();

    for (const s of userSessions) {
      const hostName = (s.host as any)?.name || 'Watch Circle Host';
      const hostAvatar = (s.host as any)?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(hostName)}&background=6366f1&color=fff`;
      const isHost = (s.host as any)?._id?.toString() === userId.toString();

      notifications.push({
        id: `session-${s._id}`,
        type: 'circle',
        actorName: hostName,
        actorAvatar: hostAvatar,
        title: isHost
          ? `Your watch circle "${s.name}" is active and voting.`
          : `invited you to join live watch circle: "${s.name}"`,
        detail: `Room Code: #${s.joinCode} • ${s.participants?.length || 1} participant(s)`,
        timestamp: s.createdAt ? new Date(s.createdAt).toLocaleDateString() : 'Recent',
        read: false,
        actionUrl: `/group`,
        actionText: 'Enter Room',
        createdAt: s.createdAt,
      });
    }

    // 2. Real Followers who followed this user
    const recentFollowers = await Follow.find({
      followedType: 'user',
      followedUser: userId,
    })
      .populate('follower', 'name avatar handle email')
      .sort({ createdAt: -1 })
      .limit(4)
      .lean();

    for (const f of recentFollowers) {
      if (f.follower) {
        const followerName = (f.follower as any).name || 'Community Member';
        const followerAvatar = (f.follower as any).avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(followerName)}&background=6366f1&color=fff`;
        notifications.push({
          id: `follow-${f._id}`,
          type: 'follow',
          actorName: followerName,
          actorAvatar: followerAvatar,
          title: `started following you on CineCircle.`,
          detail: (f.follower as any).handle || `@${(f.follower as any).name?.toLowerCase().replace(/\s+/g, '')}`,
          timestamp: f.createdAt ? new Date(f.createdAt).toLocaleDateString() : 'Recent',
          read: false,
          actionUrl: `/profile/${(f.follower as any)._id}`,
          actionText: 'View Profile',
          createdAt: f.createdAt,
        });
      }
    }

    // Sort by newest first
    notifications.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    });

    sendSuccess(res, { notifications }, 'Real notifications retrieved successfully');
  } catch (error) {
    next(error);
  }
};
