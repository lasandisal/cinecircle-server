import { Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import { User, TasteProfile, Watchlist, Follow } from '../models';
import { sendSuccess } from '../utils/response';
import { AppError } from '../middleware/error.middleware';

/**
 * Get user profile with taste profile and watchlist stats
 * GET /api/users/:userId/profile
 */
export const getProfile = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const targetUserId = req.params.userId || req.user?.id;
    if (!targetUserId) {
      return next(new AppError('User ID is required', 400));
    }

    const user = await User.findById(targetUserId).select('-password').lean();
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const [tasteProfile, watchlistCount, watchedCount] = await Promise.all([
      TasteProfile.findOne({ user: targetUserId }).lean(),
      Watchlist.countDocuments({ user: targetUserId, watched: false }),
      Watchlist.countDocuments({ user: targetUserId, watched: true }),
    ]);

    const isFollowing = req.user
      ? Boolean(await Follow.findOne({ follower: req.user.id, following: targetUserId }))
      : false;

    sendSuccess(
      res,
      {
        profile: {
          ...user,
          tasteProfile,
          stats: {
            watchlistCount,
            watchedCount,
            mutualFilms: 12,
          },
          isFollowing,
        },
      },
      'User profile retrieved'
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

    const existing = await Follow.findOne({ follower: followerId, following: targetUserId });
    if (existing) {
      await Follow.deleteOne({ _id: existing._id });
      sendSuccess(res, { following: false }, 'Unfollowed user');
    } else {
      await Follow.create({ follower: followerId, following: targetUserId });
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
      .select('name email role avatar createdAt')
      .limit(6)
      .lean();

    const matches = users.map((u: any, idx: number) => {
      const handle = u.email ? `@${u.email.split('@')[0]}` : `@${u.name.toLowerCase().replace(/\s+/g, '')}`;
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
