import axios from 'axios';
import prisma from '../config/prisma';
import { tmdbService } from './tmdb.service';

export interface OmdbRatingResponse {
  imdbId?: string;
  imdbRating?: number | null;
  imdbVotes?: number | null;
  rottenTomatoesRating?: number | null;
}

const ratingCache = new Map<string, { data: OmdbRatingResponse; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours

export class OmdbService {
  private static getApiKey(): string {
    return process.env.OMDB_API_KEY || 'fa6a68a';
  }

  private static parseVotes(votesStr?: string): number | null {
    if (!votesStr) return null;
    const clean = parseInt(votesStr.replace(/,/g, ''), 10);
    return isNaN(clean) ? null : clean;
  }

  private static parseRottenTomatoes(ratingsArray?: Array<{ Source: string; Value: string }>): number | null {
    if (!ratingsArray || !Array.isArray(ratingsArray)) return null;
    const rt = ratingsArray.find((r) => r.Source === 'Rotten Tomatoes');
    if (!rt || !rt.Value) return null;
    const clean = parseInt(rt.Value.replace('%', ''), 10);
    return isNaN(clean) ? null : clean;
  }

  static async fetchRatingsByImdbId(imdbId: string): Promise<OmdbRatingResponse | null> {
    const key = this.getApiKey();
    if (!key || !imdbId) return null;

    const cached = ratingCache.get(imdbId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    try {
      const response = await axios.get('https://www.omdbapi.com/', {
        params: {
          apikey: key,
          i: imdbId,
        },
        timeout: 5000,
      });

      if (response.data && response.data.Response === 'True') {
        const result: OmdbRatingResponse = {
          imdbId,
          imdbRating:
            response.data.imdbRating !== 'N/A' && response.data.imdbRating
              ? parseFloat(response.data.imdbRating)
              : null,
          imdbVotes: this.parseVotes(response.data.imdbVotes),
          rottenTomatoesRating: this.parseRottenTomatoes(response.data.Ratings),
        };

        ratingCache.set(imdbId, { data: result, timestamp: Date.now() });
        return result;
      }
      return null;
    } catch (error) {
      console.warn(`[OmdbService] Failed to fetch ratings for IMDb ID ${imdbId}:`, error);
      return null;
    }
  }

  static async fetchRatingsByTitle(
    title: string,
    year?: number | null,
    type?: string
  ): Promise<OmdbRatingResponse | null> {
    const key = this.getApiKey();
    if (!key || !title) return null;

    const cacheKey = `${title.toLowerCase()}_${year || ''}`;
    const cached = ratingCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.data;
    }

    try {
      const params: any = {
        apikey: key,
        t: title,
      };
      if (year) params.y = year;
      if (type === 'tv' || type === 'series') params.type = 'series';
      else if (type === 'film' || type === 'movie') params.type = 'movie';

      const response = await axios.get('https://www.omdbapi.com/', {
        params,
        timeout: 5000,
      });

      if (response.data && response.data.Response === 'True') {
        const result: OmdbRatingResponse = {
          imdbId: response.data.imdbID || undefined,
          imdbRating:
            response.data.imdbRating !== 'N/A' && response.data.imdbRating
              ? parseFloat(response.data.imdbRating)
              : null,
          imdbVotes: this.parseVotes(response.data.imdbVotes),
          rottenTomatoesRating: this.parseRottenTomatoes(response.data.Ratings),
        };

        if (result.imdbId) {
          ratingCache.set(result.imdbId, { data: result, timestamp: Date.now() });
        }
        ratingCache.set(cacheKey, { data: result, timestamp: Date.now() });
        return result;
      }
      return null;
    } catch (error) {
      console.warn(`[OmdbService] Failed to fetch ratings for title "${title}":`, error);
      return null;
    }
  }

  static async enrichTitle(titleId: string): Promise<OmdbRatingResponse | null> {
    try {
      const title = await prisma.title.findUnique({ where: { id: titleId } });
      if (!title) return null;

      // If already has fresh ratings (within last 7 days), return existing ratings
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      if (
        title.ratingsUpdatedAt &&
        title.ratingsUpdatedAt > sevenDaysAgo &&
        (title.imdbRating !== null || title.rottenTomatoesRating !== null)
      ) {
        return {
          imdbId: title.imdbId || undefined,
          imdbRating: title.imdbRating,
          imdbVotes: title.imdbVotes,
          rottenTomatoesRating: title.rottenTomatoesRating,
        };
      }

      let imdbId = title.imdbId;

      // If imdbId is missing, query TMDB external_ids
      if (!imdbId && title.tmdbId) {
        try {
          const externalIds = await tmdbService.fetchExternalIds(title.tmdbId, title.type as 'film' | 'tv');
          if (externalIds?.imdb_id) {
            imdbId = externalIds.imdb_id;
            await prisma.title.update({
              where: { id: titleId },
              data: { imdbId },
            });
          }
        } catch {
          // Ignore external ID lookup errors
        }
      }

      let omdbData: OmdbRatingResponse | null = null;
      if (imdbId) {
        omdbData = await this.fetchRatingsByImdbId(imdbId);
      }

      // If lookup by imdbId yielded nothing, fallback to title & year query
      if (!omdbData) {
        omdbData = await this.fetchRatingsByTitle(title.name, title.releaseYear, title.type);
        if (omdbData?.imdbId && !imdbId) {
          imdbId = omdbData.imdbId;
        }
      }

      if (omdbData && (omdbData.imdbRating !== null || omdbData.rottenTomatoesRating !== null)) {
        await prisma.title.update({
          where: { id: titleId },
          data: {
            imdbId: imdbId || undefined,
            imdbRating: omdbData.imdbRating,
            imdbVotes: omdbData.imdbVotes,
            rottenTomatoesRating: omdbData.rottenTomatoesRating,
            ratingsUpdatedAt: new Date(),
          },
        });
        return omdbData;
      }

      return {
        imdbId: imdbId || undefined,
        imdbRating: title.imdbRating ?? null,
        imdbVotes: title.imdbVotes ?? null,
        rottenTomatoesRating: title.rottenTomatoesRating ?? null,
      };
    } catch (err: any) {
      console.warn('[OmdbService] Non-fatal enrichment error:', err.message);
      return null;
    }
  }
}
