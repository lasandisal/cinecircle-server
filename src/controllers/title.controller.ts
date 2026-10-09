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
import { SoundtrackService } from '../services/SoundtrackService';
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

    const titleIds = titles.map((t) => t._id);
    const providers = await WatchProvider.find({ title: { $in: titleIds } }).lean();
    const providerMap = new Map<string, any[]>();
    for (const p of providers) {
      const key = p.title.toString();
      if (!providerMap.has(key)) providerMap.set(key, []);
      providerMap.get(key)!.push(p);
    }

    const localEnriched = titles.map((t) => ({
      ...t,
      watchProviders: providerMap.get(t._id.toString()) || [],
    }));

    // If TMDB key is available, supplement with live TMDB results
    if (tmdbService.hasApiKey()) {
      try {
        const tmdbResults = await tmdbService.searchTitles(q);
        const existingTmdbIds = new Set(titles.map((t) => t.tmdbId));
        const filteredTmdb = tmdbResults.filter((r) => !existingTmdbIds.has(r.tmdbId));
        sendSuccess(
          res,
          { titles: [...localEnriched, ...filteredTmdb].slice(0, 15) },
          'Titles retrieved (local DB + TMDB live)'
        );
        return;
      } catch (err: any) {
        console.warn('[searchTitles] TMDB live search failed, returning local:', err.message);
      }
    }

    sendSuccess(res, { titles: localEnriched }, 'Titles found');
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
    const requestedType =
      req.query.type === 'tv' || req.query.type === 'film' ? (req.query.type as 'tv' | 'film') : undefined;

    let title: any = null;

    // Check if valid ObjectId or TMDB ID
    if (mongoose.Types.ObjectId.isValid(titleId)) {
      title = await Title.findById(titleId).lean();
      // If requestedType doesn't match the DB title's type, ignore and fetch by tmdbId/type
      if (title && requestedType && title.type !== requestedType) {
        title = null;
      }
    }

    if (!title) {
      const tmdbIdNum = parseInt(titleId, 10);
      if (!isNaN(tmdbIdNum)) {
        const query: any = { tmdbId: tmdbIdNum };
        if (requestedType === 'tv' || requestedType === 'film') {
          query.type = requestedType;
        }
        title = await Title.findOne(query).lean();
      }
    }

    // If not found in DB, try fetching directly from TMDB service with requestedType and save to MongoDB
    if (!title) {
      const tmdbIdNum = parseInt(titleId, 10);
      if (!isNaN(tmdbIdNum)) {
        const tmdbData = await tmdbService.fetchDetails(tmdbIdNum, requestedType);
        if (tmdbData) {
          try {
            const created = await Title.create({
              tmdbId: tmdbData.tmdbId,
              name: tmdbData.name,
              type: tmdbData.type,
              genres: tmdbData.genres,
              synopsis: tmdbData.synopsis,
              runtimeMinutes: tmdbData.runtimeMinutes,
              posterUrl: tmdbData.posterUrl,
              backdropUrl: tmdbData.backdropUrl,
              releaseYear: tmdbData.releaseYear,
              voteAverage: tmdbData.voteAverage,
              moodTags: tmdbData.moodTags,
              cast: tmdbData.cast,
            });

            if (tmdbData.watchProviders && tmdbData.watchProviders.length > 0) {
              const providerDocs = tmdbData.watchProviders.map((wp) => ({
                title: created._id,
                service: wp.service,
                region: wp.region,
                type: wp.type,
              }));
              await WatchProvider.insertMany(providerDocs);
            }

            // Also persist seasons for TV series
            if (tmdbData.type === 'tv' && tmdbData.seasons && tmdbData.seasons.length > 0) {
              const seasonDocs = tmdbData.seasons.map((s) => ({
                title: created._id,
                seasonNumber: s.seasonNumber,
                episodes: Array.from({ length: Math.min(s.episodeCount || 10, 24) }, (_, idx) => ({
                  episodeNumber: idx + 1,
                  name: `Episode ${idx + 1}`,
                  summary: `${tmdbData.name} - Season ${s.seasonNumber}, Episode ${idx + 1}`,
                  runtimeMinutes: tmdbData.runtimeMinutes || 45,
                })),
              }));
              await SeasonEpisode.insertMany(seasonDocs);
            }

            title = created.toObject();
          } catch (dbErr) {
            // Handle race conditions or duplicate key error
            title = (await Title.findOne({ tmdbId: tmdbIdNum, type: tmdbData.type }).lean()) || tmdbData;
          }
        }
      }
    }

    if (!title) {
      res.status(404).json({ success: false, error: 'Title not found' });
      return;
    }

    // Fetch related models concurrently
    const titleObjId = title._id;
    let [watchProviders, seasons, soundtracks, allComments] = titleObjId
      ? await Promise.all([
          WatchProvider.find({ title: titleObjId }).lean(),
          SeasonEpisode.find({ title: titleObjId }).sort({ seasonNumber: 1 }).lean(),
          Soundtrack.find({ title: titleObjId }).sort({ popularityRank: 1 }).lean(),
          Comment.find({ title: titleObjId })
            .populate('user', 'name email role')
            .sort({ createdAt: 1 })
            .lean(),
        ])
      : [[], [], [], []];

    // Auto-refresh watch providers to ensure major global providers (Netflix, Prime Video, etc.) are present
    const hasBothNetflixAndPrime =
      watchProviders.some((p) => p.service.toLowerCase().includes('netflix')) &&
      watchProviders.some((p) => p.service.toLowerCase().includes('prime'));

    if (title.tmdbId && (!hasBothNetflixAndPrime || watchProviders.length === 0)) {
      try {
        const freshData = await tmdbService.fetchDetails(title.tmdbId, title.type);
        if (freshData?.watchProviders && freshData.watchProviders.length > 0) {
          await WatchProvider.deleteMany({ title: titleObjId });
          const newDocs = freshData.watchProviders.map((wp) => ({
            title: titleObjId,
            service: wp.service,
            region: wp.region,
            type: wp.type,
          }));
          watchProviders = (await WatchProvider.insertMany(newDocs)) as any;
        }
      } catch (err: any) {
        console.warn('[getTitleDetails] Error refreshing watch providers:', err.message);
      }
    }

    // 1. Curated & dynamic soundtracks with official 30-sec legal audio previews & album artwork
    let finalSoundtracks = soundtracks;
    const isRiverdale = title.name.toLowerCase().includes('riverdale');
    const needsRefresh =
      soundtracks.length === 0 ||
      !soundtracks.some((s) => s.previewUrl) ||
      (isRiverdale && !soundtracks.some((s) => s.songName.toLowerCase().includes('kids in america')));

    if (needsRefresh) {
      try {
        const dynamicTracks = await SoundtrackService.getSoundtracksForTitle(title.name);
        if (dynamicTracks.length > 0) {
          finalSoundtracks = dynamicTracks as any;
          if (titleObjId) {
            await Soundtrack.deleteMany({ title: titleObjId });
            const docs = dynamicTracks.map((dt) => ({
              title: titleObjId,
              songName: dt.songName,
              artist: dt.artist,
              episodeRef: dt.episodeRef,
              popularityRank: dt.popularityRank,
              previewUrl: dt.previewUrl,
              albumArtUrl: dt.albumArtUrl,
              spotifyUrl: dt.spotifyUrl,
            }));
            await Soundtrack.insertMany(docs);
          }
        }
      } catch (stErr: any) {
        console.warn('[getTitleDetails] Error discovering soundtracks:', stErr.message);
      }
    }

    // 2. Auto-enrich Season 1 episodes with real TMDB data and matched iconic songs
    if (title.type === 'tv' && title.tmdbId && seasons.length > 0) {
      const firstSeason = seasons[0];
      const hasGenericEpisodes =
        !firstSeason.episodes ||
        firstSeason.episodes.length === 0 ||
        firstSeason.episodes[0]?.name.match(/^Episode \d+$/i);
      const needsSongRefresh =
        hasGenericEpisodes ||
        firstSeason.episodes.some(
          (e: any) =>
            !e.featuredSong ||
            e.featuredSong.songName?.includes('Theme & Suite') ||
            e.featuredSong.songName?.includes('Symphonic Suite') ||
            (!e.featuredSong.previewUrl && finalSoundtracks.some((s: any) => s.previewUrl))
        );

      if (needsSongRefresh) {
        try {
          let baseEpisodes = firstSeason.episodes;
          if (hasGenericEpisodes) {
            const tmdbSeason = await tmdbService.fetchSeasonDetails(title.tmdbId, firstSeason.seasonNumber);
            if (tmdbSeason && tmdbSeason.episodes.length > 0) {
              baseEpisodes = tmdbSeason.episodes;
            }
          }

          if (baseEpisodes && baseEpisodes.length > 0) {
            const totalEps = baseEpisodes.length;
            const enriched = baseEpisodes.map((ep: any) => {
              const matched = SoundtrackService.matchSongForEpisode(
                finalSoundtracks as any,
                firstSeason.seasonNumber,
                ep.episodeNumber,
                totalEps,
                ep.name
              );
              return {
                ...ep,
                featuredSong: matched
                  ? {
                      songName: matched.songName,
                      artist: matched.artist,
                      sceneRef: matched.episodeRef,
                      previewUrl: matched.previewUrl,
                      albumArtUrl: matched.albumArtUrl,
                      spotifyUrl: matched.spotifyUrl,
                    }
                  : undefined,
              };
            });

            await SeasonEpisode.updateOne(
              { _id: firstSeason._id },
              { $set: { episodes: enriched } }
            );
            firstSeason.episodes = enriched as any;
          }
        } catch (err: any) {
          console.warn('[getTitleDetails] Error refreshing season 1 episodes & songs:', err.message);
        }
      }
    }

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
      soundtracks: finalSoundtracks,
      comments: commentsWithReplies,
    };

    sendSuccess(res, { title: fullDetail }, 'Title details retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Fetch detailed episodes for a specific season from MongoDB or TMDB
 */
export const getSeasonEpisodes = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const titleId = String(req.params.titleId);
    const seasonNumber = parseInt(String(req.params.seasonNumber), 10);
    if (isNaN(seasonNumber)) {
      res.status(400).json({ success: false, error: 'Invalid season number' });
      return;
    }

    let title: any = null;
    if (mongoose.Types.ObjectId.isValid(titleId)) {
      title = await Title.findById(titleId).lean();
    } else {
      const tmdbIdNum = parseInt(titleId, 10);
      if (!isNaN(tmdbIdNum)) {
        title = await Title.findOne({ tmdbId: tmdbIdNum }).lean();
      }
    }

    if (!title) {
      res.status(404).json({ success: false, error: 'Title not found' });
      return;
    }

    let seasonDoc = await SeasonEpisode.findOne({ title: title._id, seasonNumber }).lean();

    const hasGeneric =
      !seasonDoc ||
      !seasonDoc.episodes ||
      seasonDoc.episodes.length === 0 ||
      seasonDoc.episodes.some((e: any) => e.name && e.name.match(/^Episode \d+$/i));

    const needsSongEnrichment =
      hasGeneric ||
      (seasonDoc?.episodes?.some(
        (e: any) =>
          !e.featuredSong ||
          e.featuredSong.songName?.includes('Theme & Suite') ||
          e.featuredSong.songName?.includes('Symphonic Suite') ||
          !e.featuredSong.previewUrl
      ) ?? false);

    if (needsSongEnrichment && title.tmdbId) {
      let baseEpisodes = seasonDoc?.episodes || [];
      if (hasGeneric) {
        const tmdbSeason = await tmdbService.fetchSeasonDetails(title.tmdbId, seasonNumber);
        if (tmdbSeason && tmdbSeason.episodes.length > 0) {
          baseEpisodes = tmdbSeason.episodes;
        }
      }

      if (baseEpisodes.length > 0) {
        const songs = await SoundtrackService.getSoundtracksForTitle(title.name);
        const totalEps = baseEpisodes.length;
        const enriched = baseEpisodes.map((ep: any) => {
          const matched = SoundtrackService.matchSongForEpisode(
            songs,
            seasonNumber,
            ep.episodeNumber,
            totalEps,
            ep.name
          );
          return {
            ...ep,
            featuredSong: matched
              ? {
                  songName: matched.songName,
                  artist: matched.artist,
                  sceneRef: matched.episodeRef,
                  previewUrl: matched.previewUrl,
                  albumArtUrl: matched.albumArtUrl,
                  spotifyUrl: matched.spotifyUrl,
                }
              : undefined,
          };
        });

        seasonDoc = await SeasonEpisode.findOneAndUpdate(
          { title: title._id, seasonNumber },
          { $set: { title: title._id, seasonNumber, episodes: enriched } },
          { upsert: true, new: true }
        ).lean();
      }
    }

    sendSuccess(res, { season: seasonDoc }, 'Season episodes retrieved');
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

/**
 * Search iTunes Apple Music tracks for soundtrack contributor modal
 */
export const searchMusic = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = String(req.query.q || '');
    const tracks = await SoundtrackService.searchItunes(q);
    sendSuccess(res, { tracks }, 'Music search results retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Add an iconic track to a title's soundtrack catalog (crowdsourced / user contributed)
 */
export const addTitleSoundtrack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const titleId = String(req.params.titleId);
    const { songName, artist, episodeRef, previewUrl, albumArtUrl, spotifyUrl } = req.body;

    if (!songName || !artist) {
      res.status(400).json({ success: false, error: 'Song name and artist are required' });
      return;
    }

    let title: any = null;
    if (mongoose.Types.ObjectId.isValid(titleId)) {
      title = await Title.findById(titleId).lean();
    } else {
      const tmdbIdNum = parseInt(titleId, 10);
      if (!isNaN(tmdbIdNum)) {
        title = await Title.findOne({ tmdbId: tmdbIdNum }).lean();
      }
    }

    if (!title) {
      res.status(404).json({ success: false, error: 'Title not found' });
      return;
    }

    let finalPreview = previewUrl;
    let finalArt = albumArtUrl;
    let finalLink = spotifyUrl;

    if (!finalPreview || !finalArt) {
      const enriched = await SoundtrackService.enrichTrackWithAudio(songName, artist);
      finalPreview = finalPreview || enriched.previewUrl;
      finalArt = finalArt || enriched.albumArtUrl;
      finalLink = finalLink || enriched.appleMusicUrl;
    }

    const existingCount = await Soundtrack.countDocuments({ title: title._id });

    const created = await Soundtrack.create({
      title: title._id,
      songName: songName.trim(),
      artist: artist.trim(),
      episodeRef: episodeRef?.trim() || undefined,
      popularityRank: existingCount + 1,
      previewUrl: finalPreview,
      albumArtUrl: finalArt,
      spotifyUrl: finalLink,
    });

    sendSuccess(res, { soundtrack: created }, 'Song added to soundtrack successfully');
  } catch (error) {
    next(error);
  }
};

