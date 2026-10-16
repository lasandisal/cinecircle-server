import { Request, Response, NextFunction } from 'express';
import { Title, TasteProfile, User, WatchProvider } from '../models';
import { sendSuccess } from '../utils/response';
import { AiService } from '../services/ai.service';
import { RecommendationService } from '../services/recommendation.service';
import type { IAuthRequest } from '../types';

const MOOD_GENRES: Record<string, string[]> = {
  Comfort: ['Comedy', 'Animation', 'Romance', 'Family', 'Adventure'],
  Gripping: ['Thriller', 'Crime', 'Action', 'Mystery', 'Drama'],
  'Mind-Bending': ['Science Fiction', 'Sci-Fi', 'Mystery', 'Thriller', 'Drama'],
  Fun: ['Comedy', 'Animation', 'Action', 'Adventure'],
  Stunning: ['Science Fiction', 'Sci-Fi', 'Adventure', 'Fantasy', 'Action', 'Drama'],
};

/**
 * Generate real tailored recommendations based on mood, available time, and taste profile
 * POST /api/recommendations/solo or GET /api/recommendations/solo
 */
export const getSoloRecommendation = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.method === 'POST' ? req.body : req.query;
    const { mood = 'Gripping', duration = 90, type, aiPrompt } = body;

    let targetGenres: string[] = MOOD_GENRES[mood as string] || ['Drama', 'Thriller'];
    let maxRuntime = Number(duration) || 90;
    let rationalePrefix = `Selected for your "${mood}" mood`;
    // Provenance of the rationale shown on each card, so a template is never
    // presented as something Gemini wrote.
    let rationaleSource: 'gemini' | 'fallback' | 'none' = 'none';
    let userExclusions: string[] = [];
    let userSubscribedServices: string[] = [];

    const userId = req.user?.id;

    // Recency-weighted taste. Derived from WatchHistory, which until now was
    // written but never read by anything.
    const taste = await RecommendationService.getTasteContext(userId);
    userExclusions = taste.exclusions;
    userSubscribedServices = taste.subscribedServices;

    let fatigueActive = false;
    if (userId) {
      const userDoc = await User.findById(userId).select('fatigueCount').lean();
      fatigueActive = RecommendationService.isFatigued(userDoc?.fatigueCount);
      // Decision fatigue narrows the window, favouring shorter titles.
      if (fatigueActive) {
        maxRuntime = Math.min(maxRuntime, 100);
      }
    }

    // If natural language vibe prompt is provided, use Gemini AI to interpret
    if (aiPrompt && typeof aiPrompt === 'string' && aiPrompt.trim()) {
      try {
        const parsed = await AiService.parseVibePrompt(aiPrompt.trim());
        if (parsed.suggestedGenres?.length) {
          targetGenres = parsed.suggestedGenres;
        }
        if (parsed.maxRuntimeMinutes) {
          maxRuntime = parsed.maxRuntimeMinutes;
        }
        if (parsed.rationale) {
          rationalePrefix = parsed.rationale;
        }
        rationaleSource = parsed.source;
      } catch (e) {
        // Fallback to keyword matching if AI rate limited
      }
    }

    // Fold declared favourite genres into the mood's genre set.
    if (taste.favoriteGenres.length > 0) {
      targetGenres = Array.from(new Set([...targetGenres, ...taste.favoriteGenres]));
    }

    // Query titles from database
    const query: any = {};
    if (type === 'film' || type === 'tv') {
      query.type = type;
    }

    // Pre-filter on runtime so the scored pool stays bounded. Titles with no
    // runtime are kept (runtimeFit scores them neutral rather than perfect).
    if (maxRuntime && maxRuntime > 0) {
      query.$or = [
        { runtimeMinutes: { $lte: maxRuntime } },
        { runtimeMinutes: { $exists: false } },
        { runtimeMinutes: 0 },
      ];
    }

    // Sorted pool: the previous query was `.limit(60)` with no sort, so which
    // 60 titles were considered was effectively arbitrary.
    const candidateTitles = await Title.find(query)
      .sort({ voteAverage: -1, releaseYear: -1 })
      .limit(fatigueActive ? 40 : 80)
      .lean();
    const candidateIds = candidateTitles.map((t) => t._id);

    // Fetch watch providers for candidates
    const providers = await WatchProvider.find({ title: { $in: candidateIds } }).lean();
    const providerMap = new Map<string, string[]>();
    for (const p of providers) {
      const key = p.title.toString();
      if (!providerMap.has(key)) providerMap.set(key, []);
      if (!providerMap.get(key)!.includes(p.service)) {
        providerMap.get(key)!.push(p.service);
      }
    }

    // Score each candidate with the documented weighted formula.
    const scored: any[] = [];

    for (const t of candidateTitles) {
      // Hard exclusions (exact genre match) - handled by the service so the
      // rule lives in one place.
      if (RecommendationService.matchesHardExclusion(t, userExclusions)) continue;

      // NOTE: no fabricated fallback list here. The previous code defaulted to
      // ['Netflix','Prime Video'] for any title with no WatchProvider rows,
      // which handed subscribers a free "ready to stream" boost that was not
      // real and was also shown to the user as genuine availability.
      const availableServices = providerMap.get(t._id.toString()) || [];

      const { score: matchScore, breakdown } = RecommendationService.scoreSoloCandidate(
        t,
        {
          genreScores: taste.genreScores,
          favoriteGenres: taste.favoriteGenres,
          subscribedServices: userSubscribedServices,
          availableServices,
        },
        String(mood),
        maxRuntime
      );

      const reasons: string[] = [];
      if (breakdown.genreMatch > 0) reasons.push('Matches your recent taste');
      if (breakdown.moodTagMatch > 0) reasons.push(`Fits your "${mood}" mood`);
      if (breakdown.runtimeFit >= 1) reasons.push(`Fits your ${maxRuntime} min window`);
      if (breakdown.ownedServiceBonus > 0) reasons.push('On a service you subscribe to');

      scored.push({
        id: t._id.toString(),
        tmdbId: t.tmdbId,
        name: t.name,
        type: t.type,
        releaseYear: t.releaseYear,
        posterUrl: t.posterUrl,
        backdropUrl: t.backdropUrl,
        genres: t.genres || [],
        runtimeMinutes: t.runtimeMinutes || 110,
        voteAverage: t.voteAverage || 7.8,
        synopsis: t.synopsis,
        matchScore,
        matchReason:
          reasons.length > 0
            ? `${rationalePrefix} • ${reasons.join(' • ')}`
            : `${rationalePrefix} • Highly rated standout choice`,
        streamingServices: availableServices.slice(0, 4),
        scoreBreakdown: {
          genreMatch: Math.round(breakdown.genreMatch * 100),
          moodTagMatch: Math.round(breakdown.moodTagMatch * 100),
          runtimeFit: Math.round(breakdown.runtimeFit * 100),
          ownedServiceBonus: Math.round(breakdown.ownedServiceBonus * 100),
        },
      });
    }

    scored.sort((a, b) => b.matchScore - a.matchScore);

    // Decision fatigue deliberately shrinks the shortlist.
    const shortlist = scored.slice(0, fatigueActive ? 3 : 6);

    sendSuccess(
      res,
      {
        shortlist,
        criteria: { mood, maxRuntime, targetGenres, fatigueActive, rationaleSource },
      },
      'Solo recommendations generated successfully'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Break decision fatigue by collapsing the shortlist to one definitive pick.
 * POST /api/recommendations/fatigue
 *
 * Previously returned a hardcoded `fatigueCount: 1`, never wrote anything, and
 * ignored `User.fatigueCount` entirely - so the counter could only ever be 0.
 */
export const handleDecisionFatigue = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;

    // Pick the best-scoring title the user can actually finish, honouring their
    // exclusions, services and a hard 90-minute ceiling.
    const taste = await RecommendationService.getTasteContext(userId);

    const candidates = await Title.find({
      runtimeMinutes: { $gte: 1, $lte: 90 },
      ...(taste.exclusions.length > 0
        ? { genres: { $nin: taste.exclusions.map((e) => new RegExp(`^${escapeRegex(String(e))}$`, 'i')) } }
        : {}),
    })
      .sort({ voteAverage: -1 })
      .limit(80)
      .lean();

    const candidateIds = candidates.map((c) => c._id);
    const providers = await WatchProvider.find({ title: { $in: candidateIds } }).lean();
    const providerMap = new Map<string, string[]>();
    for (const p of providers) {
      const key = p.title.toString();
      if (!providerMap.has(key)) providerMap.set(key, []);
      if (!providerMap.get(key)!.includes(p.service)) providerMap.get(key)!.push(p.service);
    }

    let champion: any = null;
    let championScore = -1;
    for (const t of candidates) {
      const { score } = RecommendationService.scoreSoloCandidate(
        t,
        {
          genreScores: taste.genreScores,
          favoriteGenres: taste.favoriteGenres,
          subscribedServices: taste.subscribedServices,
          availableServices: providerMap.get(t._id.toString()) || [],
        },
        'Comfort',
        90
      );
      if (score > championScore) {
        championScore = score;
        champion = t;
      }
    }

    // Actually record the fatigue event against the signed-in user.
    const fatigueCount = await RecommendationService.recordDecisionFatigue(userId as string);

    sendSuccess(
      res,
      {
        championPick: champion
          ? {
              id: champion._id.toString(),
              _id: champion._id,
              tmdbId: champion.tmdbId,
              name: champion.name,
              type: champion.type,
              releaseYear: champion.releaseYear,
              posterUrl: champion.posterUrl,
              backdropUrl: champion.backdropUrl,
              synopsis: champion.synopsis,
              genres: champion.genres || [],
              runtimeMinutes: champion.runtimeMinutes,
              voteAverage: champion.voteAverage,
              matchScore: championScore,
              streamingServices: (providerMap.get(champion._id.toString()) || []).slice(0, 4),
            }
          : null,
        // Real, persisted counter - not a literal.
        fatigueCount,
        fatigued: RecommendationService.isFatigued(fatigueCount),
        message: champion
          ? 'Decisive single recommendation selected to break fatigue.'
          : 'No eligible title found for a champion pick.',
      },
      'Decision fatigue resolved'
    );
  } catch (error) {
    next(error);
  }
};

/** Escape user input before it reaches a MongoDB $regex. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
