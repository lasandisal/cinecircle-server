import { Request, Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import { User, TasteProfile, Watchlist, Follow, Session, Comment } from '../models';
import { sendSuccess } from '../utils/response';
import { AppError } from '../middleware/error.middleware';

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

    const [
      tasteProfile,
      watchlistCount,
      watchedCount,
      followingCount,
      followersCount,
      circlesCount,
      reviewsCount,
      recentWatchedDocs,
      recentReviewsDocs,
      userCirclesDocs,
    ] = await Promise.all([
      TasteProfile.findOne({ user: targetUserId }).lean(),
      Watchlist.countDocuments({ user: targetUserId, watched: false }),
      Watchlist.countDocuments({ user: targetUserId, watched: true }),
      Follow.countDocuments({ follower: targetUserId }),
      Follow.countDocuments({ followedType: 'user', followedUser: targetUserId }),
      Session.countDocuments({ participants: targetUserId }),
      Comment.countDocuments({ user: targetUserId }),
      Watchlist.find({ user: targetUserId, watched: true })
        .populate('title', 'name posterUrl releaseYear type voteAverage runtimeMinutes')
        .sort({ watchedAt: -1, addedAt: -1 })
        .limit(12)
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

    const isFollowing = req.user && req.user.id !== targetUserId.toString()
      ? Boolean(await Follow.findOne({ follower: req.user.id, followedType: 'user', followedUser: targetUserId }))
      : false;

    sendSuccess(
      res,
      {
        profile: {
          ...user,
          avatar: user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=6366f1&color=fff`,
          handle: user.handle || `@${(user.email.split('@')[0] || user.name).toLowerCase().replace(/\s+/g, '')}`,
          bio: user.bio || 'Film lover & decision maker on CineCircle 🍿',
          tasteProfile,
          stats: {
            watchlistCount,
            watchedCount,
            followingCount,
            followersCount,
            circlesCount,
            reviewsCount,
          },
          recentWatched: recentWatchedDocs.filter((w) => w.title != null),
          recentReviews: recentReviewsDocs.filter((r) => r.title != null),
          userCircles: userCirclesDocs,
          isFollowing,
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
      const term = q.trim();
      query.$or = [
        { name: { $regex: term, $options: 'i' } },
        { email: { $regex: term, $options: 'i' } },
        { handle: { $regex: term, $options: 'i' } },
      ];
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

    const people = await Promise.all(
      users.map(async (u: any, idx: number) => {
        const watchedCount = await Watchlist.countDocuments({ user: u._id, watched: true });
        const circlesCount = await Session.countDocuments({ participants: u._id });
        const followersCount = await Follow.countDocuments({ followedType: 'user', followedUser: u._id });

        return {
          id: u._id.toString(),
          name: u.name,
          email: u.email,
          handle: u.handle || `@${(u.email.split('@')[0] || u.name).toLowerCase().replace(/\s+/g, '')}`,
          avatar: u.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=6366f1&color=fff`,
          bio: u.bio || 'Movie enthusiast & CineCircle circle member',
          role: u.role,
          isFollowing: followingIds.has(u._id.toString()),
          stats: {
            watchedCount,
            circlesCount,
            followersCount,
          },
          matchScore: 82 + ((idx * 6) % 17),
        };
      })
    );

    sendSuccess(res, { people }, 'People search results retrieved');
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

    const existing = await Follow.findOne({ follower: followerId, followedType: 'user', followedUser: targetUserId });
    if (existing) {
      await Follow.deleteOne({ _id: existing._id });
      sendSuccess(res, { following: false }, 'Unfollowed user');
    } else {
      await Follow.create({ follower: followerId, followedType: 'user', followedUser: targetUserId });
      sendSuccess(res, { following: true }, 'Followed user');
    }
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

    const matches = users.map((u: any, idx: number) => {
      const handle = u.handle || (u.email ? `@${u.email.split('@')[0]}` : `@${u.name.toLowerCase().replace(/\s+/g, '')}`);
      return {
        id: u._id.toString(),
        name: u.name,
        handle,
        avatar: u.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=${idx % 2 === 0 ? '6366f1' : '8b5cf6'}&color=fff`,
        matchScore: 84 + ((idx * 5) % 15),
        mutualCount: 6 + ((idx * 3) % 12),
      };
    });

    sendSuccess(res, { users: matches }, 'User suggestions retrieved');
  } catch (error) {
    next(error);
  }
};
