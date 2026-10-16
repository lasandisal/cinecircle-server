import { Title, TasteProfile, User, WatchHistory } from '../models';

/**
 * Recommendation Engine Service
 *
 * Implements:
 *  1. Recency-weighted taste profile decay:
 *       genreScore(g) = Σ( rating × 0.5^(ageDays / 60) )
 *     A rating made today counts fully; one made 60 days ago counts half as
 *     much; 120 days ago, a quarter. That is what lets a user's taste drift
 *     instead of freezing at whatever they rated first.
 *
 *  2. Solo mode weighted match score (normalised to 0-100):
 *       score = (genreMatch × 0.35) + (moodTagMatch × 0.35)
 *             + (runtimeFit × 0.15) + (ownedServiceBonus × 0.15)
 *
 *  3. Group mode weighted compromise score:
 *       titleScore = Σ( voteStrength_i × (+1 if 'yes' else −1) ) / participantCount
 */

/** A rating's influence halves every 60 days. */
const HALF_LIFE_DAYS = 60;
/** Watched-but-not-rated events contribute a neutral 3/5. */
const NEUTRAL_RATING = 3;
/** How many history events feed the profile (newest first). */
const MAX_HISTORY_EVENTS = 500;
/** A mood only narrows shortlists once fatigue has passed this threshold. */
export const FATIGUE_THRESHOLD = 2;

/**
 * Mood -> the moodTags vocabulary actually produced by TmdbService.generateMoodTags()
 * and the seeded catalogue. Matching the real vocabulary matters: the previous
 * implementation did `moodTag.includes(mood)`, so 'Comfort', 'Gripping' and
 * 'Fun' could never match any tag and their bonus was unreachable.
 */
const MOOD_TAGS: Record<string, string[]> = {
  Comfort: ['Feel-Good', 'Heartwarming', 'Nostalgic', 'Engaging'],
  Gripping: ['Dark & Gritty', 'High-Stakes', 'Intense', 'Suspenseful', 'Atmospheric'],
  'Mind-Bending': ['Mind-Bending', 'Philosophical', 'Intense'],
  Fun: ['Feel-Good', 'Witty & Sharp', 'Adrenaline Rush', 'Fast-Paced'],
  Stunning: ['Visually Stunning', 'Cinematic Spectacle', 'Epic & Grand'],
};

export interface WeightedTaste {
  genreScores: Record<string, number>;
  totalEvents: number;
  lastComputedAt: Date;
}

export interface SoloCandidateContext {
  /** Recency-weighted genre affinities from computeRecencyWeightedTasteProfile(). */
  genreScores?: Record<string, number>;
  /** Used as a fallback before the user has any watch history. */
  favoriteGenres?: string[];
  subscribedServices?: string[];
  availableServices?: string[];
}

export interface SoloScoreBreakdown {
  genreMatch: number;
  moodTagMatch: number;
  runtimeFit: number;
  ownedServiceBonus: number;
}

export interface CompromiseScore {
  titleId: string;
  /** Normalised: positive = net enthusiasm, negative = net rejection. */
  score: number;
  yesCount: number;
  noCount: number;
}

export class RecommendationService {
  /**
   * Exponential time decay. Returns 1 for "now" and 0.5 after one half-life.
   */
  public static recencyWeight(timestamp: Date | string, now: number = Date.now()): number {
    const time = new Date(timestamp).getTime();
    if (!Number.isFinite(time)) return 0;
    const ageDays = Math.max(0, (now - time) / 86_400_000);
    return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  }

  /**
   * Build the user's recency-weighted genre affinities from their WatchHistory.
   *
   * This is the first reader of WatchHistory in the codebase - previously the
   * collection was written to but never queried, so taste could not evolve.
   * The result is cached onto TasteProfile so it can be inspected and reused.
   */
  public static async computeRecencyWeightedTasteProfile(userId: string): Promise<WeightedTaste> {
    const computedAt = new Date();

    const history = await WatchHistory.find({
      user: userId,
      action: { $in: ['watched', 'rated'] },
    })
      .sort({ timestamp: -1 })
      .limit(MAX_HISTORY_EVENTS)
      .lean();

    if (history.length === 0) {
      return { genreScores: {}, totalEvents: 0, lastComputedAt: computedAt };
    }

    const titleIds = Array.from(new Set(history.map((h) => h.title.toString())));
    const titles = await Title.find({ _id: { $in: titleIds } })
      .select('genres')
      .lean();

    const genresByTitle = new Map<string, string[]>(
      titles.map((t: any) => [t._id.toString(), Array.isArray(t.genres) ? t.genres : []])
    );

    const genreScores: Record<string, number> = {};

    for (const entry of history as any[]) {
      const genres = genresByTitle.get(entry.title.toString()) || [];
      if (genres.length === 0) continue;

      const rating = typeof entry.rating === 'number' ? entry.rating : NEUTRAL_RATING;
      const weighted = rating * this.recencyWeight(entry.timestamp);

      // Spread each rating across the title's genres so a 3-genre title does
      // not triple-count against a 1-genre title.
      const share = weighted / genres.length;
      for (const genre of genres) {
        const key = String(genre).trim();
        if (!key) continue;
        genreScores[key] = (genreScores[key] || 0) + share;
      }
    }

    const result: WeightedTaste = { genreScores, totalEvents: history.length, lastComputedAt: computedAt };

    await TasteProfile.updateOne(
      { user: userId },
      { $set: { genreScores, tasteComputedAt: computedAt } },
      { upsert: true, setDefaultsOnInsert: true }
    ).catch((err: any) => {
      console.warn('[RecommendationService] Could not persist genre scores:', err.message);
    });

    return result;
  }

