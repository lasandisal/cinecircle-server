import { TasteProfile, Watchlist } from '../models';

export interface CompatibilityInput {
  /** Recency-weighted genre affinities, when already computed. */
  genreScores?: Record<string, number>;
  /** Declared favourite genres from TasteProfile. */
  favoriteGenres?: string[];
  /** Titles this person has watched. */
  watchedTitleIds?: string[];
}

export interface CompatibilityResult {
  /** 0-100, or null when there is not enough shared signal to be honest about it. */
  score: number | null;
  genreOverlap: number;
  mutualWatchedCount: number;
  basis: 'taste' | 'watched' | 'both' | 'none';
  /** Human-readable explanation shown next to the number. */
  explanation: string;
}

const norm = (v: string) => String(v || '').trim().toLowerCase();

/** Jaccard overlap of two genre sets, 0..1. */
function jaccard(a: string[], b: string[]): { value: number; shared: string[] } {
  const A = new Set(a.map(norm).filter(Boolean));
  const B = new Set(b.map(norm).filter(Boolean));
  if (A.size === 0 || B.size === 0) return { value: 0, shared: [] };
  const shared = [...A].filter((x) => B.has(x));
  const union = new Set([...A, ...B]);
  return { value: shared.length / union.size, shared };
}

/**
 * Real compatibility between two members.
 *
 * Replaces fabricated scores that were previously produced by index
 * arithmetic (`82 + ((idx * 6) % 17)`), which meant the number changed when
 * list order changed and had no relationship to the two people at all.
 *
 * Signal used:
 *   - taste overlap   : Jaccard similarity of favourite genres + weighted genre scores
 *   - behaviour overlap: how many titles they have both watched
 *
 * Returns `score: null` when there is no shared signal at all, so the UI can
 * say "not enough shared history" instead of inventing a flattering number.
 */
export class CompatibilityService {
  /** Titles both people have watched. */
  static async mutualWatchedCount(userAId: string, userBId: string): Promise<number> {
    const watchedA = await Watchlist.find({ user: userAId, watched: true }).distinct('title');
    if (watchedA.length === 0) return 0;
    return Watchlist.countDocuments({
      user: userBId,
      watched: true,
      title: { $in: watchedA },
    });
  }

  /**
   * Compute compatibility for a viewer against a target user.
   * `viewerId` may be undefined (guest) - guests get no score.
   */
  static async compute(
    targetUserId: string,
    viewerId?: string
  ): Promise<CompatibilityResult> {
    if (!viewerId || viewerId === targetUserId) {
      return {
        score: null,
        genreOverlap: 0,
        mutualWatchedCount: 0,
        basis: 'none',
        explanation: 'Sign in to see how your taste lines up.',
      };
    }

    const [targetProfile, viewerProfile] = await Promise.all([
      TasteProfile.findOne({ user: targetUserId }).lean(),
      TasteProfile.findOne({ user: viewerId }).lean(),
    ]);

    const targetGenres = normaliseGenreScores(targetProfile);
    const viewerGenres = normaliseGenreScores(viewerProfile);
    const { value: genreOverlap, shared } = jaccard(targetGenres, viewerGenres);

    const mutualWatchedCount = await this.mutualWatchedCount(viewerId, targetUserId);

    const hasTasteSignal =
      (targetProfile?.favoriteGenres?.length || 0) + (viewerProfile?.favoriteGenres?.length || 0) > 0;
    const hasWatchSignal = mutualWatchedCount > 0;

    if (!hasTasteSignal && !hasWatchSignal) {
      return {
        score: null,
        genreOverlap: 0,
        mutualWatchedCount: 0,
        basis: 'none',
        explanation: 'Not enough shared history yet.',
      };
    }

    // Behaviour overlap saturates: ~10 shared titles is already a strong match.
    const watchedOverlap = Math.min(1, mutualWatchedCount / 10);

    const score = hasTasteSignal && hasWatchSignal
      ? Math.round(genreOverlap * 50 + watchedOverlap * 50)
      : hasTasteSignal
        ? Math.round(genreOverlap * 100)
        : Math.round(watchedOverlap * 100);

    const parts: string[] = [];
    if (hasTasteSignal && shared.length > 0) {
      parts.push(`${shared.length} shared genre${shared.length === 1 ? '' : 's'} (${shared.slice(0, 3).join(', ')})`);
    }
    if (hasWatchSignal) {
      parts.push(`${mutualWatchedCount} film${mutualWatchedCount === 1 ? '' : 's'} watched in common`);
    }

    // A genuine 0% reads as a verdict on someone. When there simply is no
    // overlap to measure, say so instead of scoring them as incompatible.
    if (parts.length === 0) {
      return {
        score: null,
        genreOverlap: 0,
        mutualWatchedCount,
        basis: 'none',
        explanation: shared.length === 0 && mutualWatchedCount === 0
          ? 'No overlapping genres or watched titles yet.'
          : 'Not enough shared history yet.',
      };
    }

    return {
      score,
      genreOverlap: Number(genreOverlap.toFixed(3)),
      mutualWatchedCount,
      basis: hasTasteSignal && hasWatchSignal ? 'both' : hasTasteSignal ? 'taste' : 'watched',
      explanation: parts.length > 0 ? `Based on ${parts.join(' and ')}.` : 'Based on shared history.',
    };
  }

