import { Request } from 'express';
import { Types } from 'mongoose';

export type UserRole = 'user' | 'admin';

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  tasteProfile?: Types.ObjectId;
  subscribedServices: string[];
  fatigueCount: number;
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
  _id: Types.ObjectId;
  user: Types.ObjectId;
  title: Types.ObjectId;
  watched: boolean;
  starRating?: number;
  addedAt: Date;
  watchedAt?: Date;
}

export interface IWatchHistory {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  title: Types.ObjectId;
  action: ActionType;
  rating?: number;
  moodAtTime?: string;
  timestamp: Date;
}

export interface ITasteProfile {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  favoriteGenres: string[];
  favoriteTitles: Types.ObjectId[];
  exclusions: string[];
  updatedAt: Date;
}

export interface ITitle {
  _id: Types.ObjectId;
  tmdbId: number;
  name: string;
  type: 'tv' | 'film';
  genres: string[];
  synopsis: string;
  runtimeMinutes: number;
  posterUrl: string;
  moodTags: string[];
  cast: {
    actorName: string;
    characterName: string;
    photoUrl?: string;
    bio?: string;
  }[];
}

export interface ISeasonEpisode {
  _id: Types.ObjectId;
  title: Types.ObjectId;
  seasonNumber: number;
  episodes: {
    episodeNumber: number;
    name: string;
    summary: string;
    runtimeMinutes: number;
  }[];
}

export interface ISoundtrack {
  _id: Types.ObjectId;
  title: Types.ObjectId;
  songName: string;
  artist: string;
  episodeRef?: string;
  popularityRank: number;
  addedBy: Types.ObjectId;
}

export interface ISession {
  _id: Types.ObjectId;
  host: Types.ObjectId;
  joinCode: string;
  participants: Types.ObjectId[];
  constraints: {
    maxRuntime?: number;
    moodFilter?: string;
  };
  shortlist: Types.ObjectId[];
  status: 'open' | 'closed';
  finalPick?: Types.ObjectId;
  createdAt: Date;
}

export interface IVote {
  _id: Types.ObjectId;
  session: Types.ObjectId;
  user: Types.ObjectId;
  title: Types.ObjectId;
  reaction: 'yes' | 'no';
  strength: number;
}

export interface IWatchProvider {
  _id: Types.ObjectId;
  title: Types.ObjectId;
  service: string;
  region: string;
  type: 'subscription' | 'rental' | 'purchase';
  sourceUpdatedAt: Date;
}

export interface IComment {
  _id: Types.ObjectId;
  title: Types.ObjectId;
  user: Types.ObjectId;
  text: string;
  reported: boolean;
  hidden: boolean;
  createdAt: Date;
}

export interface IFollow {
  _id: Types.ObjectId;
  follower: Types.ObjectId;
  followedType: 'user' | 'title';
  followedUser?: Types.ObjectId;
  followedTitle?: Types.ObjectId;
  createdAt: Date;
}
