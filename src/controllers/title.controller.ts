import { Request, Response, NextFunction } from 'express';
import {
  Title,
  WatchProvider,
  SeasonEpisode,
  Soundtrack,
  Comment,
} from '../models';
import { tmdbService } from '../services/TmdbService';
import { SeedService } from '../services/SeedService';
import { sendSuccess } from '../utils/response';
import type { IAuthRequest } from '../types';
import mongoose from 'mongoose';

/**
 * List titles with filtering by genre, type, streaming service, mood tag, and search
 */
export const getTitles = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { genre, type, service, mood, search, page = '1', limit = '20' } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(50, Math.max(1, parseInt(limit as string, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const filter: any = {};

    if (type && (type === 'film' || type === 'tv')) {
      filter.type = type;
    }

    if (genre && typeof genre === 'string') {
      filter.genres = { $regex: new RegExp(`^${genre.trim()}$`, 'i') };
    }

    if (mood && typeof mood === 'string') {
      filter.moodTags = { $regex: new RegExp(mood.trim(), 'i') };
    }

    if (search && typeof search === 'string') {
      filter.$or = [
        { name: { $regex: search.trim(), $options: 'i' } },
        { synopsis: { $regex: search.trim(), $options: 'i' } },
        { 'cast.actorName': { $regex: search.trim(), $options: 'i' } },
      ];
    }

    // Filter by streaming service if requested
    if (service && typeof service === 'string') {
      const providers = await WatchProvider.find({
        service: { $regex: new RegExp(service.trim(), 'i') },
      }).select('title');

      const titleIds = providers.map((p) => p.title);
      filter._id = { $in: titleIds };
    }

    const [titles, total] = await Promise.all([
      Title.find(filter)
        .sort({ voteAverage: -1, releaseYear: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Title.countDocuments(filter),
    ]);

    // Attach streaming providers to each title
    const titleIds = titles.map((t) => t._id);
    const allProviders = await WatchProvider.find({ title: { $in: titleIds } }).lean();

    const providerMap = new Map<string, any[]>();
    for (const p of allProviders) {
      const key = p.title.toString();
      if (!providerMap.has(key)) providerMap.set(key, []);
      providerMap.get(key)!.push(p);
    }

    const titlesWithProviders = titles.map((t) => ({
      ...t,
      watchProviders: providerMap.get(t._id.toString()) || [],
    }));

    sendSuccess(
      res,
      {
        titles: titlesWithProviders,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum),
        },
      },
      'Titles retrieved successfully'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get trending titles (live from TMDB or top database titles)
 */
export const getTrendingTitles = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { mediaType = 'all' } = req.query;

    // First attempt to get from database
    const query: any = {};
    if (mediaType === 'movie') query.type = 'film';
    if (mediaType === 'tv') query.type = 'tv';

    const dbTitles = await Title.find(query)
      .sort({ voteAverage: -1, releaseYear: -1 })
      .limit(12)
      .lean();

    if (dbTitles.length > 0) {
      const titleIds = dbTitles.map((t) => t._id);
      const providers = await WatchProvider.find({ title: { $in: titleIds } }).lean();
      const providerMap = new Map<string, any[]>();
      for (const p of providers) {
        const key = p.title.toString();
        if (!providerMap.has(key)) providerMap.set(key, []);
        providerMap.get(key)!.push(p);
      }

      const results = dbTitles.map((t) => ({
        ...t,
        watchProviders: providerMap.get(t._id.toString()) || [],
      }));

      sendSuccess(res, { titles: results }, 'Trending titles retrieved');
      return;
    }

    // Fallback directly to tmdbService
    const trending = await tmdbService.fetchTrending(mediaType as any);
    sendSuccess(res, { titles: trending }, 'Trending titles retrieved from TMDB service');
  } catch (error) {
    next(error);
  }
};

/**
 * Search titles across local DB and TMDB
 */
export const searchTitles = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { q, type } = req.query;
    if (!q || typeof q !== 'string') {
      sendSuccess(res, { titles: [] }, 'No query provided');
      return;
    }

    // Search local database first
    const regex = new RegExp(q.trim(), 'i');
    const filter: any = {
      $or: [{ name: regex }, { genres: regex }, { moodTags: regex }],
    };
    if (type && (type === 'film' || type === 'tv')) filter.type = type;

    let titles = await Title.find(filter).limit(10).lean();

    if (titles.length === 0) {
      // Search TMDB live
      const tmdbResults = await tmdbService.searchTitles(q);
      sendSuccess(res, { titles: tmdbResults }, 'Titles retrieved from TMDB search');
      return;
    }

    const titleIds = titles.map((t) => t._id);
    const providers = await WatchProvider.find({ title: { $in: titleIds } }).lean();
    const providerMap = new Map<string, any[]>();
    for (const p of providers) {
      const key = p.title.toString();
      if (!providerMap.has(key)) providerMap.set(key, []);
      providerMap.get(key)!.push(p);
    }

    const enriched = titles.map((t) => ({
      ...t,
      watchProviders: providerMap.get(t._id.toString()) || [],
    }));

    sendSuccess(res, { titles: enriched }, 'Titles found');
  } catch (error) {
    next(error);
  }
};

