import { Request } from 'express';

export type UserRole = 'user' | 'admin' | 'curator';

export interface IUser {
  _id: string;
  id?: string;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  avatar?: string;
  handle?: string;
  bio?: string;
  tasteProfile?: string;
  subscribedServices: string[];
  fatigueCount: number;
  onboarded?: boolean;
  createdAt: Date;
}

export interface IAuthRequest extends Request {
  user?: {
    id: string;
    role: UserRole;
    email: string;
  };
}

export type ActionType = 'watched' | 'rated' | 'skipped' | 'picked';

export interface IWatchlist {
  _id: string;
  id?: string;
  user: string;
  title: string;
  watched: boolean;
  starRating?: number;
  addedAt: Date;
  watchedAt?: Date;
}

export interface IWatchHistory {
  _id: string;
  id?: string;
  user: string;
  title: string;
  action: ActionType;
  rating?: number;
  moodAtTime?: string;
  timestamp: Date;
}

export interface ITasteProfile {
  _id: string;
  id?: string;
  user: string;
  favoriteGenres: string[];
  favoriteTitles: string[];
  exclusions: string[];
  /** Recency-weighted per-genre affinities (see RecommendationService). */
  genreScores?: Record<string, number>;
  tasteComputedAt?: Date;
  updatedAt: Date;
}

export interface ITitle {
  _id: string;
  id?: string;
  tmdbId: number;
  name: string;
  originalName?: string;
  type: 'tv' | 'film' | 'movie';
  genres: string[];
  synopsis: string;
  runtimeMinutes: number;
  posterUrl: string;
  moodTags: string[];
  backdropUrl?: string;
  releaseYear?: number;
  voteAverage?: number;
  cast: {
    actorName: string;
    characterName: string;
    photoUrl?: string;
    bio?: string;
  }[];
}

export interface ISeasonEpisode {
  _id: string;
  id?: string;
  title: string;
  seasonNumber: number;
  episodes: {
    episodeNumber: number;
    name: string;
    summary: string;
    runtimeMinutes: number;
    stillUrl?: string;
    airDate?: string;
    voteAverage?: number;
    featuredSong?: {
      songName: string;
      artist: string;
      sceneRef?: string;
      previewUrl?: string;
      albumArtUrl?: string;
      spotifyUrl?: string;
    };
  }[];
  /** Last time this season's episode list / summaries were refreshed from TMDB. */
  sourceUpdatedAt?: Date;
}

export interface ISoundtrack {
  _id: string;
  id?: string;
  title: string;
  songName: string;
  artist: string;
  episodeRef?: string;
  popularityRank: number;
  previewUrl?: string;
  albumArtUrl?: string;
  spotifyUrl?: string;
  addedBy?: string;
  /**
   * Provenance of the track:
   * - 'curated' seeded from the curated catalogue
   * - 'auto'   discovered automatically by SoundtrackService (safe to replace)
   * - 'user'   contributed by a member through the UI (never auto-deleted)
   * Rows written before this field existed are treated as 'user' so they survive refreshes.
   */
  source?: 'curated' | 'auto' | 'user';
  /** Last time this track list was (re)discovered for its title. */
  sourceUpdatedAt?: Date;
}

export interface ISession {
  _id: string;
  id?: string;
  name?: string;
  host: string;
  joinCode: string;
  participants: string[];
  constraints: {
    maxRuntime?: number;
    moodFilter?: string;
  };
  shortlist: string[];
  status: 'open' | 'closed';
  finalPick?: string;
  createdAt: Date;
}

export interface IVote {
  _id: string;
  id?: string;
  session: string;
  user: string;
  title: string;
  reaction: 'yes' | 'no';
  strength: number;
}

export interface IWatchProvider {
  _id: string;
  id?: string;
  title: string;
  service: string;
  region: string;
  type: 'subscription' | 'rental' | 'purchase';
  sourceUpdatedAt: Date;
}

export type ReactionType = 'like' | 'love' | 'fire' | 'mindblown' | 'popcorn' | 'sad';

export interface IComment {
  _id: string;
  id?: string;
  title: string;
  user: string;
  text: string;
  rating?: number;
  likesCount?: number;
  parentId?: string;
  reactions?: {
    user: string;
    emoji: ReactionType;
  }[];
  poll?: {
    question: string;
    options: {
      _id?: string;
      optionText: string;
      votes: string[];
    }[];
  };
  containsSpoilers?: boolean;
  reported: boolean;
  hidden: boolean;
  /** Individual reports, so moderators can see who flagged what and why. */
  reports?: {
    user: string;
    reason?: string;
    createdAt: Date;
  }[];
  reportCount?: number;
  reportedAt?: Date;
  hiddenAt?: Date;
  hiddenBy?: string;
  createdAt: Date;
}

export interface IFollow {
  _id: string;
  id?: string;
  follower: string;
  followedType: 'user' | 'title';
  followedUser?: string;
  followedTitle?: string;
  createdAt: Date;
}
