import axios from 'axios';
import { ENV } from '../config/env';
import { SEED_TITLES } from '../data/seedTitles';
import type { SeedTitleData } from '../data/seedTitles';

export interface FormattedTmdbTitle {
  tmdbId: number;
  name: string;
  type: 'film' | 'tv';
  genres: string[];
  synopsis: string;
  runtimeMinutes: number;
  releaseYear: number;
  voteAverage: number;
  posterUrl: string;
  backdropUrl: string;
  moodTags: string[];
  cast: {
    actorName: string;
    characterName: string;
    photoUrl?: string;
    bio?: string;
  }[];
  watchProviders: {
    service: string;
    region: string;
    type: 'subscription' | 'rental' | 'purchase';
  }[];
}

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const TMDB_BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';

// Canonical TMDB Genre ID to Name Mapping
const GENRE_MAP: Record<number, string> = {
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
  10759: 'Action & Adventure',
  10762: 'Kids',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics',
};

class TmdbService {
  private apiKey: string;
  private accessToken: string;

  constructor() {
    this.apiKey = ENV.TMDB_API_KEY || '';
    this.accessToken = ENV.TMDB_ACCESS_TOKEN || '';
  }

  public hasApiKey(): boolean {
    return (
      (!!this.apiKey && this.apiKey.trim().length > 0) ||
      (!!this.accessToken && this.accessToken.trim().length > 0)
    );
  }

