import axios from 'axios';
import { ENV } from '../config/env';

/**
 * Service skeleton for TMDB API interactions
 * (Catalogue search, details, credits/cast, watch-provider data)
 */
export class TmdbService {
  private static baseURL = 'https://api.themoviedb.org/3';

  static async search(query: string, type: 'movie' | 'tv' = 'movie') {
    // Skeleton placeholder for TMDB API search
    return [];
  }

  static async getDetails(tmdbId: number, type: 'movie' | 'tv' = 'movie') {
    // Skeleton placeholder for TMDB details
    return null;
  }

  static async getWatchProviders(tmdbId: number, type: 'movie' | 'tv' = 'movie') {
    // Skeleton placeholder for JustWatch-backed TMDB watch providers
    return [];
  }
}
