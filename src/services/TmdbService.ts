import axios from 'axios';
import { ENV } from '../config/env';
import { SEED_TITLES } from '../data/seedTitles';
import type { SeedTitleData } from '../data/seedTitles';

export interface FormattedTmdbTitle {
  tmdbId: number;
  name: string;
  originalName?: string;
  type: 'film' | 'tv';
  genres: string[];
  synopsis: string;
  runtimeMinutes: number;
  releaseYear: number;
  voteAverage: number;
  /** NEW: needed for Bayesian-style rating in the controller. */
  voteCount?: number;
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
  seasons?: {
    seasonNumber: number;
    name: string;
    episodeCount: number;
  }[];
}

const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';
const TMDB_BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';

// Canonical TMDB Genre ID to Name Mapping (used to turn genre_ids into names)
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

/**
 * NEW: genre NAME -> TMDB genre id, PER media type.
 *
 * The old code looked names up in the single GENRE_MAP above, so for TV:
 *  - "Action", "Adventure" resolved to the MOVIE ids (28/12) which TV doesn't use
 *    (TV uses 10759), and
 *  - "Science Fiction"/"Fantasy" resolved to 878/14 (movie ids; TV uses 10765).
 * That silently returned wrong or empty TV discovery results.
 * TV has no Romance / Thriller / Horror genre ids at all, so those are skipped
 * for TV (the semantic validator handles them instead).
 */
