import { Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import { Watchlist, WatchHistory, Title } from '../models';
import { AppError } from '../middleware/error.middleware';
import { sendSuccess } from '../utils/response';

/**
 * Retrieve current user's real watchlist with populated titles
 * GET /api/watchlist
 */
export const getWatchlist = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { status } = req.query; // 'all' | 'watched' | 'want_to_watch'

    const query: any = { user: userId };
    if (status === 'watched') {
      query.watched = true;
    } else if (status === 'want_to_watch') {
      query.watched = false;
    }

    const items = await Watchlist.find(query)
      .populate({
        path: 'title',
        select: 'name originalTitle posterUrl backdropUrl releaseYear type genres runtimeMinutes voteAverage overview tmdbId',
      })
      .sort({ addedAt: -1 })
      .lean();

    // Filter out any orphaned entries where title was removed
    const validItems = items.filter((item) => item.title != null);

    sendSuccess(
      res,
      {
        total: validItems.length,
        watchlist: validItems,
      },
      'Watchlist retrieved successfully'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Add title to user's watchlist
 * POST /api/watchlist
 */
export const addToWatchlist = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { titleId } = req.body;
    if (!titleId) {
      return next(new AppError('titleId is required', 400));
    }

    // Verify title exists
    const titleExists = await Title.findById(titleId);
    if (!titleExists) {
      return next(new AppError('Title not found', 404));
    }

    const item = await Watchlist.findOneAndUpdate(
      { user: userId, title: titleId },
      {
        user: userId,
        title: titleId,
        $setOnInsert: { addedAt: new Date(), watched: false },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).populate('title');

    sendSuccess(res, { item }, 'Title added to watchlist successfully', 201);
  } catch (error) {
    next(error);
  }
};

/**
 * Remove title from user's watchlist
 * DELETE /api/watchlist/:id
 */
export const removeFromWatchlist = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { id } = req.params;

    // Can be deleted by Watchlist document ID or Title ObjectId
    const deleted = await Watchlist.findOneAndDelete({
      $and: [
        { user: userId },
        { $or: [{ _id: id }, { title: id }] },
      ],
    });

    if (!deleted) {
      return next(new AppError('Watchlist item not found', 404));
    }

    sendSuccess(res, { removedId: id }, 'Removed from watchlist successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Mark a title as watched / unwatched
 * PATCH /api/watchlist/:id/watched
 */
export const markAsWatched = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { id } = req.params;
    const { watched = true } = req.body;

    const item = await Watchlist.findOneAndUpdate(
      {
        user: userId,
        $or: [{ _id: id }, { title: id }],
      },
      {
        watched: Boolean(watched),
        watchedAt: watched ? new Date() : null,
      },
      { new: true }
    ).populate('title');

    if (!item) {
      return next(new AppError('Watchlist item not found', 404));
    }

    if (watched) {
      await WatchHistory.create({
        user: userId,
        title: item.title,
        action: 'watched',
        timestamp: new Date(),
      });
    }

    sendSuccess(res, { item }, watched ? 'Marked as watched' : 'Marked as unwatched');
  } catch (error) {
    next(error);
  }
};

/**
 * Record a 1-5 star personal rating for a title
 * PATCH /api/watchlist/:id/rate
 */
export const rateTitle = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { id } = req.params;
    const { rating } = req.body;

    const numRating = Number(rating);
    if (!numRating || numRating < 1 || numRating > 5) {
      return next(new AppError('Rating must be an integer between 1 and 5', 400));
    }

    const item = await Watchlist.findOneAndUpdate(
      {
        user: userId,
        $or: [{ _id: id }, { title: id }],
      },
      {
        starRating: numRating,
        watched: true,
        watchedAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).populate('title');

    // Create a WatchHistory entry
    await WatchHistory.create({
      user: userId,
      title: item.title,
      action: 'rated',
      rating: numRating,
      timestamp: new Date(),
    });

    sendSuccess(res, { item }, 'Rating recorded successfully');
  } catch (error) {
    next(error);
  }
};
