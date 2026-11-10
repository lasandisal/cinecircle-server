import { Request, Response, NextFunction } from 'express';
import prisma from '../config/prisma';
import { tmdbService } from '../services/TmdbService';
import { SeedService } from '../services/SeedService';
import { SoundtrackService } from '../services/SoundtrackService';
import { ConnectionGraphService } from '../services/connection-graph.service';
import { sendSuccess } from '../utils/response';
import type { IAuthRequest } from '../types';

const SOUNDTRACK_REFRESH_TTL_MS = 24 * 60 * 60 * 1000;
const SEASON_REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SEASON_REFRESH_RETRY_MS = 30 * 60 * 1000;
const WATCH_PROVIDER_REFRESH_TTL_MS = 24 * 60 * 60 * 1000;

function isFresh(dateValue: any, ttlMs: number): boolean {
  if (!dateValue) return false;
  const time = new Date(dateValue).getTime();
  return Number.isFinite(time) && Date.now() - time < ttlMs;
}

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

function groupCommentsForDisplay(comments: any[], viewerId?: string): any[] {
  const parents: any[] = [];
  const replies = new Map<string, any[]>();

  const sanitise = (c: any) => {
    const reports: any[] = Array.isArray(c.reports) ? c.reports : [];
    const { reports: _r, hidden: _h, hiddenBy: _hb, hiddenAt: _ha, reported: _rep, reportedAt: _ra, ...rest } = c;
    return {
      ...rest,
      _id: c.id,
      user: c.user ? { ...c.user, _id: c.user.id } : null,
      reportCount: c.reportCount || reports.length,
      reportedByMe: viewerId ? reports.some((r: any) => (r.user?.id || r.userId || r.user)?.toString() === viewerId) : false,
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
    .map((p) => ({ ...p, replies: replies.get(p.id) || [] }))
    .reverse();
}

function isPlaceholderEpisodeName(name?: string): boolean {
  return !name || /^episode\s*\d*$/i.test(name.trim());
}

function hasEpisodeGaps(episodes: any[]): boolean {
  if (!Array.isArray(episodes) || episodes.length === 0) return true;
  const numbers = episodes
    .map((e: any) => Number(e?.episodeNumber))
    .filter((n: number) => Number.isFinite(n))
    .sort((a: number, b: number) => a - b);
  if (numbers.length === 0) return true;
  return numbers.some((n: number, index: number) => n !== index + 1);
}

function formatTitle(t: any) {
  if (!t) return null;
  return {
    ...t,
    _id: t.id,
  };
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

    const where: any = {};

    if (type && (type === 'film' || type === 'tv')) {
      where.type = type;
    }

    if (genre && typeof genre === 'string') {
      where.genres = { has: genre.trim() };
    }

    if (mood && typeof mood === 'string') {
      where.moodTags = { has: mood.trim() };
    }

    if (search && typeof search === 'string') {
      const safeSearch = search.trim();
      where.OR = [
        { name: { contains: safeSearch, mode: 'insensitive' } },
        { synopsis: { contains: safeSearch, mode: 'insensitive' } },
      ];
    }

    if (service && typeof service === 'string') {
      const providers = await prisma.watchProvider.findMany({
        where: {
          service: { contains: service.trim(), mode: 'insensitive' },
        },
        select: { titleId: true },
      });
      const titleIds = providers.map((p) => p.titleId);
      where.id = { in: titleIds };
    }

    const [titles, total] = await Promise.all([
      prisma.title.findMany({
        where,
        orderBy: [{ voteAverage: 'desc' }, { releaseYear: 'desc' }],
        skip,
        take: limitNum,
      }),
      prisma.title.count({ where }),
    ]);

    const titleIds = titles.map((t) => t.id);
    const allProviders = await prisma.watchProvider.findMany({
      where: { titleId: { in: titleIds } },
    });

    const providerMap = new Map<string, any[]>();
    for (const p of allProviders) {
      const key = p.titleId;
      if (!providerMap.has(key)) providerMap.set(key, []);
      providerMap.get(key)!.push({ ...p, _id: p.id });
    }

    const titlesWithProviders = titles.map((t) => ({
      ...formatTitle(t),
      watchProviders: providerMap.get(t.id) || [],
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
  } catch (error: any) {
    next(error);
  }
};

/**
 * Get trending titles.
 *
 * Prefers live TMDB "trending this week" results so the section reflects what
 * is actually popular right now. Falls back to the catalogue's top-rated
 * titles when TMDB is not configured or unreachable, and the response says
 * which source was used so the UI can label it honestly.
 */
const TRENDING_CACHE_TTL_MS = 10 * 60 * 1000;
const trendingCache = new Map<
  string,
  { at: number; titles: any[]; source: 'tmdb' | 'catalogue' }
>();

export const getTrendingTitles = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { mediaType = 'all' } = req.query;
    const cacheKey = String(mediaType);

    const cached = trendingCache.get(cacheKey);
    if (cached && Date.now() - cached.at < TRENDING_CACHE_TTL_MS) {
      sendSuccess(res, { titles: cached.titles, source: cached.source }, 'Trending titles retrieved');
      return;
    }

    let titles: any[] = [];
    let source: 'tmdb' | 'catalogue' = 'catalogue';

    // 1. Live TMDB trending (real data, refreshed weekly by TMDB).
    if (tmdbService.hasApiKey()) {
      try {
        const live = await tmdbService.fetchLiveTrending(mediaType as any);
        if (live.length > 0) {
          const tmdbIds = live.map((t) => t.tmdbId);
          const localRows = await prisma.title.findMany({
            where: { tmdbId: { in: tmdbIds } },
            select: { id: true, tmdbId: true },
          });
          const localByTmdbId = new Map(localRows.map((r) => [r.tmdbId, r.id]));

          titles = live.slice(0, 12).map((t) => ({
            ...t,
            // Reuse the local catalogue row when one exists so links and
            // community stats resolve without an extra TMDB round-trip.
            _id: localByTmdbId.get(t.tmdbId) || undefined,
            inCatalogue: localByTmdbId.has(t.tmdbId),
          }));
          source = 'tmdb';
        }
      } catch (err: any) {
        console.warn('[Trending] Live TMDB trending unavailable:', err.message);
      }
    }

    // 2. Fallback: top-rated titles already in the catalogue.
    if (titles.length === 0) {
      const where: any = {};
      if (mediaType === 'movie') where.type = 'film';
      if (mediaType === 'tv') where.type = 'tv';

      const dbTitles = await prisma.title.findMany({
        where,
        orderBy: [{ voteAverage: 'desc' }, { releaseYear: 'desc' }],
        take: 12,
      });

      if (dbTitles.length > 0) {
        const titleIds = dbTitles.map((t) => t.id);
        const providers = await prisma.watchProvider.findMany({
          where: { titleId: { in: titleIds } },
        });
        const providerMap = new Map<string, any[]>();
        for (const p of providers) {
          const key = p.titleId;
          if (!providerMap.has(key)) providerMap.set(key, []);
          providerMap.get(key)!.push({ ...p, _id: p.id });
        }

        titles = dbTitles.map((t) => ({
          ...formatTitle(t),
          inCatalogue: true,
          watchProviders: providerMap.get(t.id) || [],
        }));
      }
    }

    trendingCache.set(cacheKey, { at: Date.now(), titles, source });
    sendSuccess(res, { titles, source }, 'Trending titles retrieved');
  } catch (error: any) {
    console.error('[Titles][trending] Failed to load trending titles:', error?.message || error);
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

    const term = q.trim();
    const where: any = {
      OR: [
        { name: { contains: term, mode: 'insensitive' } },
        { synopsis: { contains: term, mode: 'insensitive' } },
      ],
    };
    if (type && (type === 'film' || type === 'tv')) where.type = type;

    const titles = await prisma.title.findMany({
      where,
      take: 10,
    });

    const titleIds = titles.map((t) => t.id);
    const providers = await prisma.watchProvider.findMany({
      where: { titleId: { in: titleIds } },
    });
    const providerMap = new Map<string, any[]>();
    for (const p of providers) {
      const key = p.titleId;
      if (!providerMap.has(key)) providerMap.set(key, []);
      providerMap.get(key)!.push({ ...p, _id: p.id });
    }

    const localEnriched = titles.map((t) => ({
      ...formatTitle(t),
      watchProviders: providerMap.get(t.id) || [],
    }));

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
    const titles = await prisma.title.findMany({
      select: { genres: true },
    });
    const dbGenres = Array.from(new Set(titles.flatMap((t) => t.genres || [])));
    const canonicalGenres = tmdbService.getAllGenres();
    const combined = Array.from(new Set([...dbGenres, ...canonicalGenres])).sort();

    sendSuccess(res, { genres: combined }, 'Genres retrieved');
  } catch (error) {
    next(error);
  }
};

function isSoundtrackVerified(title: any, soundtracks: any[]): boolean {
  if (!soundtracks || soundtracks.length === 0) return false;

  const hasPreviews = soundtracks.some((s) => s.previewUrl);
  if (!hasPreviews) return false;

  if (soundtracks.length === 1 && soundtracks[0].songName?.includes('Official Main Theme & Score')) {
    return false;
  }

  const titleNameLower = (title.name || '').toLowerCase().trim();

  for (const s of soundtracks) {
    const songLower = (s.songName || '').toLowerCase();
    const artistLower = (s.artist || '').toLowerCase();
    const refLower = (s.episodeRef || s.sceneRef || '').toLowerCase();

    if (title.type === 'tv' && (refLower.includes('motion picture') || refLower.includes('movie soundtrack'))) {
      return false;
    }

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

    // Check if UUID or tmdbId
    if (!/^\d+$/.test(titleId)) {
      title = await prisma.title.findUnique({ where: { id: titleId } });
      if (title && requestedType && title.type !== requestedType) {
        title = null;
      }
    }

    if (!title) {
      const tmdbIdNum = parseInt(titleId, 10);
      if (!isNaN(tmdbIdNum)) {
        title = await prisma.title.findFirst({
          where: {
            tmdbId: tmdbIdNum,
            ...(requestedType ? { type: requestedType } : {}),
          },
        });
      }
    }

    if (!title) {
      const tmdbIdNum = parseInt(titleId, 10);
      if (!isNaN(tmdbIdNum)) {
        const tmdbData = await tmdbService.fetchDetails(tmdbIdNum, requestedType);
        if (tmdbData) {
          try {
            const created = await prisma.title.create({
              data: {
                tmdbId: tmdbData.tmdbId,
                name: tmdbData.name,
                originalName: tmdbData.originalName,
                type: tmdbData.type,
                genres: tmdbData.genres,
                synopsis: tmdbData.synopsis || '',
                runtimeMinutes: tmdbData.runtimeMinutes,
                posterUrl: tmdbData.posterUrl,
                backdropUrl: tmdbData.backdropUrl,
                releaseYear: tmdbData.releaseYear,
                voteAverage: tmdbData.voteAverage,
                moodTags: tmdbData.moodTags || [],
                cast: tmdbData.cast as any,
              },
            });

            if (tmdbData.watchProviders && tmdbData.watchProviders.length > 0) {
              const providerDocs = tmdbData.watchProviders.map((wp) => ({
                titleId: created.id,
                service: wp.service,
                region: wp.region,
                type: wp.type,
              }));
              await prisma.watchProvider.createMany({ data: providerDocs });
            }

            if (tmdbData.type === 'tv' && tmdbData.seasons && tmdbData.seasons.length > 0) {
              const seasonDocs = tmdbData.seasons.map((s) => ({
                titleId: created.id,
                seasonNumber: s.seasonNumber,
                episodes: Array.from({ length: Math.min(s.episodeCount || 10, 24) }, (_, idx) => ({
                  episodeNumber: idx + 1,
                  name: `Episode ${idx + 1}`,
                  summary: `${tmdbData.name} - Season ${s.seasonNumber}, Episode ${idx + 1}`,
                  runtimeMinutes: tmdbData.runtimeMinutes || 45,
                })),
              }));
              await prisma.seasonEpisode.createMany({ data: seasonDocs as any });
            }

            title = created;
          } catch (dbErr) {
            title = (await prisma.title.findFirst({ where: { tmdbId: tmdbIdNum } })) || tmdbData;
          }
        }
      }
    }

    if (!title) {
      res.status(404).json({ success: false, error: 'Title not found' });
      return;
    }

    const titleObjId = title.id;
    let [watchProviders, seasons, soundtracks, allComments, watcherDocs] = titleObjId
      ? await Promise.all([
          prisma.watchProvider.findMany({ where: { titleId: titleObjId } }),
          prisma.seasonEpisode.findMany({ where: { titleId: titleObjId }, orderBy: { seasonNumber: 'asc' } }),
          prisma.soundtrack.findMany({ where: { titleId: titleObjId }, orderBy: { popularityRank: 'asc' } }),
          prisma.comment.findMany({
            where: { titleId: titleObjId, hidden: false },
            include: { user: { select: { id: true, name: true, email: true, role: true, avatar: true } } },
            orderBy: { createdAt: 'asc' },
          }),
          prisma.watchlist.findMany({
            where: { titleId: titleObjId, watched: true },
            include: { user: { select: { id: true, name: true, handle: true, avatar: true, email: true } } },
            orderBy: [{ watchedAt: 'desc' }, { addedAt: 'desc' }],
            take: 10,
          }),
        ])
      : [[], [], [], [], []];

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
          await prisma.watchProvider.deleteMany({ where: { titleId: titleObjId } });
          const now = new Date();
          const newDocs = freshData.watchProviders.map((wp) => ({
            titleId: titleObjId,
            service: wp.service,
            region: wp.region,
            type: wp.type,
            sourceUpdatedAt: now,
          }));
          await prisma.watchProvider.createMany({ data: newDocs });
          watchProviders = await prisma.watchProvider.findMany({ where: { titleId: titleObjId } });
        }

        if (needsSeasons && freshData?.seasons && freshData.seasons.length > 0) {
          const seasonDocs = freshData.seasons.map((s) => ({
            titleId: titleObjId,
            seasonNumber: s.seasonNumber,
            episodes: [],
          }));
          await prisma.seasonEpisode.createMany({ data: seasonDocs as any });
          seasons = await prisma.seasonEpisode.findMany({ where: { titleId: titleObjId }, orderBy: { seasonNumber: 'asc' } });
        }
      } catch (err: any) {
        console.warn('[getTitleDetails] Error refreshing providers/seasons:', err.message);
      }
    }

    let finalSoundtracks = soundtracks;

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
            await prisma.soundtrack.deleteMany({ where: { titleId: titleObjId, source: 'auto' } });
            const now = new Date();
            const docs = dynamicTracks.map((dt) => ({
              titleId: titleObjId,
              songName: dt.songName,
              artist: dt.artist,
              episodeRef: dt.episodeRef,
              popularityRank: dt.popularityRank,
              previewUrl: dt.previewUrl,
              albumArtUrl: dt.albumArtUrl,
              spotifyUrl: dt.appleMusicUrl,
              source: 'auto',
              sourceUpdatedAt: now,
            }));
            await prisma.soundtrack.createMany({ data: docs });
            finalSoundtracks = await prisma.soundtrack.findMany({ where: { titleId: titleObjId }, orderBy: { popularityRank: 'asc' } });
          }
        }
      } catch (stErr: any) {
        console.warn('[getTitleDetails] Error discovering soundtracks:', stErr.message);
      }
    }

    // Auto-enrich Season 1 episodes with real TMDB data and matched songs
    if (title.type === 'tv' && title.tmdbId && seasons.length > 0) {
      const firstSeason = seasons[0];
      const existingEpisodes: any[] = Array.isArray(firstSeason.episodes) ? (firstSeason.episodes as any[]) : [];

      const seasonLooksIncomplete =
        existingEpisodes.length === 0 ||
        hasEpisodeGaps(existingEpisodes) ||
        existingEpisodes.some(
          (e: any) => isPlaceholderEpisodeName(e.name) || isGeneratedSummary(e.summary)
        );

      const seasonTtl = seasonLooksIncomplete ? SEASON_REFRESH_RETRY_MS : SEASON_REFRESH_TTL_MS;
      const seasonIsStale = !isFresh(firstSeason.sourceUpdatedAt, seasonTtl);
      const needsEpisodeDataRefresh = seasonLooksIncomplete && seasonIsStale;

      const firstSeasonSongs = existingEpisodes.map((e: any) => e.featuredSong).filter(Boolean);
      const isSeasonSongsVerified = isSoundtrackVerified(title, firstSeasonSongs);

      const needsSongRefresh =
        !isVerified ||
        !isSeasonSongsVerified ||
        existingEpisodes.some(
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
                featuredSong: matched
                  ? {
                      songName: matched.songName,
                      artist: matched.artist,
                      sceneRef: matched.episodeRef,
                      previewUrl: matched.previewUrl,
                      albumArtUrl: matched.albumArtUrl,
                      spotifyUrl: matched.appleMusicUrl,
                    }
                  : ep.featuredSong,
              };
            });

            await prisma.seasonEpisode.update({
              where: { id: firstSeason.id },
              data: {
                episodes: enriched,
                ...(needsEpisodeDataRefresh ? { sourceUpdatedAt: new Date() } : {}),
              },
            });
            firstSeason.episodes = enriched as any;
          }
        } catch (err: any) {
          console.warn('[getTitleDetails] Error refreshing season 1 episodes & songs:', err.message);
        }
      }
    }

    const commentsWithReplies = groupCommentsForDisplay(
      allComments,
      (req as IAuthRequest).user?.id
    );

    const communityWatchers = (watcherDocs || [])
      .filter((w: any) => w.user != null)
      .map((w: any) => ({
        userId: w.user.id,
        _id: w.user.id,
        name: w.user.name,
        handle: w.user.handle,
        avatar: w.user.avatar,
        starRating: w.starRating,
        watchedAt: w.watchedAt || w.addedAt,
      }));

    const fullDetail = {
      ...formatTitle(title),
      watchProviders: watchProviders.map((wp) => ({ ...wp, _id: wp.id })),
      seasons: seasons.map((s) => ({ ...s, _id: s.id })),
      soundtracks: finalSoundtracks.map((st: any) => ({ ...st, _id: st.id })),
      comments: commentsWithReplies,
      communityWatchers,
    };

    sendSuccess(res, { title: fullDetail }, 'Title details retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Fetch detailed episodes for a specific season
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
    if (!/^\d+$/.test(titleId)) {
      title = await prisma.title.findUnique({ where: { id: titleId } });
    } else {
      const tmdbIdNum = parseInt(titleId, 10);
      if (!isNaN(tmdbIdNum)) {
        title = await prisma.title.findFirst({ where: { tmdbId: tmdbIdNum } });
      }
    }

    if (!title) {
      res.status(404).json({ success: false, error: 'Title not found' });
      return;
    }

    let seasonDoc = await prisma.seasonEpisode.findFirst({
      where: { titleId: title.id, seasonNumber },
    });

    const existingEpisodes: any[] = Array.isArray(seasonDoc?.episodes) ? (seasonDoc.episodes as any[]) : [];

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
        let songs = await prisma.soundtrack.findMany({
          where: { titleId: title.id },
          orderBy: { popularityRank: 'asc' },
        });
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
            featuredSong: matched
              ? {
                  songName: matched.songName,
                  artist: matched.artist,
                  sceneRef: matched.episodeRef,
                  previewUrl: matched.previewUrl,
                  albumArtUrl: matched.albumArtUrl,
                  spotifyUrl: matched.appleMusicUrl,
                }
              : ep.featuredSong,
          };
        });

        seasonDoc = await prisma.seasonEpisode.upsert({
          where: {
            titleId_seasonNumber: { titleId: title.id, seasonNumber },
          },
          create: {
            titleId: title.id,
            seasonNumber,
            episodes: enriched,
            sourceUpdatedAt: needsEpisodeDataRefresh ? new Date() : undefined,
          },
          update: {
            episodes: enriched,
            ...(needsEpisodeDataRefresh ? { sourceUpdatedAt: new Date() } : {}),
          },
        });
      }
    }

    sendSuccess(res, { season: seasonDoc ? { ...seasonDoc, _id: seasonDoc.id } : null }, 'Season episodes retrieved');
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
 * Add a discussion comment on a title
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

    const title = await prisma.title.findUnique({ where: { id: titleId } });
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

    const comment = await prisma.comment.create({
      data: {
        titleId: title.id,
        userId: req.user!.id,
        text: text.trim(),
        rating,
        likesCount: 0,
        parentId: parentId || null,
        poll: pollData,
        reactions: [],
        containsSpoilers: !!containsSpoilers,
      },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, avatar: true } },
      },
    });

    sendSuccess(res, { comment: { ...comment, _id: comment.id, user: comment.user ? { ...comment.user, _id: comment.user.id } : null } }, 'Comment added successfully', 201);
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
    const allComments = await prisma.comment.findMany({
      where: { titleId, hidden: false },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, avatar: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

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
    const comment = await prisma.comment.update({
      where: { id: commentId },
      data: { likesCount: { increment: 1 } },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, avatar: true } },
      },
    });

    sendSuccess(res, { comment: { ...comment, _id: comment.id, user: comment.user ? { ...comment.user, _id: comment.user.id } : null } }, 'Comment liked');
  } catch (error) {
    next(error);
  }
};

