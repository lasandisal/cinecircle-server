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

const ICONIC_SOUNDTRACKS: Record<string, { songName: string; artist: string; episodeRef: string; popularityRank: number }[]> = {
  friends: [
    { songName: "I'll Be There for You", artist: 'The Rembrandts', episodeRef: 'Main Theme & Central Perk Fountain', popularityRank: 1 },
    { songName: 'Smelly Cat', artist: 'Phoebe Buffay (Lisa Kudrow)', episodeRef: 'Central Perk Live Gig & Music Video', popularityRank: 2 },
    { songName: 'With or Without You', artist: 'U2', episodeRef: 'Ross Radio Dedication to Rachel', popularityRank: 3 },
    { songName: 'Wicked Game', artist: 'Chris Isaak', episodeRef: 'Hayden Planetarium Date Scene', popularityRank: 4 },
    { songName: 'Angel of the Morning', artist: 'Juice Newton', episodeRef: 'Central Perk Flashback Coffee Bar', popularityRank: 5 },
    { songName: 'Shiny Happy People', artist: 'R.E.M.', episodeRef: 'Green Apartment Celebration Party', popularityRank: 6 },
    { songName: 'You Were Meant for Me', artist: 'Jewel', episodeRef: 'Central Perk Heart-to-Heart', popularityRank: 7 },
  ],
  stranger_things: [
    { songName: 'Running Up That Hill (A Deal with God)', artist: 'Kate Bush', episodeRef: "Season 4 - Max's Mind Lair Escape", popularityRank: 1 },
    { songName: 'Master of Puppets', artist: 'Metallica', episodeRef: "Season 4 - Eddie's Upside Down Guitar Solo", popularityRank: 2 },
    { songName: 'Should I Stay or Should I Go', artist: 'The Clash', episodeRef: 'Season 1 - Castle Byers Transmission', popularityRank: 3 },
    { songName: 'Every Breath You Take', artist: 'The Police', episodeRef: 'Season 2 - Snow Ball 1984', popularityRank: 4 },
  ],
  the_bear: [
    { songName: 'New Noise', artist: 'Refused', episodeRef: 'Kitchen High-Pressure Rush Hour', popularityRank: 1 },
    { songName: 'Spiders (Kidsmoke)', artist: 'Wilco', episodeRef: 'Opening Morning Prep Montage', popularityRank: 2 },
    { songName: 'Let Down', artist: 'Radiohead', episodeRef: 'Season 1 Finale Family Dinner Service', popularityRank: 3 },
    { songName: 'Love Story (Taylor’s Version)', artist: 'Taylor Swift', episodeRef: "Season 2 - Richie's Staging Breakthrough Drive", popularityRank: 4 },
  ],
  succession: [
    { songName: 'Succession Main Title Theme', artist: 'Nicholas Britell', episodeRef: 'Roy Family Empire Opening Theme', popularityRank: 1 },
    { songName: 'Andante Risoluto', artist: 'Nicholas Britell', episodeRef: 'Season 2 Boardroom Showdown', popularityRank: 2 },
    { songName: 'Honesty', artist: 'Billy Joel', episodeRef: "Kendall's 40th Birthday Party", popularityRank: 3 },
  ],
  arcane: [
    { songName: 'Enemy', artist: 'Imagine Dragons & JID', episodeRef: 'Opening Theme & Zaun Underworld', popularityRank: 1 },
    { songName: 'Guns for Hire', artist: 'Woodkid', episodeRef: "Silco & Jinx's Pivotal River Pier Scene", popularityRank: 2 },
    { songName: 'What Could Have Been', artist: 'Sting & Ray Chen', episodeRef: 'Season 1 Climactic Finale Feast', popularityRank: 3 },
  ],
  interstellar: [
    { songName: 'Cornfield Chase', artist: 'Hans Zimmer', episodeRef: 'Drone Pursuit Through the Cornfield', popularityRank: 1 },
    { songName: 'No Time for Caution', artist: 'Hans Zimmer', episodeRef: 'Endurance Spinning Docking Sequence', popularityRank: 2 },
    { songName: 'Stay', artist: 'Hans Zimmer', episodeRef: "Murph's Bedroom Departure Farewell", popularityRank: 3 },
  ],
  dune: [
    { songName: 'Paul’s Dream', artist: 'Hans Zimmer', episodeRef: 'Visions of the Golden Path & Chani', popularityRank: 1 },
    { songName: 'Ripples in the Sand', artist: 'Hans Zimmer', episodeRef: 'Shai-Hulud Sandworm Awakening', popularityRank: 2 },
    { songName: 'Leaving Caladan', artist: 'Hans Zimmer', episodeRef: 'House Atreides Departure Fleet', popularityRank: 3 },
  ],
};