  /**
   * Cached read of the persisted profile, falling back to recomputing when the
   * profile has never been calculated.
   */
  public static async getTasteContext(userId?: string): Promise<{
    genreScores: Record<string, number>;
    favoriteGenres: string[];
    exclusions: string[];
    subscribedServices: string[];
  }> {
    const empty = { genreScores: {}, favoriteGenres: [], exclusions: [], subscribedServices: [] };
    if (!userId) return empty;

    const [profile, user] = await Promise.all([
      TasteProfile.findOne({ user: userId }).lean(),
      User.findById(userId).select('subscribedServices fatigueCount').lean(),
    ]);

    let genreScores: Record<string, number> = {};

    if (profile?.genreScores) {
      // Mongoose returns a Map for Map-typed paths; normalise to a plain object.
      const raw = profile.genreScores as any;
      genreScores =
        raw instanceof Map
          ? Object.fromEntries(Array.from(raw.entries()))
          : (raw as Record<string, number>);
    } else if (profile) {
    // Never computed (profiles created before this feature) - do it once now.
      const computed = await this.computeRecencyWeightedTasteProfile(userId);
      genreScores = computed.genreScores;
    }

    return {
      genreScores,
      favoriteGenres: profile?.favoriteGenres || [],
      exclusions: profile?.exclusions || [],
      subscribedServices: user?.subscribedServices || [],
    };
  }

  /**
   * Solo-mode scoring, exactly as documented:
   *   (genreMatch × 0.35) + (moodTagMatch × 0.35) + (runtimeFit × 0.15)
   *   + (ownedServiceBonus × 0.15)          → × 100
   *
   * Every term is normalised to 0..1 first, so the weights are meaningful and
   * the result is a genuine 0-100 fit rather than a value clamped to 68..99.
   */
  public static scoreSoloCandidate(
    title: any,
    context: SoloCandidateContext,
    mood: string,
    maxRuntime: number
  ): { score: number; breakdown: SoloScoreBreakdown } {
    const genreMatch = this.computeGenreMatch(title, context);
    const moodTagMatch = this.computeMoodTagMatch(title, mood);
    const runtimeFit = this.computeRuntimeFit(title?.runtimeMinutes, maxRuntime);
    const ownedServiceBonus = this.computeOwnedServiceBonus(context);

    const weighted =
      genreMatch * 0.35 +
      moodTagMatch * 0.35 +
      runtimeFit * 0.15 +
      ownedServiceBonus * 0.15;

    return {
      score: Math.round(weighted * 100),
      breakdown: { genreMatch, moodTagMatch, runtimeFit, ownedServiceBonus },
    };
  }

  /** Share of the user's weighted genre affinity that this title's genres cover. */
  private static computeGenreMatch(title: any, context: SoloCandidateContext): number {
    const titleGenres: string[] = (Array.isArray(title?.genres) ? title.genres : []).map((g: string) =>
      String(g).toLowerCase()
    );
    if (titleGenres.length === 0) return 0;

    const scores = context.genreScores || {};
    const entries = Object.entries(scores);
    const total = entries.reduce<number>((sum, [, v]) => sum + (Number(v) || 0), 0);

    if (total > 0) {
      // Exact (case-insensitive) genre key match only - substring matching here
      // let "Drama" swallow "Drama & Thriller" and similar near-duplicates.
      const lookup = new Map(entries.map(([k, v]) => [k.toLowerCase(), Number(v) || 0]));
      const covered = titleGenres.reduce<number>((sum, g) => sum + (lookup.get(g) || 0), 0);
      return Math.min(1, covered / total);
    }

    // No watch history yet: fall back to declared favourite genres.
    const favourites = (context.favoriteGenres || []).map((g: string) => g.toLowerCase());
    if (favourites.length === 0) return 0;
    const hits = titleGenres.filter((g: string) => favourites.includes(g)).length;
    return Math.min(1, hits / favourites.length);
  }