/**
 * Report a comment
 */
export const reportComment = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const commentId = String(req.params.commentId);
    const userId = req.user?.id;
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 280) : '';

    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment || comment.hidden) {
      res.status(404).json({ success: false, error: 'Comment not found' });
      return;
    }

    if (comment.userId === userId) {
      res.status(400).json({ success: false, error: 'You cannot report your own comment' });
      return;
    }

    const existingReports: any[] = Array.isArray(comment.reports) ? (comment.reports as any[]) : [];
    if (existingReports.some((r: any) => r.userId === userId)) {
      res.status(409).json({ success: false, error: 'You have already reported this comment' });
      return;
    }

    const newReports = [...existingReports, { userId, reason, createdAt: new Date() }];

    const updated = await prisma.comment.update({
      where: { id: commentId },
      data: {
        reports: newReports,
        reportCount: newReports.length,
        reported: true,
        reportedAt: new Date(),
      },
    });

    sendSuccess(res, { commentId, reportCount: updated.reportCount }, 'Comment reported for review');
  } catch (error) {
    next(error);
  }
};

/**
 * React to a comment with emojis
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

    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) {
      res.status(404).json({ success: false, error: 'Comment not found' });
      return;
    }

    const reactions: any[] = Array.isArray(comment.reactions) ? (comment.reactions as any[]) : [];
    const existingIndex = reactions.findIndex((r) => r.userId === userId && r.emoji === emoji);

    let updatedReactions: any[];
    if (existingIndex > -1) {
      updatedReactions = reactions.filter((_, idx) => idx !== existingIndex);
    } else {
      updatedReactions = reactions.filter((r) => r.userId !== userId);
      updatedReactions.push({ userId, emoji });
    }

    const updated = await prisma.comment.update({
      where: { id: commentId },
      data: { reactions: updatedReactions },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, avatar: true } },
      },
    });

    sendSuccess(res, { comment: { ...updated, _id: updated.id, user: updated.user ? { ...updated.user, _id: updated.user.id } : null } }, 'Reaction updated');
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

    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    const poll = comment?.poll as any;
    if (!comment || !poll || !poll.options || !poll.options[optionIndex]) {
      res.status(404).json({ success: false, error: 'Poll or option not found' });
      return;
    }

    const options: any[] = poll.options.map((opt: any) => ({
      ...opt,
      votes: (opt.votes || []).filter((v: string) => v !== userId),
    }));

    options[optionIndex].votes.push(userId);

    const updated = await prisma.comment.update({
      where: { id: commentId },
      data: {
        poll: {
          ...poll,
          options,
        },
      },
      include: {
        user: { select: { id: true, name: true, email: true, role: true, avatar: true } },
      },
    });

    sendSuccess(res, { comment: { ...updated, _id: updated.id, user: updated.user ? { ...updated.user, _id: updated.user.id } : null } }, 'Poll vote recorded');
  } catch (error) {
    next(error);
  }
};

/**
 * Soft delete a comment (comment author only, or admin).
 * Sets hidden=true instead of hard-deleting so moderation history is preserved.
 */