const MOVIE_GENRE_IDS: Record<string, number> = {
  action: 28, adventure: 12, animation: 16, comedy: 35, crime: 80, documentary: 99,
  drama: 18, family: 10751, fantasy: 14, history: 36, horror: 27, music: 10402,
  mystery: 9648, romance: 10749, 'science fiction': 878, 'sci-fi': 878, thriller: 53,
  war: 10752, western: 37,
};
const TV_GENRE_IDS: Record<string, number> = {
  action: 10759, adventure: 10759, 'action & adventure': 10759, animation: 16, comedy: 35,
  crime: 80, documentary: 99, drama: 18, family: 10751, kids: 10762, mystery: 9648,
  news: 10763, reality: 10764, fantasy: 10765, 'science fiction': 10765, 'sci-fi': 10765,
  'sci-fi & fantasy': 10765, soap: 10766, talk: 10767, war: 10768, 'war & politics': 10768,
  western: 37,
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
      return await this.fetchLiveTrending(mediaType, page);
    } catch (err: any) {
      console.warn('[TmdbService] TMDB API request failed, falling back to curated list:', err.message);
      return this.getFallbackTrending(mediaType);
    }
  }

  /**
   * Fetch live "trending this week" results from TMDB.
   *
   * Unlike fetchTrending(), this never substitutes curated seed data: the
   * caller can therefore tell whether a result is genuinely live. Throws when
   * TMDB is not configured or the request fails.
   */
  public async fetchLiveTrending(
    mediaType: 'movie' | 'tv' | 'all' = 'all',
    page: number = 1
  ): Promise<FormattedTmdbTitle[]> {
    if (!this.hasApiKey()) {
      throw new Error('TMDB API key is not configured');
    }

    const endpoint = `${TMDB_BASE_URL}/trending/${mediaType}/week`;
    const response = await axios.get(endpoint, this.getRequestConfig({ page }));

    const rawResults: any[] = response.data?.results || [];
    return rawResults
      // With mediaType=all TMDB mixes movies and TV; drop people/other kinds.
      .filter(
        (item) =>
          item.media_type === 'movie' ||
          item.media_type === 'tv' ||
          (mediaType !== 'all' && (item.title || item.name))
      )
      .map((item: any) => this.mapRawToFormatted(item));
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

  /* ------------------------------------------------------------------------ */
  /*  STEP 3: broad CANDIDATE RETRIEVAL (not a relevance decision)            */
  /* ------------------------------------------------------------------------ */

  /**
   * Retrieve a broad pool of possible matches. TMDB does NOT decide what is
   * relevant - the controller + Gemini do that afterwards.
   *
   * What was wrong before:
   *  1. `with_genres` used a comma = AND. "Drama,Romance" only returned titles
   *     having BOTH. Now pipe = OR (broader).
   *  2. `with_keywords` used a comma = AND of the FIRST search hit per phrase,
   *     with no sanity check. "elite Manhattan society" -> random keyword id ->
   *     (almost) zero results, or a wrong-topic keyword -> unrelated titles.
   *     Now OR, and a resolved keyword must actually resemble the phrase.
   *  3. Runtime param was `with_runtime_lte`. TMDB's param is `with_runtime.lte`
   *     (dot), so the filter was silently ignored.
   *  4. If no type was given it ALWAYS searched movies. Now it searches both.
   *  5. Only one page / ~20 results, with search hits overriding discover hits.
   *     Now several complementary calls are merged and de-duplicated.
   *  6. TV genre ids were wrong (see TV_GENRE_IDS).
   */
  public async discoverTitles(options: {
    type?: 'film' | 'tv';
    genres?: string[];
    keywords?: string[];
    query?: string;
    queries?: string[];
    maxRuntime?: number;
    page?: number;
    /**
     * One group of search terms PER REQUIRED CONCEPT, e.g.
     * [['upper east side','manhattan'], ['teen','high school']].
     * Each group is retrieved separately, so a rare concept (the setting) is not
     * drowned out by a broad one (teenagers).
     */
    keywordGroups?: string[][];
    /** Max candidates returned in total (default 30). */
    limit?: number;
  }): Promise<FormattedTmdbTitle[]> {
    if (!this.hasApiKey()) return [];

    const limit = options.limit ?? 30;
    const types: ('film' | 'tv')[] = options.type ? [options.type] : ['film', 'tv'];
    const perType = Math.ceil(limit / types.length);

    const perTypeResults = await Promise.all(types.map((t) => this.discoverForType(t, options, perType)));

    // Interleave so one media type cannot crowd out the other.
    const merged: FormattedTmdbTitle[] = [];
    const seen = new Set<string>();
    const longest = Math.max(...perTypeResults.map((r) => r.length), 0);
    for (let i = 0; i < longest; i++) {
      for (const list of perTypeResults) {
        const item = list[i];
        if (!item) continue;
        // movie and TV ids can collide, so the key includes the type.
        const key = `${item.type}:${item.tmdbId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
      }
    }
    return merged.slice(0, limit);
  }

  private async discoverForType(
    mediaType: 'film' | 'tv',
    options: {
      genres?: string[];
      keywords?: string[];
      query?: string;
      queries?: string[];
      maxRuntime?: number;
      page?: number;
      keywordGroups?: string[][];
    },
    cap: number
  ): Promise<FormattedTmdbTitle[]> {
    const tmdbType = mediaType === 'tv' ? 'tv' : 'movie';
    const page = options.page || 1;

    const genreIds = this.resolveGenreIds(options.genres || [], mediaType);
    const keywordIds = await this.resolveKeywordIds(options.keywords || []);
    const groupIds = await Promise.all(
      (options.keywordGroups || []).map((group) => this.resolveKeywordIds(group, 2))
    );
    console.info(
      `[TmdbService] ${tmdbType} keyword ids -> general: [${keywordIds.join(',')}] groups: ${JSON.stringify(groupIds)}`
    );

    const base: Record<string, any> = {
      page,
      sort_by: 'popularity.desc',
      include_adult: false,
      include_video: false,
      'vote_count.gte': 20,
    };
    // FIX: the parameter name contains a dot (was `with_runtime_lte`, which TMDB ignores).
    if (options.maxRuntime && options.maxRuntime > 0) base['with_runtime.lte'] = options.maxRuntime;

    const discover = async (extra: Record<string, any>): Promise<any[]> => {
      try {
        const res = await axios.get(`${TMDB_BASE_URL}/discover/${tmdbType}`, this.getRequestConfig({ ...base, ...extra }));
        return res.data?.results || [];
      } catch (error: any) {
        console.warn(`[TmdbService] discover/${tmdbType} failed:`, error?.message || error);
        return [];
      }
    };

    const calls: Promise<any[]>[] = [];
    // PER-CONCEPT retrieval: one discover (3 pages) per required concept.
    for (const ids of groupIds) {
      if (ids.length === 0) continue;
      for (const pageNo of [1, 2, 3]) {
        calls.push(discover({ with_keywords: ids.join('|'), page: pageNo }));
      }
    }
    // Pipe = OR in TMDB. Genres/keywords widen the pool; they don't narrow it.
    if (keywordIds.length > 0 && genreIds.length > 0) {
      calls.push(discover({ with_keywords: keywordIds.join('|'), with_genres: genreIds.join('|') }));
    }
    if (keywordIds.length > 0) calls.push(discover({ with_keywords: keywordIds.join('|') }));
    if (genreIds.length > 0) calls.push(discover({ with_genres: genreIds.join('|') }));
    if (keywordIds.length === 0 && genreIds.length === 0) calls.push(discover({}));

    // Text search (original prompt + concept phrases) is an extra retrieval signal.
    const queries = Array.from(
      new Set(
        [...(options.queries || []), ...(options.query ? [options.query] : [])]
          .map((q) => q.trim())
          .filter(Boolean)
      )
    ).slice(0, 4);
    for (const q of queries) {
      calls.push(
        axios
          .get(`${TMDB_BASE_URL}/search/${tmdbType}`, this.getRequestConfig({ query: q, page, include_adult: false }))
          .then((r) => r.data?.results || [])
          .catch((error: any) => {
            console.warn(`[TmdbService] search/${tmdbType} "${q}" failed:`, error?.message || error);
            return [];
          })
      );
    }

    const batches = await Promise.all(calls);
    // A title found by SEVERAL concept searches (e.g. both "Manhattan" and "teen")
    // is far more likely to match everything the user asked for, so it ranks first.
    const unique = new Map<number, { title: FormattedTmdbTitle; hits: number }>();
    for (const batch of batches) {
      const seenInBatch = new Set<number>();
      for (const raw of batch) {
        const mapped = this.mapRawToFormatted({ ...raw, media_type: tmdbType });
        if (!mapped.name || seenInBatch.has(mapped.tmdbId)) continue;
        seenInBatch.add(mapped.tmdbId);
        const existing = unique.get(mapped.tmdbId);
        if (existing) existing.hits += 1;
        else unique.set(mapped.tmdbId, { title: mapped, hits: 1 });
      }
    }
    const result = Array.from(unique.values())
      .sort((a, b) => b.hits - a.hits) // stable: ties keep TMDB popularity order
      .slice(0, cap)
      .map((entry) => entry.title);
    console.info(`[TmdbService] ${tmdbType}: ${unique.size} unique candidates, returning ${result.length}`);
    return result;
  }

  /** Genre names -> ids valid for THAT media type. Unknown names are skipped. */
  private resolveGenreIds(names: string[], mediaType: 'film' | 'tv'): number[] {
    const table = mediaType === 'tv' ? TV_GENRE_IDS : MOVIE_GENRE_IDS;
    const ids = names
      .map((n) => table[n.toLowerCase().trim()])
      .filter((id): id is number => typeof id === 'number');
    return Array.from(new Set(ids));
  }

  private keywordCache = new Map<string, number[]>();

  /**
   * Resolve search terms to TMDB keyword ids. A hit is only accepted when its
   * name really resembles the term (old code blindly trusted result[0]).
   * Up to `perTerm` matching ids are kept per term, and lookups are cached.
   */
  private async resolveKeywordIds(keywords: string[], perTerm = 1): Promise<number[]> {
    const unique = Array.from(new Set(keywords.map((k) => k.toLowerCase().trim()).filter((k) => k.length >= 3))).slice(0, 8);
    const lists = await Promise.all(
      unique.map(async (keyword) => {
        const cacheKey = `${keyword}|${perTerm}`;
        const cached = this.keywordCache.get(cacheKey);
        if (cached) return cached;
        try {
          const response = await axios.get(
            `${TMDB_BASE_URL}/search/keyword`,
            this.getRequestConfig({ query: keyword })
          );
          const words = keyword.split(/\s+/).filter((w) => w.length > 3);
          const ids = (response.data?.results || [])
            .filter((r: any) => {
              const name = String(r.name || '').toLowerCase();
              return name === keyword || keyword.includes(name) || words.some((w) => name.includes(w));
            })
            .slice(0, perTerm)
            .map((r: any) => r.id as number);
          this.keywordCache.set(cacheKey, ids);
          return ids;
        } catch (error: any) {
          console.warn(`[TmdbService][keyword-resolution] Failed for "${keyword}":`, error?.message || error);
          return [] as number[];
        }
      })
    );
    return Array.from(new Set(lists.flat()));
  }

  /**
   * Fetch full title details including cast & watch providers
   */
  public async fetchDetails(
    tmdbId: number,
    type?: 'film' | 'tv'
  ): Promise<FormattedTmdbTitle | null> {
    const fallbackMatch = SEED_TITLES.find((t) => t.tmdbId === tmdbId);
    if (!this.hasApiKey()) {
      return (fallbackMatch as FormattedTmdbTitle) || null;
    }

    // Try specified type first, then fallback to other type (e.g. movie -> tv or tv -> movie)
    const typesToTry: ('movie' | 'tv')[] =
      type === 'tv' ? ['tv', 'movie'] : ['movie', 'tv'];

    for (const tmdbType of typesToTry) {
      try {
        const endpoint = `${TMDB_BASE_URL}/${tmdbType}/${tmdbId}`;
        const response = await axios.get(
          endpoint,
          this.getRequestConfig({
            append_to_response: 'credits,watch/providers',
          })
        );

        const data = response.data;
        if (!data || (!data.title && !data.name)) {
          continue;
        }

        const isMovie = tmdbType === 'movie';

        // Parse Cast
        const rawCast = data.credits?.cast || [];
        const cast = rawCast.slice(0, 10).map((c: any) => ({
          actorName: c.name || '',
          characterName: c.character || '',
          photoUrl: c.profile_path ? `${TMDB_IMAGE_BASE}${c.profile_path}` : undefined,
        }));

        // Parse Watch Providers across priority and global regions (including Netflix, Prime Video, Max, Disney+, Apple TV+, etc.)
        const providersData = data['watch/providers']?.results || {};
        const serviceMap = new Map<string, { regions: Set<string>; type: 'subscription' | 'rental' | 'purchase' }>();

        const addProvider = (
          service: string,
          region: string,
          type: 'subscription' | 'rental' | 'purchase' = 'subscription'
        ) => {
          if (!serviceMap.has(service)) {
            serviceMap.set(service, { regions: new Set(), type });
          }
          serviceMap.get(service)!.regions.add(region);
        };

        const priorityRegions = ['LK', 'US', 'GB', 'IN', 'AU', 'CA', 'DE', 'FR', 'JP'];
        const allRegionKeys = Array.from(new Set([...priorityRegions, ...Object.keys(providersData)]));

        for (const rKey of allRegionKeys) {
          const rData = providersData[rKey];
          if (!rData) continue;

          // 1. Subscription flatrate providers
          if (Array.isArray(rData.flatrate)) {
            for (const item of rData.flatrate) {
              const rawName = item.provider_name || '';
              const lower = rawName.toLowerCase();

              let recognizedFamous = false;

              if (lower.includes('netflix')) {
                addProvider('Netflix', rKey, 'subscription');
                recognizedFamous = true;
              }
              if (lower.includes('prime') || lower.includes('amazon')) {
                addProvider('Prime Video', rKey, 'subscription');
                recognizedFamous = true;
              }
              if (lower.includes('max') || lower.includes('hbo')) {
                addProvider('Max', rKey, 'subscription');
                recognizedFamous = true;
              }
              if (lower.includes('disney')) {
                addProvider('Disney+', rKey, 'subscription');
                recognizedFamous = true;
              }
              if (lower.includes('apple tv')) {
                addProvider('Apple TV+', rKey, 'subscription');
                recognizedFamous = true;
              }
              if (lower.includes('hulu')) {
                addProvider('Hulu', rKey, 'subscription');
                recognizedFamous = true;
              }
              if (lower.includes('paramount')) {
                addProvider('Paramount+', rKey, 'subscription');
                recognizedFamous = true;
              }
              if (lower.includes('peacock')) {
                addProvider('Peacock', rKey, 'subscription');
                recognizedFamous = true;
              }

              // Other non-famous or local regional cable/broadcasters
              if (!recognizedFamous && rawName.trim()) {
                addProvider(rawName.trim(), rKey, 'subscription');
              }
            }
          }

          // 2. Buy/rent digital streams (check for Prime Video and Apple TV+ if not already present)
          const digitalItems = [...(rData.buy || []), ...(rData.rent || [])];
          for (const item of digitalItems) {
            const rawName = item.provider_name || '';
            const lower = rawName.toLowerCase();
            if (lower.includes('amazon') || lower.includes('prime')) {
              addProvider('Prime Video', rKey, 'subscription');
            }
            if (lower.includes('apple')) {
              addProvider('Apple TV+', rKey, 'rental');
            }
          }
        }

        const watchProviders: { service: string; region: string; type: 'subscription' | 'rental' | 'purchase' }[] = [];
        for (const [serviceName, entry] of serviceMap.entries()) {
          const regionsArr = Array.from(entry.regions);
          let regionLabel = 'Global';
          if (regionsArr.includes('US') && regionsArr.includes('LK')) {
            regionLabel = 'US • LK';
          } else if (regionsArr.includes('LK')) {
            regionLabel = 'LK';
          } else if (regionsArr.includes('US')) {
            regionLabel = regionsArr.length > 5 ? 'US • Global' : 'US';
          } else if (regionsArr.length > 10) {
            regionLabel = 'Global';
          } else {
            regionLabel = regionsArr.slice(0, 3).join(' • ');
          }

          watchProviders.push({
            service: serviceName,
            region: regionLabel,
            type: entry.type,
          });
        }

        const genres = (data.genres || []).map((g: any) => g.name);

        // Parse Seasons if TV
        const seasons =
          !isMovie && Array.isArray(data.seasons)
            ? data.seasons
                .filter((s: any) => s.season_number > 0)
                .map((s: any) => ({
                  seasonNumber: s.season_number,
                  name: s.name || `Season ${s.season_number}`,
                  episodeCount: s.episode_count || 10,
                }))
            : [];

        return {
          tmdbId: data.id,
          name: isMovie ? data.title : data.name,
          originalName: isMovie ? data.original_title : data.original_name,
          type: isMovie ? 'film' : 'tv',
          genres,
          synopsis: data.overview || '',
          runtimeMinutes: isMovie ? data.runtime || 120 : (data.episode_run_time?.[0] || 45),
          releaseYear: isMovie
            ? parseInt((data.release_date || '2024').substring(0, 4), 10)
            : parseInt((data.first_air_date || '2024').substring(0, 4), 10),
          voteAverage: Math.round((data.vote_average || 7.5) * 10) / 10,
          voteCount: data.vote_count,
          posterUrl: data.poster_path ? `${TMDB_IMAGE_BASE}${data.poster_path}` : '',
          backdropUrl: data.backdrop_path ? `${TMDB_BACKDROP_BASE}${data.backdrop_path}` : '',
          moodTags: fallbackMatch ? fallbackMatch.moodTags : this.generateMoodTags(genres),
          cast,
          watchProviders: watchProviders.length > 0 ? watchProviders : (fallbackMatch?.watchProviders || []),
          seasons,
        };
      } catch (err: any) {
        // Continue to try the alternate type (movie vs tv)
        continue;
      }
    }

    console.warn(`[TmdbService] TMDB ID ${tmdbId} not found under movie or tv, using fallback`);
    return (fallbackMatch as FormattedTmdbTitle) || null;
  }

  /**
   * Fetch full episodes for a specific season from TMDB
   */
  public async fetchSeasonDetails(
    tmdbId: number,
    seasonNumber: number
  ): Promise<{
    seasonNumber: number;
    name: string;
    overview: string;
    episodes: {
      episodeNumber: number;
      name: string;
      summary: string;
      runtimeMinutes: number;
      stillUrl: string;
      airDate: string;
      voteAverage: number;
    }[];
  } | null> {
    if (!this.hasApiKey()) return null;

    try {
      const endpoint = `${TMDB_BASE_URL}/tv/${tmdbId}/season/${seasonNumber}`;
      const response = await axios.get(endpoint, this.getRequestConfig());
      const data = response.data;
      if (!data || !Array.isArray(data.episodes)) return null;

      const episodes = data.episodes.map((ep: any) => ({
        episodeNumber: ep.episode_number,
        name: ep.name || `Episode ${ep.episode_number}`,
        summary: ep.overview || '',
        runtimeMinutes: ep.runtime || 22,
        stillUrl: ep.still_path ? `${TMDB_IMAGE_BASE}${ep.still_path}` : '',
        airDate: ep.air_date || '',
        voteAverage: ep.vote_average ? Math.round(ep.vote_average * 10) / 10 : 0,
      }));

      return {
        seasonNumber: data.season_number,
        name: data.name || `Season ${data.season_number}`,
        overview: data.overview || '',
        episodes,
      };
    } catch (err: any) {
      console.warn(`[TmdbService] Failed fetching season ${seasonNumber} for TMDB ID ${tmdbId}:`, err.message);
      return null;
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
      // NEW: the controller/validator reads originalName; it was never populated here.
      originalName: isMovie ? item.original_title : item.original_name,
      type: isMovie ? 'film' : 'tv',
      // CHANGED: was `['Drama']` when TMDB sent no genres. That invented a genre
      // and made unrelated titles look like Drama matches. Unknown = empty.
      genres: genreNames,
      synopsis: item.overview || '',
      // Trending/search payloads do not include runtime. 0 means "unknown"
      // so the UI can omit it instead of displaying a fabricated value.
      runtimeMinutes: 0,
      releaseYear,
      voteAverage: Math.round((item.vote_average || 0) * 10) / 10,
      voteCount: item.vote_count,
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