  /** Fraction of the mood's expected tags that the title actually carries. */
  private static computeMoodTagMatch(title: any, mood: string): number {
    const wanted = MOOD_TAGS[mood];
    if (!wanted || wanted.length === 0) return 0;

    const tags: string[] = (Array.isArray(title?.moodTags) ? title.moodTags : []).map((t: string) =>
      String(t).toLowerCase()
    );
    if (tags.length === 0) return 0;

    const hits = wanted.filter((w) => {
      const needle = w.toLowerCase();
      return tags.some((t) => t === needle || t.includes(needle));
    }).length;

    return hits / wanted.length;
  }

  /**
   * How well the runtime serves the user's available window.
   * Unknown runtime scores neutral rather than perfect.
   */
  private static computeRuntimeFit(runtimeMinutes: number, maxRuntime: number): number {
    const runtime = Number(runtimeMinutes) || 0;
    if (runtime <= 0 || !maxRuntime || maxRuntime <= 0) return 0.5;

    if (runtime <= maxRuntime) {
      // Fills at least 60% of the window without exceeding it: ideal.
      const ratio = runtime / maxRuntime;
      return ratio >= 0.6 ? 1 : ratio / 0.6;
    }
    // Overran the window - penalise proportionally, steeper past 2×.
    const overshoot = (runtime - maxRuntime) / maxRuntime;
    return Math.max(0, 1 - overshoot * 2);
  }

  private static computeOwnedServiceBonus(context: SoloCandidateContext): number {
    const owned = (context.subscribedServices || []).map((s) => s.toLowerCase()).filter(Boolean);
    const available = (context.availableServices || []).map((s) => s.toLowerCase()).filter(Boolean);
    if (owned.length === 0 || available.length === 0) return 0;
    return owned.some((o) => available.some((a) => a.includes(o) || o.includes(a))) ? 1 : 0;
  }

  /** Excludes a title whose genres intersect the user's hard exclusions. */
  public static matchesHardExclusion(title: any, exclusions: string[]): boolean {
    if (!exclusions || exclusions.length === 0) return false;
    const titleGenres: string[] = (Array.isArray(title?.genres) ? title.genres : []).map((g: string) =>
      String(g).toLowerCase()
    );
    return exclusions.some((raw) => {
      const needle = String(raw).toLowerCase().trim();
      if (!needle) return false;
      // Exact genre match only. The previous bidirectional substring check meant
      // an exclusion like "Musical" also killed "Musical Comedy", and any short
      // free-text exclusion silently wiped out unrelated genres.
      return titleGenres.includes(needle);
    });
  }

  /**
   * Group mode compromise score.
   *   titleScore = Σ( voteStrength_i × (+1 if 'yes' else −1) ) / participantCount
   *
   * Dividing by participantCount makes scores comparable across room sizes, so
   * a 20-person room showing 40% enthusiasm reads lower than a 3-person room at 40%.
   */
  public static computeGroupCompromise(votes: any[], participantCount: number): CompromiseScore[] {
    const totals = new Map<string, CompromiseScore>();

    for (const vote of votes || []) {
      const key = vote.title?.toString();
      if (!key) continue;
      if (!totals.has(key)) {
        totals.set(key, { titleId: key, score: 0, yesCount: 0, noCount: 0 });
      }
      const entry = totals.get(key)!;
      const strength = Number(vote.strength) || 3;
      if (vote.reaction === 'yes') {
        entry.score += strength;
        entry.yesCount += 1;
      } else {
        entry.score -= strength;
        entry.noCount += 1;
      }
    }

    const divisor = Math.max(1, Number(participantCount) || 0);
    return Array.from(totals.values()).map((entry) => ({
      ...entry,
      score: Number((entry.score / divisor).toFixed(4)),
    }));
  }

  /**
   * Record that a decision session ended without a pick and return the new count.
   */
  public static async recordDecisionFatigue(userId: string): Promise<number> {
    const user = await User.findByIdAndUpdate(userId, { $inc: { fatigueCount: 1 } }, { new: true })
      .select('fatigueCount')
      .lean();
    return user?.fatigueCount ?? 1;
  }

  /** Reset once a decision is actually made. */
  public static async clearDecisionFatigue(userId: string): Promise<void> {
    await User.findByIdAndUpdate(userId, { $set: { fatigueCount: 0 } });
  }

  public static isFatigued(fatigueCount: number | undefined | null): boolean {
    return Number(fatigueCount || 0) > FATIGUE_THRESHOLD;
  }
}