export const deleteComment = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const commentId = String(req.params.commentId);
    const userId = req.user?.id;
    const userRole = req.user?.role;

    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) {
      res.status(404).json({ success: false, error: 'Comment not found' });
      return;
    }

    if (comment.userId !== userId && userRole !== 'admin') {
      res.status(403).json({ success: false, error: 'You can only delete your own comments' });
      return;
    }

    await prisma.comment.update({
      where: { id: commentId },
      data: {
        hidden: true,
        hiddenBy: userId,
        hiddenAt: new Date(),
      },
    });

    sendSuccess(res, { commentId }, 'Comment deleted');
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
 * Add an iconic track to a title's soundtrack catalog
 */
export const addTitleSoundtrack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const titleId = String(req.params.titleId);
    const { songName, artist, episodeRef, previewUrl, albumArtUrl, appleMusicUrl, spotifyUrl } = req.body;

    if (!songName || !artist) {
      res.status(400).json({ success: false, error: 'Song name and artist are required' });
      return;
    }

    let title: any = null;
    if (!/^\d+$/.test(titleId)) {
      title = await prisma.title.findUnique({ where: { id: titleId } });
    } else {
      const tmdbIdNum = parseInt(titleId, 10);
      if (!isNaN(tmdbIdNum)) {
        title = await prisma.title.findFirst({ where: { tmdbId: tmdbIdNum } });
      }
    }

    if (!title) {
      res.status(404).json({ success: false, error: 'Title not found' });
      return;
    }

    let finalPreview = previewUrl;
    let finalArt = albumArtUrl;
    let finalLink = spotifyUrl || appleMusicUrl;

    if (!finalPreview || !finalArt) {
      const enriched = await SoundtrackService.enrichTrackWithAudio(songName, artist);
      finalPreview = finalPreview || enriched.previewUrl;
      finalArt = finalArt || enriched.albumArtUrl;
      finalLink = finalLink || enriched.appleMusicUrl;
    }

    const existingCount = await prisma.soundtrack.count({ where: { titleId: title.id } });

    const created = await prisma.soundtrack.create({
      data: {
        titleId: title.id,
        songName: songName.trim(),
        artist: artist.trim(),
        episodeRef: episodeRef?.trim() || undefined,
        popularityRank: existingCount + 1,
        previewUrl: finalPreview,
        albumArtUrl: finalArt,
        spotifyUrl: finalLink,
        source: 'user',
      },
    });

    sendSuccess(res, { soundtrack: { ...created, _id: created.id } }, 'Song added to soundtrack successfully');
  } catch (error) {
    next(error);
  }
};