/**
 * Get all available genres
 */
export const getGenres = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const dbGenres = await Title.distinct('genres');
    const canonicalGenres = tmdbService.getAllGenres();
    const combined = Array.from(new Set([...dbGenres, ...canonicalGenres])).sort();

    sendSuccess(res, { genres: combined }, 'Genres retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Get full title details including watch providers, seasons/episodes, soundtracks, and comments
 */
export const getTitleDetails = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const titleId = String(req.params.titleId);

    let title: any = null;

    // Check if valid ObjectId or TMDB ID
    if (mongoose.Types.ObjectId.isValid(titleId)) {
      title = await Title.findById(titleId).lean();
    } else {
      const tmdbIdNum = parseInt(titleId, 10);
      if (!isNaN(tmdbIdNum)) {
        title = await Title.findOne({ tmdbId: tmdbIdNum }).lean();
      }
    }

    // If not found in DB, try fetching directly from TMDB service
    if (!title) {
      const tmdbIdNum = parseInt(titleId, 10);
      if (!isNaN(tmdbIdNum)) {
        const tmdbData = await tmdbService.fetchDetails(tmdbIdNum, 'film');
        if (tmdbData) {
          sendSuccess(res, { title: tmdbData }, 'Title details retrieved from TMDB');
          return;
        }
      }
      res.status(404).json({ success: false, error: 'Title not found' });
      return;
    }

    // Fetch related models concurrently
    const [watchProviders, seasons, soundtracks, allComments] = await Promise.all([
      WatchProvider.find({ title: title._id }).lean(),
      SeasonEpisode.find({ title: title._id }).sort({ seasonNumber: 1 }).lean(),
      Soundtrack.find({ title: title._id }).sort({ popularityRank: 1 }).lean(),
      Comment.find({ title: title._id })
        .populate('user', 'name email role')
        .sort({ createdAt: 1 })
        .lean(),
    ]);

    // Group replies under top-level parent comments
    const parentComments: any[] = [];
    const replyMap = new Map<string, any[]>();

    for (const c of allComments) {
      if (c.parentId) {
        const pid = c.parentId.toString();
        if (!replyMap.has(pid)) replyMap.set(pid, []);
        replyMap.get(pid)!.push(c);
      } else {
        parentComments.push(c);
      }
    }

    const commentsWithReplies = parentComments
      .map((p) => ({
        ...p,
        replies: replyMap.get(p._id.toString()) || [],
      }))
      .reverse();

    const fullDetail = {
      ...title,
      watchProviders,
      seasons,
      soundtracks,
      comments: commentsWithReplies,
    };

    sendSuccess(res, { title: fullDetail }, 'Title details retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Trigger manual catalog seeding
 */
export const seedTitles = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const force = req.query.force === 'true';
    const result = await SeedService.seedAll(force);
    sendSuccess(res, result, 'Catalogue seeded successfully', 201);
  } catch (error) {
    next(error);
  }
};

/**
 * Add a discussion comment on a title (supports top-level, replies, and polls)
 */
