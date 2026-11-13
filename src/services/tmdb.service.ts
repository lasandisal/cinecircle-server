import { tmdbService } from './Tmdbservice';

/**
 * Backwards-compatible alias.
 *
 * The full TMDB implementation lives in TmdbService.ts (capital T). This file
 * re-exports it so any existing imports of './tmdb.service' keep working without
 * accidentally using the old empty stub (search() returned [], getDetails()
 * returned null, and discoverTitles() did not exist).
 */
export { tmdbService };