function formatRelativeTime(date: Date): string {
  const diffSec = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

/**
 * Get real social feed activity
 * GET /api/titles/feed
 */
export const getFeedActivity = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page = '1', limit = '10' } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(30, Math.max(1, parseInt(limit as string, 10) || 10));

    const feedFilter = req.query.filter === 'connections' ? 'connections' : 'all';

    const where: any = { parentId: null, hidden: false };

    let connectionIds: string[] = [];
    if (feedFilter === 'connections') {
      connectionIds = await ConnectionGraphService.getConnectionIds(req.user?.id || '');
      if (connectionIds.length === 0) {
        sendSuccess(
          res,
          { posts: [], filter: feedFilter, connectionsCount: 0 },
          'Connect with members to see their activity here'
        );
        return;
      }
      where.userId = { in: connectionIds };
    }

    const comments = await prisma.comment.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, avatar: true, handle: true, email: true } },
        title: { select: { id: true, name: true, posterUrl: true, releaseYear: true, type: true, genres: true, runtimeMinutes: true, voteAverage: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: (pageNum - 1) * limitNum,
      take: limitNum,
    });

    const feedTitleIds = Array.from(
      new Set(comments.map((c) => c.titleId).filter(Boolean))
    );
    const feedProviders = feedTitleIds.length
      ? await prisma.watchProvider.findMany({ where: { titleId: { in: feedTitleIds } } })
      : [];
    const providersByTitle = new Map<string, string[]>();
    for (const p of feedProviders) {
      const key = p.titleId;
      if (!providersByTitle.has(key)) providersByTitle.set(key, []);
      const list = providersByTitle.get(key)!;
      if (!list.includes(p.service)) list.push(p.service);
    }

    const feedCommentIds = comments.map((c) => c.id);
    const replyRows = feedCommentIds.length
      ? await prisma.comment.groupBy({
          by: ['parentId'],
          where: { parentId: { in: feedCommentIds } },
          _count: { id: true },
        })
      : [];
    const repliesByParent = new Map<string, number>(
      replyRows.map((r) => [r.parentId || '', r._count.id])
    );

    const myConnectionIds = new Set<string>(
      req.user
        ? await ConnectionGraphService.getConnectionIds(req.user.id)
        : []
    );

    const visibleComments = comments.filter((c) => c.title != null && c.user != null);

    const posts = visibleComments.map((c) => {
      const authorName = c.user?.name || 'Cinephile';
      const rawHandle = c.user?.email ? `@${c.user.email.split('@')[0]}` : `@${authorName.toLowerCase().replace(/\s+/g, '')}`;

      const poll = c.poll as any;

      return {
        id: c.id,
        _id: c.id,
        author: {
          name: authorName,
          handle: rawHandle,
          avatar: c.user?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(authorName)}&background=6366f1&color=fff`,
          mutualCount: 0,
          isConnection: myConnectionIds.has(c.userId),
        },
        titleData: {
          id: c.title.id,
          _id: c.title.id,
          name: c.title.name,
          year: c.title.releaseYear || null,
          poster: c.title.posterUrl || '',
          genres: c.title.genres || [],
          runtime: c.title.runtimeMinutes ? `${c.title.runtimeMinutes} min` : null,
          streamingServices: providersByTitle.get(c.title.id) || [],
        },
        rating: typeof c.rating === 'number' ? c.rating : null,
        reviewText: c.text,
        timestamp: formatRelativeTime(c.createdAt),
        likesCount: c.likesCount || 0,
        commentsCount: repliesByParent.get(c.id) || 0,
        poll: poll?.question
          ? {
              question: poll.question,
              options: (poll.options || []).map((opt: any) => ({
                text: opt.optionText,
                votesCount: opt.votes?.length || 0,
              })),
            }
          : undefined,
      };
    });

    if (req.user && posts.length > 0) {
      const currentUserWatchedItems = await prisma.watchlist.findMany({
        where: { userId: req.user.id, watched: true },
        select: { titleId: true },
      });
      const currentUserWatchedTitleIds = currentUserWatchedItems.map((w) => w.titleId);

      if (currentUserWatchedTitleIds.length > 0) {
        const authorIds = visibleComments.map((comment) => comment.userId);
        const mutualWatched = await prisma.watchlist.groupBy({
          by: ['userId'],
          where: {
            userId: { in: authorIds },
            watched: true,
            titleId: { in: currentUserWatchedTitleIds },
          },
          _count: { titleId: true },
        });
        const mutualCounts = new Map(mutualWatched.map((m) => [m.userId, m._count.titleId]));

        posts.forEach((post, index) => {
          post.author.mutualCount = mutualCounts.get(visibleComments[index].userId) || 0;
        });
      }
    }

    sendSuccess(res, { posts, filter: feedFilter, connectionsCount: connectionIds.length }, 'Feed activity retrieved successfully');
  } catch (error) {
    next(error);
  }
};
