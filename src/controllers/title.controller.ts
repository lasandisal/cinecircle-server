import { Request, Response, NextFunction } from 'express';
import {
  Title,
  WatchProvider,
  SeasonEpisode,
  Soundtrack,
  Comment,
  Watchlist,
} from '../models';
import { tmdbService } from '../services/TmdbService';
import { SeedService } from '../services/SeedService';
import { SoundtrackService } from '../services/SoundtrackService';
import { FollowService } from '../services/follow.service';
import { sendSuccess } from '../utils/response';
import type { IAuthRequest } from '../types';
import mongoose from 'mongoose';

/**
 * How long we trust previously fetched external data before re-checking it.
 * Without these, every single page load re-ran TMDB + iTunes lookups because the
 * enrichment could never be marked "done" (see isSoundtrackVerified).
 */
const SOUNDTRACK_REFRESH_TTL_MS = 24 * 60 * 60 * 1000;
const SEASON_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * Shorter backoff for a season that still looks incomplete after a sync. TMDB
 * publishes episode titles/overviews inconsistently (some shows have them for 4
 * of 31 episodes), so an incomplete season is retried sooner - but not on every
 * request, which would hammer TMDB whenever it is having a bad day.
 */
const SEASON_REFRESH_RETRY_MS = 30 * 60 * 1000;
const WATCH_PROVIDER_REFRESH_TTL_MS = 24 * 60 * 60 * 1000;

function isFresh(dateValue: any, ttlMs: number): boolean {
  if (!dateValue) return false;
  const time = new Date(dateValue).getTime();
  return Number.isFinite(time) && Date.now() - time < ttlMs;
}

/**
 * Escape user input before it is handed to MongoDB as a $regex.
 * Without this, searching "C++" or "Spider-Man (2023)" makes the driver throw and
 * the whole request 500s instead of returning results.
 */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Detect the machine-written filler summaries this app used to persist.
 *
 * The enrichment step wrote "Dune: Part Two - Season 1, Episode 3" as a summary,
 * then on the very next load treated that string as a real summary (>10 chars)
 * and let it outrank the genuine TMDB overview - locking every episode to
 * placeholder text permanently.
 */
function isGeneratedSummary(summary?: string): boolean {
  if (!summary) return true;
  const s = summary.trim().toLowerCase();
  if (s.length === 0) return true;
  return (
    s.includes('the central narrative and character relationships deepen') ||
    /-\s*season\s+\d+\s*,\s*episode\s+\d+\s*$/.test(s) ||
    /^\s*episode\s+\d+\s*$/.test(s)
  );
}

/**
 * Flatten a flat comment list into parent comments carrying their replies.
 *
 * This exact grouping block was duplicated in three places; it is also where
 * moderation state is stripped so reporters' identities never leak publicly.
 */
function groupCommentsForDisplay(comments: any[], viewerId?: string): any[] {
  const parents: any[] = [];
  const replies = new Map<string, any[]>();

  const sanitise = (c: any) => {
    const reports: any[] = c.reports || [];
    // Strip moderation internals; expose only whether *this* viewer reported.
    const { reports: _r, hidden: _h, hiddenBy: _hb, hiddenAt: _ha, reported: _rep, reportedAt: _ra, ...rest } = c;
    return {
      ...rest,
      reportCount: reports.length,
      reportedByMe: viewerId ? reports.some((r) => r.user?.toString() === viewerId) : false,
    };
  };

  for (const raw of comments) {
    const c = sanitise(raw);
    if (c.parentId) {
      const pid = c.parentId.toString();
      if (!replies.has(pid)) replies.set(pid, []);
      replies.get(pid)!.push(c);
    } else {
      parents.push(c);
    }
  }

  return parents
    .map((p) => ({ ...p, replies: replies.get(p._id.toString()) || [] }))
    .reverse();
}

/** An episode name of "Episode 7" means we never got real TMDB data for it. */
function isPlaceholderEpisodeName(name?: string): boolean {
  return !name || /^episode\s*\d*$/i.test(name.trim());
}