  /**
   * Batch version for suggestion/search lists, to avoid an N+1 in the caller.
   * Returns a Map keyed by candidate user id.
   */
  static async computeBatch(
    viewerId: string | undefined,
    candidateIds: string[]
  ): Promise<Map<string, CompatibilityResult>> {
    const out = new Map<string, CompatibilityResult>();
    if (!viewerId || candidateIds.length === 0) return out;

    const profiles = await TasteProfile.find({ user: { $in: candidateIds } }).lean();
    const profileByUser = new Map(
      profiles.map((p: any) => [p.user.toString(), p] as const)
    );
    const viewerProfile = await TasteProfile.findOne({ user: viewerId }).lean();
    const viewerGenres = normaliseGenreScores(viewerProfile);

    const viewerWatched = await Watchlist.find({ user: viewerId, watched: true })
      .distinct('title');

    // One query for everyone's shared titles.
    const sharedCounts = new Map<string, number>();
    if (viewerWatched.length > 0) {
      const rows = await Watchlist.aggregate([
        { $match: { user: { $in: candidateIds }, watched: true, title: { $in: viewerWatched } } },
        { $group: { _id: '$user', count: { $sum: 1 } } },
      ]);
      for (const r of rows) sharedCounts.set(r._id.toString(), r.count);
    }

    for (const id of candidateIds) {
      const profile = profileByUser.get(id);
      const targetGenres = normaliseGenreScores(profile);
      const { value: genreOverlap, shared } = jaccard(targetGenres, viewerGenres);
      const mutualWatchedCount = sharedCounts.get(id) || 0;

      const hasTasteSignal =
        (profile?.favoriteGenres?.length || 0) + (viewerProfile?.favoriteGenres?.length || 0) > 0;
      const hasWatchSignal = mutualWatchedCount > 0;

      if (!hasTasteSignal && !hasWatchSignal) {
        out.set(id, {
          score: null,
          genreOverlap: 0,
          mutualWatchedCount: 0,
          basis: 'none',
          explanation: 'Not enough shared history yet.',
        });
        continue;
      }

      const watchedOverlap = Math.min(1, mutualWatchedCount / 10);
      const score = hasTasteSignal && hasWatchSignal
        ? Math.round(genreOverlap * 50 + watchedOverlap * 50)
        : hasTasteSignal
          ? Math.round(genreOverlap * 100)
          : Math.round(watchedOverlap * 100);

      const parts: string[] = [];
      if (hasTasteSignal && shared.length > 0) {
        parts.push(
          `${shared.length} shared genre${shared.length === 1 ? '' : 's'} (${shared.slice(0, 3).join(', ')})`
        );
      }
      if (hasWatchSignal) {
        parts.push(`${mutualWatchedCount} watched in common`);
      }

      // No measurable overlap is "unknown", not "0% incompatible".
      if (parts.length === 0) {
        out.set(id, {
          score: null,
          genreOverlap: 0,
          mutualWatchedCount,
          basis: 'none',
          explanation: 'No overlapping genres or watched titles yet.',
        });
        continue;
      }

      out.set(id, {
        score,
        genreOverlap: Number(genreOverlap.toFixed(3)),
        mutualWatchedCount,
        basis: hasTasteSignal && hasWatchSignal ? 'both' : hasTasteSignal ? 'taste' : 'watched',
        explanation: parts.length > 0 ? `Based on ${parts.join(' and ')}.` : 'Based on shared history.',
      });
    }

    return out;
  }
}

/** Union of declared favourite genres and computed weighted genre scores. */
function normaliseGenreScores(profile: any): string[] {
  if (!profile) return [];
  const favourites: string[] = Array.isArray(profile.favoriteGenres) ? profile.favoriteGenres : [];
  const raw = profile.genreScores;
  let computed: string[] = [];
  if (raw instanceof Map) {
    computed = Array.from(raw.entries())
      .filter(([, v]) => Number(v) > 0)
      .map(([k]) => k);
  } else if (raw && typeof raw === 'object') {
    computed = Object.entries(raw)
      .filter(([, v]) => Number(v) > 0)
      .map(([k]) => k);
  }
  return Array.from(new Set([...favourites, ...computed]));
}