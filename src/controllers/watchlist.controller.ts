import { Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import prisma from '../config/prisma';
import { AppError } from '../middleware/error.middleware';
import { sendSuccess } from '../utils/response';

/**
 * Resolve the `:id` route parameter, which callers may supply as either a
 * Watchlist item id or a Title id.
 */
async function resolveWatchlistItem(
  userId: string,
  id: string
): Promise<{ id: string; titleId: string } | null> {
  if (!id) return null;

  return prisma.watchlist.findFirst({
    where: {
      userId,
      OR: [{ id }, { titleId: id }],
    },
    select: { id: true, titleId: true },
  });
}

const formatWatchlistItem = (item: any) => {
  if (!item) return null;
  return {
    ...item,
    _id: item.id,
    title: item.title ? { ...item.title, _id: item.title.id } : null,
  };
};

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

    const where: any = { userId };
    if (status === 'watched') {
      where.watched = true;
    } else if (status === 'want_to_watch') {
      where.watched = false;
    }

    const items = await prisma.watchlist.findMany({
      where,
      include: {
        title: true,
      },
      orderBy: { addedAt: 'desc' },
    });

    const validItems = items
      .filter((item) => item.title != null)
      .map(formatWatchlistItem);

    const [watchedCount, wantToWatchCount] = await Promise.all([
      prisma.watchlist.count({ where: { userId, watched: true } }),
      prisma.watchlist.count({ where: { userId, watched: false } }),
    ]);

    sendSuccess(
      res,
      {
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
    const titleExists = await prisma.title.findUnique({
      where: { id: titleId },
      select: { id: true },
    });
    if (!titleExists) {
      return next(new AppError('Title not found', 404));
    }

    const item = await prisma.watchlist.upsert({
      where: {
        userId_titleId: { userId, titleId },
      },
      create: {
        userId,
        titleId,
        watched: false,
      },
      update: {},
      include: { title: true },
    });

    sendSuccess(res, { item: formatWatchlistItem(item) }, 'Title added to watchlist successfully', 201);
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

    const id = String(req.params.id);

    const deleteResult = await prisma.watchlist.deleteMany({
      where: {
        userId,
        OR: [{ id }, { titleId: id }],
      },
    });

    if (deleteResult.count === 0) {
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

    const existing = await resolveWatchlistItem(userId, id);
    if (!existing) {
      return next(new AppError('Watchlist item not found', 404));
    }

    const item = await prisma.watchlist.update({
      where: { id: existing.id },
      data: {
        watched: Boolean(watched),
        watchedAt: watched ? new Date() : null,
      },
      include: { title: true },
    });

    if (watched) {
      await prisma.watchHistory.create({
        data: {
          userId,
          titleId: existing.titleId,
          action: 'watched',
          timestamp: new Date(),
        },
      });
    }

    sendSuccess(res, { item: formatWatchlistItem(item) }, watched ? 'Marked as watched' : 'Marked as unwatched');
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

    const existing = await resolveWatchlistItem(userId, id);
    if (!existing) {
      return next(new AppError(
        'This title is not in your watchlist. Add it before rating.',
        404
      ));
    }

    const item = await prisma.watchlist.update({
      where: { id: existing.id },
      data: {
        starRating: numRating,
        watched: true,
        watchedAt: new Date(),
      },
      include: { title: true },
    });

    await prisma.watchHistory.create({
      data: {
        userId,
        titleId: existing.titleId,
        action: 'rated',
        rating: numRating,
        timestamp: new Date(),
      },
    });

    sendSuccess(res, { item: formatWatchlistItem(item) }, 'Rating recorded successfully');
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

    const titleId = String(req.params.titleId);
    const item = await prisma.watchlist.findFirst({
      where: {
        userId,
        OR: [{ titleId }, { id: titleId }],
      },
    });

    sendSuccess(
      res,
      {
        inWatchlist: Boolean(item),
        watched: Boolean(item?.watched),
        starRating: item?.starRating || 0,
        item: item ? formatWatchlistItem(item) : null,
      },
      'Title watchlist status retrieved'
    );
  } catch (error) {
    next(error);
  }
};