const getCuratedSoundtracks = (titleName: string) => {
  const norm = titleName.toLowerCase();
  for (const [key, songs] of Object.entries(ICONIC_SOUNDTRACKS)) {
    if (norm.includes(key.replace(/_/g, ' ')) || key.includes(norm)) {
      return songs;
    }
  }
  return [
    {
      songName: `${titleName} Official Main Theme & Suite`,
      artist: 'Original Motion Picture Score',
      episodeRef: 'Main Title / Opening Scene',
      popularityRank: 1,
    },
    {
      songName: `${titleName} End Credits Symphonic Suite`,
      artist: 'Original Motion Picture Soundtrack',
      episodeRef: 'Closing Credits Sequence',
      popularityRank: 2,
    },
  ];
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

    // If not found in DB, try fetching directly from TMDB service and save to MongoDB
    if (!title) {
      const tmdbIdNum = parseInt(titleId, 10);
      if (!isNaN(tmdbIdNum)) {
        const tmdbData = await tmdbService.fetchDetails(tmdbIdNum);
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
            title = (await Title.findOne({ tmdbId: tmdbIdNum }).lean()) || tmdbData;
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

    // Auto-refresh watch providers to ensure global providers like Netflix are present
    if (title.tmdbId && !watchProviders.some((p) => p.service.toLowerCase().includes('netflix'))) {
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

    // Auto-enrich Season 1 episodes with real TMDB data if only placeholder names exist
    if (title.type === 'tv' && title.tmdbId && seasons.length > 0) {
      const firstSeason = seasons[0];
      const hasGenericEpisodes =
        !firstSeason.episodes ||
        firstSeason.episodes.length === 0 ||
        firstSeason.episodes[0]?.name.match(/^Episode \d+$/i);

      if (hasGenericEpisodes) {
        try {
          const tmdbSeason = await tmdbService.fetchSeasonDetails(title.tmdbId, firstSeason.seasonNumber);
          if (tmdbSeason && tmdbSeason.episodes.length > 0) {
            const songs = getCuratedSoundtracks(title.name);
            const enriched = tmdbSeason.episodes.map((ep, idx) => ({
              ...ep,
              featuredSong: songs[idx % songs.length]
                ? {
                    songName: songs[idx % songs.length].songName,
                    artist: songs[idx % songs.length].artist,
                    sceneRef: songs[idx % songs.length].episodeRef,
                  }
                : undefined,
            }));

            await SeasonEpisode.updateOne(
              { _id: firstSeason._id },
              { $set: { episodes: enriched } }
            );
            firstSeason.episodes = enriched as any;
          }
        } catch (err: any) {
          console.warn('[getTitleDetails] Error refreshing season 1 episodes:', err.message);
        }
      }
    }

    // Curated soundtracks if none stored
    const finalSoundtracks =
      soundtracks.length > 0 ? soundtracks : getCuratedSoundtracks(title.name);

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

    if (hasGeneric && title.tmdbId) {
      const tmdbSeason = await tmdbService.fetchSeasonDetails(title.tmdbId, seasonNumber);
      if (tmdbSeason && tmdbSeason.episodes.length > 0) {
        const songs = getCuratedSoundtracks(title.name);
        const enriched = tmdbSeason.episodes.map((ep, idx) => ({
          ...ep,
          featuredSong: songs[idx % songs.length]
            ? {
                songName: songs[idx % songs.length].songName,
                artist: songs[idx % songs.length].artist,
                sceneRef: songs[idx % songs.length].episodeRef,
              }
            : undefined,
        }));

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