  private getRequestConfig(params: Record<string, any> = {}) {
    const configParams: Record<string, any> = { ...params };
    if (this.apiKey) {
      configParams.api_key = this.apiKey;
    }
    const headers: Record<string, string> = {
      accept: 'application/json',
    };
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }
    return {
      params: configParams,
      headers,
      timeout: 8000,
    };
  }

  /**
   * Fetch trending titles from TMDB API or fallback to curated seed titles
   */
  public async fetchTrending(
    mediaType: 'movie' | 'tv' | 'all' = 'all',
    page: number = 1
  ): Promise<FormattedTmdbTitle[]> {
    if (!this.hasApiKey()) {
      return this.getFallbackTrending(mediaType);
    }

    try {
      const endpoint = `${TMDB_BASE_URL}/trending/${mediaType}/week`;
      const response = await axios.get(endpoint, this.getRequestConfig({ page }));

      const rawResults = response.data.results || [];
      return rawResults.map((item: any) => this.mapRawToFormatted(item));
    } catch (err: any) {
      console.warn('[TmdbService] TMDB API request failed, falling back to curated list:', err.message);
      return this.getFallbackTrending(mediaType);
    }
  }

  /**
   * Search titles across TMDB or fallback search in curated titles
   */
  public async searchTitles(query: string, page: number = 1): Promise<FormattedTmdbTitle[]> {
    if (!query || !query.trim()) {
      return [];
    }

    if (!this.hasApiKey()) {
      const q = query.toLowerCase().trim();
      return SEED_TITLES.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.genres.some((g) => g.toLowerCase().includes(q)) ||
          t.moodTags.some((m) => m.toLowerCase().includes(q))
      ) as FormattedTmdbTitle[];
    }

    try {
      const endpoint = `${TMDB_BASE_URL}/search/multi`;
      const response = await axios.get(
        endpoint,
        this.getRequestConfig({
          query,
          page,
          include_adult: false,
        })
      );

      const results = (response.data.results || [])
        .filter((item: any) => item.media_type === 'movie' || item.media_type === 'tv')
        .map((item: any) => this.mapRawToFormatted(item));

      return results;
    } catch (err: any) {
      console.warn('[TmdbService] TMDB Search failed, falling back to local dataset:', err.message);
      const q = query.toLowerCase().trim();
      return SEED_TITLES.filter((t) => t.name.toLowerCase().includes(q)) as FormattedTmdbTitle[];
    }
  }

  /**
   * Fetch full title details including cast & watch providers
   */
  public async fetchDetails(tmdbId: number, type: 'film' | 'tv'): Promise<FormattedTmdbTitle | null> {
    const fallbackMatch = SEED_TITLES.find((t) => t.tmdbId === tmdbId);
    if (!this.hasApiKey()) {
      return (fallbackMatch as FormattedTmdbTitle) || null;
    }

    const tmdbType = type === 'film' ? 'movie' : 'tv';
    try {
      const endpoint = `${TMDB_BASE_URL}/${tmdbType}/${tmdbId}`;
      const response = await axios.get(
        endpoint,
        this.getRequestConfig({
          append_to_response: 'credits,watch/providers',
        })
      );

      const data = response.data;
      const isMovie = tmdbType === 'movie';

      // Parse Cast
      const rawCast = data.credits?.cast || [];
      const cast = rawCast.slice(0, 8).map((c: any) => ({
        actorName: c.name || '',
        characterName: c.character || '',
        photoUrl: c.profile_path ? `${TMDB_IMAGE_BASE}${c.profile_path}` : undefined,
      }));

      // Parse Watch Providers (US & LK priority)
      const providersData = data['watch/providers']?.results || {};
      const regional = providersData['US'] || providersData['LK'] || Object.values(providersData)[0] || {};
      const flatrate = (regional as any).flatrate || [];

      const watchProviders = flatrate.map((p: any) => ({
        service: p.provider_name || 'Streaming',
        region: 'US',
        type: 'subscription' as const,
      }));

      const genres = (data.genres || []).map((g: any) => g.name);

      return {
        tmdbId: data.id,
        name: isMovie ? data.title : data.name,
        type: isMovie ? 'film' : 'tv',
        genres,
        synopsis: data.overview || '',
        runtimeMinutes: isMovie ? data.runtime || 120 : (data.episode_run_time?.[0] || 50),
        releaseYear: isMovie
          ? parseInt((data.release_date || '2024').substring(0, 4), 10)
          : parseInt((data.first_air_date || '2024').substring(0, 4), 10),
        voteAverage: Math.round((data.vote_average || 7.5) * 10) / 10,
        posterUrl: data.poster_path ? `${TMDB_IMAGE_BASE}${data.poster_path}` : '',
        backdropUrl: data.backdrop_path ? `${TMDB_BACKDROP_BASE}${data.backdrop_path}` : '',
        moodTags: fallbackMatch ? fallbackMatch.moodTags : this.generateMoodTags(genres),
        cast,
        watchProviders: watchProviders.length > 0 ? watchProviders : (fallbackMatch?.watchProviders || []),
      };
    } catch (err: any) {
      console.warn(`[TmdbService] Failed fetching TMDB ID ${tmdbId}, using fallback:`, err.message);
      return (fallbackMatch as FormattedTmdbTitle) || null;
    }
  }

  /**
   * Return all supported genres for filtering
   */
  public getAllGenres(): string[] {
    return Array.from(new Set(Object.values(GENRE_MAP))).sort();
  }

  private mapRawToFormatted(item: any): FormattedTmdbTitle {
    const isMovie = item.media_type === 'movie' || !!item.title;
    const genreNames = (item.genre_ids || [])
      .map((id: number) => GENRE_MAP[id])
      .filter(Boolean);

    const yearString = item.release_date || item.first_air_date || '2024';
    const releaseYear = parseInt(yearString.substring(0, 4), 10) || 2024;

    return {
      tmdbId: item.id,
      name: isMovie ? item.title : item.name,
      type: isMovie ? 'film' : 'tv',
      genres: genreNames.length > 0 ? genreNames : ['Drama'],
      synopsis: item.overview || '',
      runtimeMinutes: isMovie ? 120 : 45,
      releaseYear,
      voteAverage: Math.round((item.vote_average || 7.5) * 10) / 10,
      posterUrl: item.poster_path ? `${TMDB_IMAGE_BASE}${item.poster_path}` : '',
      backdropUrl: item.backdrop_path ? `${TMDB_BACKDROP_BASE}${item.backdrop_path}` : '',
      moodTags: this.generateMoodTags(genreNames),
      cast: [],
      watchProviders: [],
    };
  }

  private getFallbackTrending(mediaType: string): FormattedTmdbTitle[] {
    if (mediaType === 'movie') {
      return SEED_TITLES.filter((t) => t.type === 'film') as FormattedTmdbTitle[];
    }
    if (mediaType === 'tv') {
      return SEED_TITLES.filter((t) => t.type === 'tv') as FormattedTmdbTitle[];
    }
    return SEED_TITLES as FormattedTmdbTitle[];
  }

  private generateMoodTags(genres: string[]): string[] {
    const tags: string[] = [];
    if (genres.includes('Science Fiction') || genres.includes('Sci-Fi & Fantasy')) tags.push('Mind-Bending', 'High-Stakes');
    if (genres.includes('Drama')) tags.push('Emotional');
    if (genres.includes('Comedy')) tags.push('Feel-Good', 'Witty & Sharp');
    if (genres.includes('Action') || genres.includes('Action & Adventure')) tags.push('Adrenaline Rush', 'Fast-Paced');
    if (genres.includes('Horror') || genres.includes('Crime')) tags.push('Dark & Gritty');
    if (genres.includes('Animation')) tags.push('Visually Stunning');
    if (genres.includes('Adventure')) tags.push('Cinematic Spectacle');
    return tags.length > 0 ? tags.slice(0, 3) : ['Engaging', 'Cinematic'];
  }
}

export const tmdbService = new TmdbService();
