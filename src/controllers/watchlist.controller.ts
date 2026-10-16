import { Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { IAuthRequest } from '../types';
import { Watchlist, WatchHistory, Title } from '../models';
import { AppError } from '../middleware/error.middleware';
import { sendSuccess } from '../utils/response';

/**
 * Resolve the `:id` route parameter, which callers may supply as either a
 * Watchlist document id or a Title id, into the Watchlist document itself.
 *
 * This must happen BEFORE any update. The previous implementation ran a single
 * `findOneAndUpdate` with a `$or: [{ _id: id }, { title: id }]` filter but a
 * hardcoded `title: id` in the update. When the caller passed a Watchlist _id
 * (as WatchlistPage does) the matched row had its `title` overwritten with its
 * own document id - destroying the title reference, so `.populate('title')`
 * returned null and the entry silently vanished from GET /api/watchlist.
 */
async function resolveWatchlistItem(
  userId: string,
  id: string
): Promise<{ _id: mongoose.Types.ObjectId; title: mongoose.Types.ObjectId } | null> {
  if (!mongoose.Types.ObjectId.isValid(id)) return null;

  const byDocId = await Watchlist.findOne({ user: userId, _id: id })
    .select('_id title')
    .lean();
  if (byDocId) return byDocId as any;

  const byTitleId = await Watchlist.findOne({ user: userId, title: id })
    .select('_id title')
    .lean();
  return byTitleId as any;
}

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

    // Totals are computed WITHOUT the status filter. The frontend previously
    // derived the filter-pill counts from the already-filtered list, so
    // selecting "Watched" made "Want to Watch" read 0 and "All" show the
    // filtered total instead of the real one.
    const [watchedCount, wantToWatchCount] = await Promise.all([
      Watchlist.countDocuments({ user: userId, watched: true }),
      Watchlist.countDocuments({ user: userId, watched: false }),
    ]);

    sendSuccess(
      res,
      {
        // Total is the unfiltered size of the user's list.
        total: watchedCount + wantToWatchCount,
        watchlist: validItems,
        counts: {
          total: watchedCount + wantToWatchCount,
          watched: watchedCount,
          wantToWatch: wantToWatchCount,
        },
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

    const { watched = true } = req.body;
    const id = String(req.params.id);

    // Resolve first, then update by the document's own _id. `title` is never
    // written here, so the existing reference cannot be corrupted.
    const existing = await resolveWatchlistItem(userId, id);
    if (!existing) {
      return next(new AppError('Watchlist item not found', 404));
    }

    const item = await Watchlist.findOneAndUpdate(
      { _id: existing._id, user: userId },
      {
        $set: {
          watched: Boolean(watched),
          watchedAt: watched ? new Date() : null,
        },
      },
      { new: true }
    ).populate('title');

    if (!item) {
      return next(new AppError('Watchlist item not found', 404));
    }

    if (watched) {
      // `item.title` is a populated document; store the raw id.
      const titleId = (item.title as any)?._id?.toString() || existing.title.toString();
      await WatchHistory.create({
        user: userId,
        title: titleId,
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

    const { rating } = req.body;
    const id = String(req.params.id);

    const numRating = Number(rating);
    if (!numRating || numRating < 1 || numRating > 5) {
      return next(new AppError('Rating must be an integer between 1 and 5', 400));
    }

    // Same resolve-then-update pattern as markAsWatched: never write `title`.
    const existing = await resolveWatchlistItem(userId, id);
    if (!existing) {
      return next(new AppError(
        'This title is not in your watchlist. Add it before rating.',
        404
      ));
    }

    const item = await Watchlist.findOneAndUpdate(
      { _id: existing._id, user: userId },
      {
        $set: {
          starRating: numRating,
          watched: true,
          watchedAt: new Date(),
        },
      },
      { new: true }
    ).populate('title');

    if (!item) {
      return next(new AppError('Watchlist item not found', 404));
    }

    // WatchHistory feeds the recency-weighted taste profile, so the title id
    // must be the raw ObjectId, not a populated document.
    const titleId = (item.title as any)?._id?.toString() || existing.title.toString();
    await WatchHistory.create({
      user: userId,
      title: titleId,
      action: 'rated',
      rating: numRating,
      timestamp: new Date(),
    });

    sendSuccess(res, { item }, 'Rating recorded successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Check if title is in user's watchlist
 * GET /api/watchlist/status/:titleId
 */
export const getTitleWatchlistStatus = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      sendSuccess(
        res,
        {
          inWatchlist: false,
          watched: false,
          starRating: 0,
          item: null,
        },
        'Guest watchlist status'
      );
      return;
    }

    const { titleId } = req.params;
    const item = await Watchlist.findOne({
      user: userId,
      $or: [{ title: titleId }, { _id: titleId }],
    }).lean();

    sendSuccess(
      res,
      {
        inWatchlist: Boolean(item),
        watched: Boolean(item?.watched),
        starRating: item?.starRating || 0,
        item: item || null,
      },
      'Title watchlist status retrieved'
    );
  } catch (error) {
    next(error);
  }
};
