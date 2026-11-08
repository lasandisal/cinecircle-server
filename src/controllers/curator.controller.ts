import { Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import { sendSuccess } from '../utils/response';
import prisma from '../config/prisma';
import { SoundtrackService } from '../services/SoundtrackService';
import { AppError } from '../middleware/error.middleware';
import axios from 'axios';
import { ENV } from '../config/env';

/**
 * Add curated soundtrack moments
 */
export const addCuratedSoundtrack = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { titleName, tmdbId, mediaType, tracks, songName, artist, episodeRef, sceneDescription } = req.body;

    if (!titleName && !tmdbId) {
      return next(new AppError('titleName or tmdbId is required', 400));
    }

    // 1. Resolve or create Title in PostgreSQL
    let titleDoc = await prisma.title.findFirst({
      where: tmdbId
        ? { tmdbId: Number(tmdbId) }
        : { name: { equals: titleName.trim(), mode: 'insensitive' } },
    });

    if (!titleDoc && ENV.TMDB_API_KEY) {
      try {
        const searchType = mediaType === 'film' || mediaType === 'movie' ? 'movie' : 'tv';
        const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/${searchType}`, {
          params: { api_key: ENV.TMDB_API_KEY, query: titleName || tmdbId },
          timeout: 4000,
        });
        const hit = tmdbRes.data?.results?.[0];
        if (hit) {
          titleDoc = await prisma.title.create({
            data: {
              tmdbId: hit.id,
              name: hit.title || hit.name,
              originalName: hit.original_title || hit.original_name,
              type: searchType === 'movie' ? 'movie' : 'tv',
              synopsis: hit.overview || '',
              posterUrl: hit.poster_path ? `https://image.tmdb.org/t/p/w500${hit.poster_path}` : '',
              backdropUrl: hit.backdrop_path ? `https://image.tmdb.org/t/p/original${hit.backdrop_path}` : '',
              releaseYear: hit.release_date
                ? parseInt(hit.release_date.split('-')[0], 10)
                : hit.first_air_date
                  ? parseInt(hit.first_air_date.split('-')[0], 10)
                  : null,
              voteAverage: hit.vote_average || 0,
            },
          });
        }
      } catch (err: any) {
        console.warn('[Curator] TMDB search error:', err.message);
      }
    }

    if (!titleDoc) {
      return next(new AppError(`Title "${titleName || tmdbId}" could not be found or initialized.`, 404));
    }

    const rawList = Array.isArray(tracks) && tracks.length > 0
      ? tracks
      : songName && artist
        ? [{ songName, artist, episodeRef, sceneDescription }]
        : [];

    if (rawList.length === 0) {
      return next(new AppError('No soundtrack items provided. Provide "tracks" array or "songName" + "artist".', 400));
    }

    const savedTracks: any[] = [];

    for (let i = 0; i < rawList.length; i++) {
      const item = rawList[i];
      if (!item.songName || !item.artist) continue;

      const cleanSong = item.songName.trim();
      const cleanArtist = item.artist.trim();
      const cleanEpisodeRef = item.episodeRef || (item.sceneDescription ? `Scene: ${item.sceneDescription}` : 'Curated Iconic Moment');

      const existing = await prisma.soundtrack.findFirst({
        where: {
          titleId: titleDoc.id,
          songName: { equals: cleanSong, mode: 'insensitive' },
        },
      });

      if (existing) {
        if (cleanEpisodeRef && existing.episodeRef !== cleanEpisodeRef) {
          const updated = await prisma.soundtrack.update({
            where: { id: existing.id },
            data: { episodeRef: cleanEpisodeRef },
          });
          savedTracks.push({ ...updated, _id: updated.id });
        } else {
          savedTracks.push({ ...existing, _id: existing.id });
        }
        continue;
      }

      const audio = await SoundtrackService.enrichTrackWithAudio(cleanSong, cleanArtist);

      const created = await prisma.soundtrack.create({
        data: {
          titleId: titleDoc.id,
          songName: cleanSong,
          artist: cleanArtist,
          episodeRef: cleanEpisodeRef,
          popularityRank: item.popularityRank || i + 1,
          previewUrl: audio.previewUrl || item.previewUrl,
          albumArtUrl: audio.albumArtUrl || item.albumArtUrl,
          spotifyUrl: audio.appleMusicUrl || item.appleMusicUrl,
        },
      });

      savedTracks.push({ ...created, _id: created.id });
    }

    // Auto-link to season episodes if matching
    try {
      const seasons = await prisma.seasonEpisode.findMany({ where: { titleId: titleDoc.id } });
      for (const season of seasons) {
        const episodes = Array.isArray(season.episodes) ? (season.episodes as any[]) : [];
        let seasonUpdated = false;

        for (const ep of episodes) {
          if (!ep.featuredSong || !ep.featuredSong.previewUrl) {
            const matched = SoundtrackService.matchSongForEpisode(
              savedTracks,
              season.seasonNumber,
              ep.episodeNumber,
              episodes.length,
              ep.name
            );
            if (matched) {
              ep.featuredSong = {
                songName: matched.songName,
                artist: matched.artist,
                sceneRef: matched.episodeRef,
                previewUrl: matched.previewUrl,
                albumArtUrl: matched.albumArtUrl,
                spotifyUrl: matched.appleMusicUrl,
              };
              seasonUpdated = true;
            }
          }
        }

        if (seasonUpdated) {
          await prisma.seasonEpisode.update({
            where: { id: season.id },
            data: { episodes },
          });
        }
      }
    } catch (epErr: any) {
      console.warn('[Curator] Error auto-linking episodes:', epErr.message);
    }

    sendSuccess(
      res,
      {
        titleId: titleDoc.id,
        _id: titleDoc.id,
        titleName: titleDoc.name,
        tmdbId: titleDoc.tmdbId,
        count: savedTracks.length,
        soundtracks: savedTracks,
      },
      `Successfully curated ${savedTracks.length} soundtrack moments for "${titleDoc.name}"`,
      201
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Batch update episode synopses, titles, or stills
 */
export const updateCuratedEpisodes = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { titleName, tmdbId, seasonNumber, episodes } = req.body;

    if (!titleName && !tmdbId) {
      return next(new AppError('titleName or tmdbId is required', 400));
    }

    const titleDoc = await prisma.title.findFirst({
      where: tmdbId
        ? { tmdbId: Number(tmdbId) }
        : { name: { equals: titleName.trim(), mode: 'insensitive' } },
    });

    if (!titleDoc) {
      return next(new AppError('Title not found in PostgreSQL', 404));
    }

    const sNum = Number(seasonNumber) || 1;
    const seasonDoc = await prisma.seasonEpisode.findFirst({
      where: { titleId: titleDoc.id, seasonNumber: sNum },
    });

    if (!seasonDoc) {
      return next(new AppError(`Season ${sNum} not found for title "${titleDoc.name}"`, 404));
    }

    if (!Array.isArray(episodes) || episodes.length === 0) {
      return next(new AppError('episodes array is required', 400));
    }

    const existingEpisodes: any[] = Array.isArray(seasonDoc.episodes) ? (seasonDoc.episodes as any[]) : [];
    let updatedCount = 0;

    for (const item of episodes) {
      const epNum = Number(item.episodeNumber);
      if (!epNum) continue;

      const ep = existingEpisodes.find((e) => e.episodeNumber === epNum);
      if (ep) {
        if (item.summary) ep.summary = item.summary.trim();
        if (item.name && (!ep.name || ep.name.match(/^Episode \d+$/i))) ep.name = item.name.trim();
        if (item.stillUrl) ep.stillUrl = item.stillUrl;
        updatedCount++;
      }
    }

    await prisma.seasonEpisode.update({
      where: { id: seasonDoc.id },
      data: { episodes: existingEpisodes },
    });

    sendSuccess(
      res,
      {
        titleName: titleDoc.name,
        seasonNumber: sNum,
        updatedCount,
      },
      `Successfully updated ${updatedCount} episode descriptions for "${titleDoc.name}" Season ${sNum}`,
      200
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Moderation queue: reported comments
 */
export const getFlaggedComments = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const status = req.query.status === 'resolved' ? 'resolved' : 'open';

    const where: any =
      status === 'open'
        ? { reported: true, hidden: false }
        : { OR: [{ hidden: true }, { reported: false, reportCount: { gt: 0 } }] };

    const comments = await prisma.comment.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true, handle: true } },
        title: { select: { id: true, name: true, posterUrl: true, releaseYear: true, type: true } },
      },
      orderBy: [{ reportCount: 'desc' }, { reportedAt: 'desc' }],
      take: 100,
    });

    const openCount = await prisma.comment.count({
      where: { reported: true, hidden: false },
    });

    sendSuccess(
      res,
      {
        reportedComments: comments.map((c) => ({
          ...c,
          _id: c.id,
          user: c.user ? { ...c.user, _id: c.user.id } : null,
          title: c.title ? { ...c.title, _id: c.title.id } : null,
        })),
        openCount,
      },
      'Flagged comments retrieved'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Apply moderation decision to a flagged comment
 */
export const moderateComment = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const commentId = String(req.params.commentId);
    const action = String(req.body?.action || '').toLowerCase();
    const moderatorId = req.user?.id;

    if (!commentId) {
      return next(new AppError('Invalid comment id', 400));
    }
    if (action !== 'hide' && action !== 'dismiss') {
      return next(new AppError("action must be either 'hide' or 'dismiss'", 400));
    }

    const comment = await prisma.comment.findUnique({ where: { id: commentId } });
    if (!comment) {
      return next(new AppError('Comment not found', 404));
    }

    const data: any = {};
    if (action === 'hide') {
      data.hidden = true;
      data.hiddenAt = new Date();
      data.hiddenBy = moderatorId;
    } else {
      data.reported = false;
      data.reports = [];
      data.reportCount = 0;
      data.reportedAt = null;
    }

    const updated = await prisma.comment.update({
      where: { id: commentId },
      data,
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true, handle: true } },
        title: { select: { id: true, name: true, posterUrl: true, releaseYear: true, type: true } },
      },
    });

    sendSuccess(
      res,
      {
        comment: {
          _id: updated.id,
          id: updated.id,
          text: updated.text,
          hidden: updated.hidden,
          reported: updated.reported,
          reportCount: updated.reportCount,
        },
        action,
      },
      action === 'hide' ? 'Comment hidden from the community' : 'Report dismissed'
    );
  } catch (error) {
    next(error);
  }
};