import { Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import { sendSuccess } from '../utils/response';
import { Title } from '../models/title.model';
import { Soundtrack } from '../models/soundtrack.model';
import { SeasonEpisode } from '../models/seasonEpisode.model';
import { SoundtrackService } from '../services/SoundtrackService';
import { AppError } from '../middleware/error.middleware';
import axios from 'axios';
import { ENV } from '../config/env';

/**
 * Add curated soundtrack moments (supports single track or batch tracks from Tasklet.ai agent)
 * Automatically enriches each song with legal 30s audio previews & artwork via Apple CDN,
 * saves to MongoDB, and updates relevant season episodes.
 */
export const addCuratedSoundtrack = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { titleName, tmdbId, mediaType, tracks, songName, artist, episodeRef, sceneDescription } = req.body;

    if (!titleName && !tmdbId) {
      return next(new AppError('titleName or tmdbId is required', 400));
    }

    // 1. Resolve or create Title in MongoDB
    let titleDoc = await Title.findOne(
      tmdbId
        ? { tmdbId: Number(tmdbId) }
        : { name: new RegExp(`^${titleName.trim()}$`, 'i') }
    );

    // If not in DB, search TMDB to auto-initialize
    if (!titleDoc && ENV.TMDB_API_KEY) {
      try {
        const searchType = mediaType === 'film' || mediaType === 'movie' ? 'movie' : 'tv';
        const tmdbRes = await axios.get(`https://api.themoviedb.org/3/search/${searchType}`, {
          params: { api_key: ENV.TMDB_API_KEY, query: titleName || tmdbId },
          timeout: 4000,
        });
        const hit = tmdbRes.data?.results?.[0];
        if (hit) {
          titleDoc = await Title.create({
            tmdbId: hit.id,
            name: hit.title || hit.name,
            originalName: hit.original_title || hit.original_name,
            type: searchType === 'movie' ? 'film' : 'tv',
            synopsis: hit.overview || '',
            posterUrl: hit.poster_path ? `https://image.tmdb.org/t/p/w500${hit.poster_path}` : '',
            backdropUrl: hit.backdrop_path ? `https://image.tmdb.org/t/p/original${hit.backdrop_path}` : '',
            releaseYear: hit.release_date ? parseInt(hit.release_date.split('-')[0], 10) : (hit.first_air_date ? parseInt(hit.first_air_date.split('-')[0], 10) : undefined),
            voteAverage: hit.vote_average || 0,
          });
        }
      } catch (err: any) {
        console.warn('[Curator] TMDB search error:', err.message);
      }
    }

    if (!titleDoc) {
      return next(new AppError(`Title "${titleName || tmdbId}" could not be found or initialized.`, 404));
    }

    // 2. Normalize input tracks (single track vs batch array)
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

      // Check if track already exists for this title
      const existing = await Soundtrack.findOne({
        title: titleDoc._id,
        songName: new RegExp(`^${cleanSong.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')}$`, 'i'),
      });

      if (existing) {
        if (cleanEpisodeRef && existing.episodeRef !== cleanEpisodeRef) {
          existing.episodeRef = cleanEpisodeRef;
          await existing.save();
        }
        savedTracks.push(existing);
        continue;
      }

      // Automatically enrich with legal 30s preview and high-res cover art from Apple CDN
      const audio = await SoundtrackService.enrichTrackWithAudio(cleanSong, cleanArtist);

      const created = await Soundtrack.create({
        title: titleDoc._id,
        songName: cleanSong,
        artist: cleanArtist,
        episodeRef: cleanEpisodeRef,
        popularityRank: item.popularityRank || i + 1,
        previewUrl: audio.previewUrl || item.previewUrl,
        albumArtUrl: audio.albumArtUrl || item.albumArtUrl,
        spotifyUrl: audio.appleMusicUrl || item.spotifyUrl,
      });

      savedTracks.push(created);
    }

    // 3. Auto-link to season episodes if matching
    try {
      const seasons = await SeasonEpisode.find({ title: titleDoc._id });
      for (const season of seasons) {
        let seasonUpdated = false;
        for (const ep of season.episodes) {
          if (!ep.featuredSong || !ep.featuredSong.previewUrl) {
            const matched = SoundtrackService.matchSongForEpisode(
              savedTracks,
              season.seasonNumber,
              ep.episodeNumber,
              season.episodes.length,
              ep.name
            );
            if (matched) {
              ep.featuredSong = {
                songName: matched.songName,
                artist: matched.artist,
                sceneRef: matched.episodeRef,
                previewUrl: matched.previewUrl,
                albumArtUrl: matched.albumArtUrl,
                spotifyUrl: matched.spotifyUrl,
              };
              seasonUpdated = true;
            }
          }
        }
        if (seasonUpdated) {
          await season.save();
        }
      }
    } catch (epErr: any) {
      console.warn('[Curator] Error auto-linking episodes:', epErr.message);
    }

    sendSuccess(
      res,
      {
        titleId: titleDoc._id,
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

export const moderateComment = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Admin/curator reviews flagged comment (hide/dismiss)
    sendSuccess(res, { comment: null }, 'Comment moderation updated');
  } catch (error) {
    next(error);
  }
};

export const getFlaggedComments = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Get reported comments for curation
    sendSuccess(res, { reportedComments: [] }, 'Flagged comments retrieved');
  } catch (error) {
    next(error);
  }
};
