import prisma from '../config/prisma';

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
 * Real compatibility between two members based on taste and watched films.
 */
export class CompatibilityService {
  /** Titles both people have watched. */
  static async mutualWatchedCount(userAId: string, userBId: string): Promise<number> {
    const watchedAItems = await prisma.watchlist.findMany({
      where: { userId: userAId, watched: true },
      select: { titleId: true },
    });
    const watchedA = Array.from(new Set(watchedAItems.map((w) => w.titleId)));
    if (watchedA.length === 0) return 0;

    return prisma.watchlist.count({
      where: {
        userId: userBId,
        watched: true,
        titleId: { in: watchedA },
      },
    });
  }

  /**
   * Compute compatibility for a viewer against a target user.
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
      prisma.tasteProfile.findUnique({ where: { userId: targetUserId } }),
      prisma.tasteProfile.findUnique({ where: { userId: viewerId } }),
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
   * Batch version for suggestion/search lists
   */
  static async computeBatch(
    viewerId: string | undefined,
    candidateIds: string[]
  ): Promise<Map<string, CompatibilityResult>> {
    const out = new Map<string, CompatibilityResult>();
    if (!viewerId || candidateIds.length === 0) return out;

    const [profiles, viewerProfile, viewerWatchedItems] = await Promise.all([
      prisma.tasteProfile.findMany({ where: { userId: { in: candidateIds } } }),
      prisma.tasteProfile.findUnique({ where: { userId: viewerId } }),
      prisma.watchlist.findMany({
        where: { userId: viewerId, watched: true },
        select: { titleId: true },
      }),
    ]);

    const profileByUser = new Map(profiles.map((p) => [p.userId, p]));
    const viewerGenres = normaliseGenreScores(viewerProfile);
    const viewerWatched = viewerWatchedItems.map((w) => w.titleId);

    const sharedCounts = new Map<string, number>();
    if (viewerWatched.length > 0) {
      const rows = await prisma.watchlist.groupBy({
        by: ['userId'],
        where: {
          userId: { in: candidateIds },
          watched: true,
          titleId: { in: viewerWatched },
        },
        _count: {
          titleId: true,
        },
      });
      for (const r of rows) {
        sharedCounts.set(r.userId, r._count.titleId);
      }
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
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    computed = Object.entries(raw)
      .filter(([, v]) => Number(v) > 0)
      .map(([k]) => k);
  }
  return Array.from(new Set([...favourites, ...computed]));
}