export const addComment = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const titleId = String(req.params.titleId);
    const text = req.body.text || req.body.body;
    const { containsSpoilers = false, parentId, poll } = req.body;

    if (!text || !text.trim()) {
      res.status(400).json({ success: false, error: 'Comment text is required' });
      return;
    }

    const title = await Title.findById(titleId);
    if (!title) {
      res.status(404).json({ success: false, error: 'Title not found' });
      return;
    }

    const rating = req.body.rating ? Number(req.body.rating) : undefined;

    let pollData: any = undefined;
    if (poll && poll.question && Array.isArray(poll.options) && poll.options.length >= 2) {
      pollData = {
        question: poll.question.trim(),
        options: poll.options.map((opt: any) => ({
          optionText: typeof opt === 'string' ? opt.trim() : (opt.optionText || '').trim(),
          votes: [],
        })),
      };
    }

    const comment = await Comment.create({
      title: title._id,
      user: req.user?.id,
      text: text.trim(),
      rating,
      likesCount: 0,
      parentId: parentId || null,
      poll: pollData,
      reactions: [],
      containsSpoilers: !!containsSpoilers,
    });

    const populated = await Comment.findById(comment._id).populate('user', 'name email role');

    sendSuccess(res, { comment: populated }, 'Comment added successfully', 201);
  } catch (error) {
    next(error);
  }
};

/**
 * Get comments for a title with nested replies
 */
export const getComments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const titleId = String(req.params.titleId);
    const allComments = await Comment.find({ title: titleId })
      .populate('user', 'name email role')
      .sort({ createdAt: 1 })
      .lean();

    const parentComments: any[] = [];
    const replyMap = new Map<string, any[]>();

    for (const c of allComments) {
      if (c.parentId) {
        const pid = c.parentId.toString();
        if (!replyMap.has(pid)) replyMap.set(pid, []);
        replyMap.get(pid)!.push(c);
      } else {
        parentComments.push(c);
      }
    }

    const commentsWithReplies = parentComments
      .map((p) => ({
        ...p,
        replies: replyMap.get(p._id.toString()) || [],
      }))
      .reverse();

    sendSuccess(res, { comments: commentsWithReplies }, 'Comments retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Like a discussion comment
 */
export const likeComment = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const commentId = String(req.params.commentId);
    const comment = await Comment.findByIdAndUpdate(
      commentId,
      { $inc: { likesCount: 1 } },
      { new: true }
    ).populate('user', 'name email role');

    if (!comment) {
      res.status(404).json({ success: false, error: 'Comment not found' });
      return;
    }

    sendSuccess(res, { comment }, 'Comment liked');
  } catch (error) {
    next(error);
  }
};

/**
 * React to a comment with Facebook-style emojis (like, love, fire, mindblown, popcorn, sad)
 */
export const reactToComment = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const commentId = String(req.params.commentId);
    const { emoji } = req.body;
    const userId = req.user?.id;

    if (!['like', 'love', 'fire', 'mindblown', 'popcorn', 'sad'].includes(emoji)) {
      res.status(400).json({ success: false, error: 'Invalid reaction emoji' });
      return;
    }

    const comment = await Comment.findById(commentId);
    if (!comment) {
      res.status(404).json({ success: false, error: 'Comment not found' });
      return;
    }

    const existingIndex = (comment.reactions || []).findIndex(
      (r) => r.user.toString() === userId && r.emoji === emoji
    );

    if (existingIndex > -1) {
      // Toggle off existing same emoji
      comment.reactions!.splice(existingIndex, 1);
    } else {
      // Remove other emoji by this user, then add new one
      comment.reactions = (comment.reactions || []).filter((r) => r.user.toString() !== userId);
      comment.reactions.push({ user: new mongoose.Types.ObjectId(userId), emoji } as any);
    }

    await comment.save();
    const populated = await Comment.findById(comment._id).populate('user', 'name email role');
    sendSuccess(res, { comment: populated }, 'Reaction updated');
  } catch (error) {
    next(error);
  }
};

/**
 * Vote on a comment poll
 */
export const voteCommentPoll = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const commentId = String(req.params.commentId);
    const { optionIndex } = req.body;
    const userId = req.user?.id;

    const comment = await Comment.findById(commentId);
    if (!comment || !comment.poll || !comment.poll.options[optionIndex]) {
      res.status(404).json({ success: false, error: 'Poll or option not found' });
      return;
    }

    const uObjectId = new mongoose.Types.ObjectId(userId);

    // Remove user's previous vote from all options in this poll
    comment.poll.options.forEach((opt) => {
      opt.votes = opt.votes.filter((v) => v.toString() !== userId);
    });

    // Add vote to chosen option
    comment.poll.options[optionIndex].votes.push(uObjectId);

    await comment.save();
    const populated = await Comment.findById(comment._id).populate('user', 'name email role');
    sendSuccess(res, { comment: populated }, 'Poll vote recorded');
  } catch (error) {
    next(error);
  }
};