/**
 * Detect a partially seeded episode list.
 *
 * The bundled catalogue ships incomplete seasons (Stranger Things S1 contains
 * only episodes 1, 2, 3 and 8). Because those episodes have real names, the old
 * "is episode[0] a placeholder?" check concluded the season was complete, so
 * episodes 4-7 - and their summaries - were never fetched from TMDB. A real
 * season's numbering is contiguous from 1.
 */
function hasEpisodeGaps(episodes: any[]): boolean {
  if (!Array.isArray(episodes) || episodes.length === 0) return true;
  const numbers = episodes
    .map((e: any) => Number(e?.episodeNumber))
    .filter((n: number) => Number.isFinite(n))
    .sort((a: number, b: number) => a - b);
  if (numbers.length === 0) return true;
  return numbers.some((n: number, index: number) => n !== index + 1);
}

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
      filter.genres = { $regex: new RegExp(`^${escapeRegex(genre.trim())}$`, 'i') };
    }

    if (mood && typeof mood === 'string') {
      filter.moodTags = { $regex: new RegExp(escapeRegex(mood.trim()), 'i') };
    }

    if (search && typeof search === 'string') {
      const safeSearch = escapeRegex(search.trim());
      filter.$or = [
        { name: { $regex: safeSearch, $options: 'i' } },
        { synopsis: { $regex: safeSearch, $options: 'i' } },
        { 'cast.actorName': { $regex: safeSearch, $options: 'i' } },
      ];
    }

    // Filter by streaming service if requested
    if (service && typeof service === 'string') {
      const providers = await WatchProvider.find({
        service: { $regex: new RegExp(escapeRegex(service.trim()), 'i') },
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
    const regex = new RegExp(escapeRegex(q.trim()), 'i');
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
 * Universal verification to ensure soundtracks are authentic, correct, and have audio previews.
 * If unverified or mismatched, the system dynamically re-identifies the title and discovers the real songs.
 */
function isSoundtrackVerified(title: any, soundtracks: any[]): boolean {
  if (!soundtracks || soundtracks.length === 0) return false;

  // 1. Must have audio previews
  const hasPreviews = soundtracks.some((s) => s.previewUrl);
  if (!hasPreviews) return false;

  // 2. Reject if single placeholder generic theme
  if (soundtracks.length === 1 && soundtracks[0].songName?.includes('Official Main Theme & Score')) {
    return false;
  }

  const titleNameLower = (title.name || '').toLowerCase().trim();

  // 3. Medium & content integrity checks
  for (const s of soundtracks) {
    const songLower = (s.songName || '').toLowerCase();
    const artistLower = (s.artist || '').toLowerCase();
    const refLower = (s.episodeRef || s.sceneRef || '').toLowerCase();

    // Reject cross-medium: TV show having Motion Picture soundtrack
    if (title.type === 'tv' && (refLower.includes('motion picture') || refLower.includes('movie soundtrack'))) {
      return false;
    }

    // Specific false positive catches
    if (titleNameLower.includes('gossip girl') && (songLower.includes('another day of sun') || artistLower.includes('la la land'))) {
      return false;
    }
    if (!titleNameLower.includes('la la land') && artistLower.includes('la la land cast')) {
      return false;
    }
    if (
      titleNameLower.includes('lucifer') &&
      (songLower.includes('raftaara') ||
        artistLower.includes('deepak dev') ||
        artistLower.includes('atom music audio') ||
        songLower.includes('cinderella') ||
        artistLower.includes('karthik'))
    ) {
      return false;
    }
    if (titleNameLower.includes('the originals') && artistLower.includes('prince')) {
      return false;
    }
    if (titleNameLower.includes('the heirs') && (refLower.includes('ecliptic') || artistLower === 'the heirs')) {
      return false;
    }
    if (titleNameLower.includes('boys over flowers') && !soundtracks.some((st) => st.songName.includes('파라다이스'))) {
      return false;
    }
    if (titleNameLower.includes('riverdale') && !soundtracks.some((st) => st.songName.toLowerCase().includes('kids in america'))) {
      return false;
    }
    if (titleNameLower.includes('gossip girl') && !soundtracks.some((st) => st.songName.toLowerCase().includes('road to nowhere'))) {
      return false;
    }
    if (titleNameLower.includes('lucifer') && !soundtracks.some((st) => st.songName.toLowerCase().includes('hell') || st.songName.toLowerCase().includes('breath'))) {
      return false;
    }
    if (
      (titleNameLower.includes('laftan') || titleNameLower.includes('anlamaz')) &&
      (!soundtracks[0] || (!soundtracks[0].artist?.toLowerCase().includes('kıvılcım') && !soundtracks[0].artist?.toLowerCase().includes('kivilcim')))
    ) {
      return false;
    }
  }

  // 4. Reject naive repetitions (e.g. tracks repeating title name instead of real songs)
  const titleWords = titleNameLower
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w: string) => w.length > 2 && !['the', 'and', 'for', 'from', 'with'].includes(w));

  if (titleWords.length > 0) {
    const matchingTitleCount = soundtracks.filter((s) =>
      titleWords.every((w: string) => (s.songName || '').toLowerCase().includes(w))
    ).length;
    if (soundtracks.length > 0 && matchingTitleCount >= 2 && matchingTitleCount >= soundtracks.length * 0.7) {
      return false;
    }
  }

  return true;
}

/**
 * Get full title details including watch providers, seasons/episodes, soundtracks, and comments
 */
export const getTitleDetails = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
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
              originalName: tmdbData.originalName,
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
    let [watchProviders, seasons, soundtracks, allComments, watcherDocs] = titleObjId
      ? await Promise.all([
          WatchProvider.find({ title: titleObjId }).lean(),
          SeasonEpisode.find({ title: titleObjId }).sort({ seasonNumber: 1 }).lean(),
          Soundtrack.find({ title: titleObjId }).sort({ popularityRank: 1 }).lean(),
          // Hidden comments are removed by a curator and must never be served.
          Comment.find({ title: titleObjId, hidden: false })
            .populate('user', 'name email role')
            .sort({ createdAt: 1 })
            .lean(),
          Watchlist.find({ title: titleObjId, watched: true })
            .populate('user', 'name handle avatar email')
            .sort({ watchedAt: -1, addedAt: -1 })
            .limit(10)
            .lean(),
        ])
      : [[], [], [], [], []];

    // --- One shared TMDB fetch for both providers and seasons -------------------
    // These used to be two separate `tmdbService.fetchDetails()` calls, each of which
    // can hit TMDB twice (movie then tv) with an 8s timeout. One call now serves both.
    const hasBothNetflixAndPrime =
      watchProviders.some((p) => p.service.toLowerCase().includes('netflix')) &&
      watchProviders.some((p) => p.service.toLowerCase().includes('prime'));

    const providersAreStale =
      watchProviders.length === 0 ||
      !watchProviders.some((p: any) => isFresh(p.sourceUpdatedAt, WATCH_PROVIDER_REFRESH_TTL_MS));

    const needsProviders = title.tmdbId && (!hasBothNetflixAndPrime || providersAreStale);
    const needsSeasons = title.type === 'tv' && title.tmdbId && seasons.length === 0;

    if (needsProviders || needsSeasons) {
      try {
        const freshData = await tmdbService.fetchDetails(title.tmdbId, title.type);

        if (needsProviders && freshData?.watchProviders && freshData.watchProviders.length > 0) {
          await WatchProvider.deleteMany({ title: titleObjId });
          const now = new Date();
          const newDocs = freshData.watchProviders.map((wp) => ({
            title: titleObjId,
            service: wp.service,
            region: wp.region,
            type: wp.type,
            sourceUpdatedAt: now,
          }));
          watchProviders = (await WatchProvider.insertMany(newDocs)) as any;
        }

        if (needsSeasons && freshData?.seasons && freshData.seasons.length > 0) {
          const seasonDocs = freshData.seasons.map((s) => ({
            title: titleObjId,
            seasonNumber: s.seasonNumber,
            episodes: [],
          }));
          await SeasonEpisode.insertMany(seasonDocs);
          seasons = await SeasonEpisode.find({ title: titleObjId }).sort({ seasonNumber: 1 }).lean();
        }
      } catch (err: any) {
        console.warn('[getTitleDetails] Error refreshing providers/seasons:', err.message);
      }
    }

    // 1. Curated & dynamic soundtracks with official 30-sec legal audio previews & album artwork
    let finalSoundtracks = soundtracks;

    // isSoundtrackVerified() rejects an empty list and the "{Title} Official Main
    // Theme & Score" placeholder, which getSoundtracksForTitle() emits when it
    // finds nothing. That combination meant discovery re-ran on *every* request
    // forever. A recent sourceUpdatedAt now latches the result so the ~20-query
    // pipeline only runs once per day (and is memory-cached on top of that).
    const lastSoundtrackRefresh = soundtracks.reduce((latest: number, s: any) => {
      const at = s.sourceUpdatedAt ? new Date(s.sourceUpdatedAt).getTime() : 0;
      return at > latest ? at : latest;
    }, 0);
    const soundtracksRecentlyDiscovered =
      lastSoundtrackRefresh > 0 && Date.now() - lastSoundtrackRefresh < SOUNDTRACK_REFRESH_TTL_MS;

    const isVerified = soundtracksRecentlyDiscovered || isSoundtrackVerified(title, soundtracks);

    if (!isVerified) {
      try {
        const dynamicTracks = await SoundtrackService.getSoundtracksForTitle(
          title.name,
          (title as any).originalName,
          title.type as any,
          title.releaseYear
        );
        if (dynamicTracks.length > 0) {
          finalSoundtracks = dynamicTracks as any;
          if (titleObjId) {
            // Only replace rows this service owns. Previously this was an
            // unqualified deleteMany(), which wiped songs members had
            // contributed through the "Suggest Song" modal.
            await Soundtrack.deleteMany({ title: titleObjId, source: 'auto' });
            const now = new Date();
            const docs = dynamicTracks.map((dt) => ({
              title: titleObjId,
              songName: dt.songName,
              artist: dt.artist,
              episodeRef: dt.episodeRef,
              popularityRank: dt.popularityRank,
              previewUrl: dt.previewUrl,
              albumArtUrl: dt.albumArtUrl,
              spotifyUrl: dt.spotifyUrl,
              source: 'auto' as const,
              sourceUpdatedAt: now,
            }));
            const inserted = await Soundtrack.insertMany(docs);
            // Re-read so the response shows the merged catalogue: the newly
            // discovered tracks *plus* curated, legacy and member-contributed
            // rows. Returning `inserted` alone would hide those from the page.
            const merged = await Soundtrack.find({ title: titleObjId }).sort({ popularityRank: 1 }).lean();
            finalSoundtracks = (merged.length > 0 ? merged : inserted) as any;
          }
        }
      } catch (stErr: any) {
        console.warn('[getTitleDetails] Error discovering soundtracks:', stErr.message);
      }
    }

    // 2. Auto-enrich Season 1 episodes with real TMDB data and matched iconic songs
    if (title.type === 'tv' && title.tmdbId && seasons.length > 0) {
      const firstSeason = seasons[0];
      const existingEpisodes = firstSeason.episodes || [];

      // Only episodes[0] used to be inspected, so a partially seeded season
      // (Stranger Things S1 shipped 4 of 8 episodes with real names) was treated
      // as complete and the missing episodes were never backfilled.
      const seasonLooksIncomplete =
        existingEpisodes.length === 0 ||
        hasEpisodeGaps(existingEpisodes) ||
        existingEpisodes.some(
          (e: any) => isPlaceholderEpisodeName(e.name) || isGeneratedSummary(e.summary)
        );

      // Incomplete seasons retry on a short backoff; complete ones are trusted
      // for a week. Decided at read time so a failed sync doesn't need to store
      // its own TTL.
      const seasonTtl = seasonLooksIncomplete ? SEASON_REFRESH_RETRY_MS : SEASON_REFRESH_TTL_MS;
      const seasonIsStale = !isFresh(firstSeason.sourceUpdatedAt, seasonTtl);
      const needsEpisodeDataRefresh = seasonLooksIncomplete && seasonIsStale;

      const firstSeasonSongs = existingEpisodes.map((e: any) => e.featuredSong).filter(Boolean);
      const isSeasonSongsVerified = isSoundtrackVerified(title, firstSeasonSongs);

      const needsSongRefresh =
        !isVerified ||
        !isSeasonSongsVerified ||
        firstSeason.episodes.some(
          (e: any) =>
            !e.featuredSong ||
            e.featuredSong.songName?.includes('Theme & Suite') ||
            e.featuredSong.songName?.includes('Symphonic Suite') ||
            (!e.featuredSong.previewUrl && finalSoundtracks.some((s: any) => s.previewUrl))
        );

      if (needsEpisodeDataRefresh || needsSongRefresh) {
        try {
          let baseEpisodes: any[] = existingEpisodes;

          if (needsEpisodeDataRefresh) {
            const tmdbSeason = await tmdbService.fetchSeasonDetails(title.tmdbId, firstSeason.seasonNumber);
            if (tmdbSeason && tmdbSeason.episodes.length > 0) {
              baseEpisodes = tmdbSeason.episodes.map((tmdbEp: any) => {
                const existing = existingEpisodes.find((e: any) => e.episodeNumber === tmdbEp.episodeNumber);
                // Generated filler must NOT outrank the genuine TMDB overview.
                const hasExistingSummary =
                  !!existing && !isGeneratedSummary(existing.summary) && existing.summary.trim().length > 10;
                const hasTmdbSummary = !!tmdbEp.summary && tmdbEp.summary.trim().length > 10;
                return {
                  ...tmdbEp,
                  summary: hasExistingSummary
                    ? existing.summary
                    : hasTmdbSummary
                      ? tmdbEp.summary
                      : existing?.summary && !isGeneratedSummary(existing.summary)
                        ? existing.summary
                        : '',
                  name: existing?.name && !isPlaceholderEpisodeName(existing.name) ? existing.name : tmdbEp.name,
                  featuredSong: existing?.featuredSong,
                };
              });
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
                // Keep whatever was already stored when nothing new matched,
                // otherwise a no-match silently erased the episode's song.
                featuredSong: matched
                  ? {
                      songName: matched.songName,
                      artist: matched.artist,
                      sceneRef: matched.episodeRef,
                      previewUrl: matched.previewUrl,
                      albumArtUrl: matched.albumArtUrl,
                      spotifyUrl: matched.spotifyUrl,
                    }
                  : ep.featuredSong,
              };
            });

            await SeasonEpisode.updateOne(
              { _id: firstSeason._id },
              {
                $set: {
                  episodes: enriched,
                  // Stamp the season so the TMDB episode fetch only re-runs when stale.
                  ...(needsEpisodeDataRefresh ? { sourceUpdatedAt: new Date() } : {}),
                },
              }
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

    const commentsWithReplies = groupCommentsForDisplay(
      allComments,
      (req as IAuthRequest).user?.id
    );

    const communityWatchers = (watcherDocs || [])
      .filter((w: any) => w.user != null)
      .map((w: any) => ({
        userId: w.user._id,
        name: w.user.name,
        handle: w.user.handle,
        avatar: w.user.avatar,
        starRating: w.starRating,
        watchedAt: w.watchedAt || w.addedAt,
      }));

    const fullDetail = {
      ...title,
      watchProviders,
      seasons,
      soundtracks: finalSoundtracks,
      comments: commentsWithReplies,
      communityWatchers,
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

    const existingEpisodes = seasonDoc?.episodes || [];

    // Inspect every episode, not just the first, treat machine-written filler
    // summaries as "missing", and detect gaps so partial seeds get backfilled.
    const seasonLooksIncomplete =
      existingEpisodes.length === 0 ||
      hasEpisodeGaps(existingEpisodes) ||
      existingEpisodes.some((e: any) => isPlaceholderEpisodeName(e.name) || isGeneratedSummary(e.summary));

    const seasonTtl = seasonLooksIncomplete ? SEASON_REFRESH_RETRY_MS : SEASON_REFRESH_TTL_MS;
    const seasonIsStale = !isFresh(seasonDoc?.sourceUpdatedAt, seasonTtl);
    const needsEpisodeDataRefresh = seasonLooksIncomplete && seasonIsStale;

    const seasonSongs = existingEpisodes.map((e: any) => e.featuredSong).filter(Boolean);
    const isSeasonSongsVerified = isSoundtrackVerified(title, seasonSongs);

    const needsSongEnrichment =
      !isSeasonSongsVerified ||
      (existingEpisodes.some(
        (e: any) =>
          !e.featuredSong ||
          e.featuredSong.songName?.includes('Theme & Suite') ||
          e.featuredSong.songName?.includes('Symphonic Suite') ||
          !e.featuredSong.previewUrl
      ) ?? false);

    if ((needsEpisodeDataRefresh || needsSongEnrichment) && title.tmdbId) {
      let baseEpisodes: any[] = existingEpisodes;

      if (needsEpisodeDataRefresh) {
        const tmdbSeason = await tmdbService.fetchSeasonDetails(title.tmdbId, seasonNumber);
        if (tmdbSeason && tmdbSeason.episodes.length > 0) {
          baseEpisodes = tmdbSeason.episodes.map((tmdbEp: any) => {
            const existing = existingEpisodes.find((e: any) => e.episodeNumber === tmdbEp.episodeNumber);
            // Generated filler must NOT outrank the genuine TMDB overview.
            const hasExistingSummary =
              !!existing && !isGeneratedSummary(existing.summary) && existing.summary.trim().length > 10;
            const hasTmdbSummary = !!tmdbEp.summary && tmdbEp.summary.trim().length > 10;
            return {
              ...tmdbEp,
              summary: hasExistingSummary
                ? existing.summary
                : hasTmdbSummary
                  ? tmdbEp.summary
                  : existing?.summary && !isGeneratedSummary(existing.summary)
                    ? existing.summary
                    : '',
              name: existing?.name && !isPlaceholderEpisodeName(existing.name) ? existing.name : tmdbEp.name,
              featuredSong: existing?.featuredSong,
            };
          });
        }
      }

      if (baseEpisodes.length > 0) {
        // Prefer the tracks already persisted for this title. Falling straight
        // back to discovery here meant every season click re-ran the full
        // Wikipedia + ~20 query iTunes pipeline.
        let songs = await Soundtrack.find({ title: title._id }).sort({ popularityRank: 1 }).lean();
        if (songs.length === 0) {
          try {
            songs = (await SoundtrackService.getSoundtracksForTitle(
              title.name,
              (title as any).originalName,
              title.type as any,
              title.releaseYear
            )) as any;
          } catch (err: any) {
            console.warn('[getSeasonEpisodes] Soundtrack discovery failed:', err.message);
          }
        }

        const totalEps = baseEpisodes.length;
        const enriched = baseEpisodes.map((ep: any) => {
          const matched = SoundtrackService.matchSongForEpisode(
            songs as any,
            seasonNumber,
            ep.episodeNumber,
            totalEps,
            ep.name
          );
          return {
            ...ep,
            // Preserve an existing song when nothing new matches.
            featuredSong: matched
              ? {
                  songName: matched.songName,
                  artist: matched.artist,
                  sceneRef: matched.episodeRef,
                  previewUrl: matched.previewUrl,
                  albumArtUrl: matched.albumArtUrl,
                  spotifyUrl: matched.spotifyUrl,
                }
              : ep.featuredSong,
          };
        });

        seasonDoc = await SeasonEpisode.findOneAndUpdate(
          { title: title._id, seasonNumber },
          {
            $set: {
              title: title._id,
              seasonNumber,
              episodes: enriched,
              // Stamp only when a TMDB episode sync was actually attempted, so a
              // song-only refresh cannot reset the backoff clock.
              ...(needsEpisodeDataRefresh ? { sourceUpdatedAt: new Date() } : {}),
            },
          },
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
export const getComments = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const titleId = String(req.params.titleId);
    const allComments = await Comment.find({ title: titleId, hidden: false })
      .populate('user', 'name email role')
      .sort({ createdAt: 1 })
      .lean();

    const commentsWithReplies = groupCommentsForDisplay(allComments, req.user?.id);

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
 * Report a comment for curator moderation.
 *
 * Previously the Comment model's `reported` / `hidden` flags had no writer at
 * all, so nothing could ever be flagged and the moderation queue had no input.
 */
export const reportComment = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const commentId = String(req.params.commentId);
    const userId = req.user?.id;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 280) : '';

    if (!mongoose.Types.ObjectId.isValid(commentId)) {
      res.status(400).json({ success: false, error: 'Invalid comment id' });
      return;
    }

    const comment = await Comment.findById(commentId);
    if (!comment || comment.hidden) {
      res.status(404).json({ success: false, error: 'Comment not found' });
      return;
    }

    if (comment.user.toString() === userId) {
      res.status(400).json({ success: false, error: 'You cannot report your own comment' });
      return;
    }

    if ((comment.reports || []).some((r: any) => r.user.toString() === userId)) {
      res.status(409).json({ success: false, error: 'You have already reported this comment' });
      return;
    }

    comment.reports = [
      ...(comment.reports || []),
      { user: new mongoose.Types.ObjectId(userId), reason, createdAt: new Date() } as any,
    ];
    comment.reportCount = comment.reports.length;
    // `reported` is the indexed flag the curator queue queries on.
    comment.reported = true;
    comment.reportedAt = new Date();
    await comment.save();

    sendSuccess(res, { commentId, reportCount: comment.reportCount }, 'Comment reported for review');
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
 * Search iTunes Apple Music tracks for soundtrack contributor modal.
 *
 * `titleName` is optional context so results can be ranked toward the film/show
 * the contributor is actually looking at. Upstream failures are reported as a
 * 503 instead of being converted into an empty list, so the client can render a
 * real error instead of an empty panel.
 */
export const searchMusic = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const q = String(req.query.q || '');
    const titleName = req.query.titleName ? String(req.query.titleName) : undefined;

    if (!q.trim()) {
      sendSuccess(res, { tracks: [] }, 'No query provided');
      return;
    }

    const tracks = await SoundtrackService.searchItunes(q, titleName);
    sendSuccess(res, { tracks }, 'Music search results retrieved');
  } catch (error: any) {
    console.warn('[searchMusic] Apple Music lookup failed:', error?.message);
    res.status(503).json({
      success: false,
      error: 'Music search is temporarily unavailable. Please try again.',
    });
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
      // Flagged as user-owned so automatic soundtrack refreshes never delete it.
      source: 'user',
    });

    sendSuccess(res, { soundtrack: created }, 'Song added to soundtrack successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Format relative time string
 */
function formatRelativeTime(date: Date): string {
  const diffSec = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

/**
 * Get real social feed activity (community reviews, ratings, and discussions)
 * GET /api/titles/feed
 */
export const getFeedActivity = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page = '1', limit = '10' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(30, Math.max(1, parseInt(limit as string, 10) || 10));

    // Feed filter. 'following' restricts the feed to people the viewer actually
    // follows - previously the "Following Activity" tab rendered the identical
    // global feed because no such filter existed.
    const feedFilter = req.query.filter === 'following' ? 'following' : 'all';

    const query: any = { parentId: null, hidden: false };

    let followingIds: string[] = [];
    if (feedFilter === 'following') {
      followingIds = await FollowService.getFollowingIds(req.user?.id || '');
      if (followingIds.length === 0) {
        // Nothing followed yet - return an empty feed rather than everything.
        sendSuccess(
          res,
          { posts: [], filter: feedFilter, followingCount: 0 },
          'Follow some members to see their activity here'
        );
        return;
      }
      query.user = { $in: followingIds };
    }

    const comments = await Comment.find(query)
      .populate('user', 'name avatar handle email')
      .populate('title', 'name posterUrl releaseYear type genres runtimeMinutes voteAverage')
      .sort({ createdAt: -1 })
      .skip((pageNum - 1) * limitNum)
      .limit(limitNum)
      .lean();

    // Real streaming availability per post. Previously every post in the feed
    // claimed ['Max','Prime Video','Netflix'] regardless of the title.
    const feedTitleIds = Array.from(
      new Set(comments.map((c: any) => c.title?._id?.toString()).filter(Boolean))
    );
    const feedProviders = feedTitleIds.length
      ? await WatchProvider.find({ title: { $in: feedTitleIds } }).lean()
      : [];
    const providersByTitle = new Map<string, string[]>();
    for (const p of feedProviders) {
      const key = p.title.toString();
      if (!providersByTitle.has(key)) providersByTitle.set(key, []);
      const list = providersByTitle.get(key)!;
      if (!list.includes(p.service)) list.push(p.service);
    }

    // Real reply counts (previously always 0).
    const feedCommentIds = comments.map((c: any) => c._id);
    const replyRows = feedCommentIds.length
      ? await Comment.aggregate([
          { $match: { parentId: { $in: feedCommentIds } } },
          { $group: { _id: '$parentId', count: { $sum: 1 } } },
        ])
      : [];
    const repliesByParent = new Map<string, number>(
      replyRows.map((r: any) => [r._id.toString(), r.count])
    );

    // Which authors are genuine two-way connections with the viewer.
    const myMutualIds = new Set<string>(
      req.user
        ? (await FollowService.getGraph(req.user.id)).mutuals.map((m: any) => m.id)
        : []
    );

    // Filter FIRST, then map. Filtering and mapping in the same chain while
    // writing back by index elsewhere would desynchronise the indices as soon
    // as a single comment references a deleted title.
    const visibleComments = comments.filter(
      (c: any) => c.title != null && c.user != null
    );

    const posts = visibleComments
      .map((c: any) => {
        const authorName = c.user.name || 'Cinephile';
        const rawHandle = c.user.email ? `@${c.user.email.split('@')[0]}` : `@${authorName.toLowerCase().replace(/\s+/g, '')}`;

        return {
          id: c._id.toString(),
          author: {
            name: authorName,
            handle: rawHandle,
            avatar: c.user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(authorName)}&background=6366f1&color=fff`,
            mutualCount: 0,
            // Whether the author and the viewer have a two-way follow edge.
            isConnection: myMutualIds.has(c.user._id.toString()),
          },
          titleData: {
            id: c.title._id.toString(),
            name: c.title.name,
            year: c.title.releaseYear || null,
            poster: c.title.posterUrl || '',
            genres: Array.isArray(c.title.genres) ? c.title.genres : [],
            runtime: c.title.runtimeMinutes ? `${c.title.runtimeMinutes} min` : null,
            // Actual providers, or an empty list when we have no data.
            streamingServices: providersByTitle.get(c.title._id.toString()) || [],
          },
          // null when the reviewer did not rate - the UI must not invent 5 stars.
          rating: typeof c.rating === 'number' ? c.rating : null,
          reviewText: c.text,
          timestamp: formatRelativeTime(c.createdAt),
          likesCount: c.likesCount || 0,
          commentsCount: repliesByParent.get(c._id.toString()) || 0,
          poll: c.poll?.question
            ? {
                question: c.poll.question,
                options: (c.poll.options || []).map((opt: any) => ({
                  text: opt.optionText,
                  votesCount: opt.votes?.length || 0,
                })),
              }
            : undefined,
        };
      });

    if (req.user && posts.length > 0) {
      const currentUserWatchedTitleIds = await Watchlist.find({
        user: req.user.id,
        watched: true,
      }).distinct('title');

      if (currentUserWatchedTitleIds.length > 0) {
        const authorIds = comments
          .filter((comment: any) => comment.title != null && comment.user != null)
          .map((comment: any) => comment.user._id);
        const mutualWatched = await Watchlist.aggregate([
          {
            $match: {
              user: { $in: authorIds },
              watched: true,
              title: { $in: currentUserWatchedTitleIds },
            },
          },
          { $group: { _id: { user: '$user', title: '$title' } } },
          { $group: { _id: '$_id.user', count: { $sum: 1 } } },
        ]);
        const mutualCounts = new Map(mutualWatched.map((entry) => [entry._id.toString(), entry.count]));

        comments
          .filter((comment: any) => comment.title != null && comment.user != null)
          .forEach((comment: any, index: number) => {
            posts[index].author.mutualCount = mutualCounts.get(comment.user._id.toString()) || 0;
          });
      }
    }

    sendSuccess(res, { posts, filter: feedFilter, followingCount: followingIds.length }, 'Feed activity retrieved successfully');
  } catch (error) {
    next(error);
  }
};
