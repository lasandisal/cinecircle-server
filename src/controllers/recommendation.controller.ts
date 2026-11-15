// import { Request, Response, NextFunction } from 'express';
// import prisma from '../config/prisma';
// import { sendSuccess } from '../utils/response';
// import { AiService } from '../services/ai.service';
// import { RecommendationService } from '../services/recommendation.service';
// import { tmdbService } from '../services/tmdb.service';
// import type { IAuthRequest } from '../types';

// const MOOD_GENRES: Record<string, string[]> = {
//   Comfort: ['Comedy', 'Animation', 'Romance', 'Family', 'Adventure'],
//   Gripping: ['Thriller', 'Crime', 'Action', 'Mystery', 'Drama'],
//   'Mind-Bending': ['Science Fiction', 'Sci-Fi', 'Mystery', 'Thriller', 'Drama'],
//   Fun: ['Comedy', 'Animation', 'Action', 'Adventure'],
//   Stunning: ['Science Fiction', 'Sci-Fi', 'Adventure', 'Fantasy', 'Action', 'Drama'],
// };

// function matchesPromptSemantics(
//   title: { name?: string | null; originalName?: string | null; synopsis?: string | null; genres?: string[] | null },
//   keywords: string[]
// ): boolean {
//   const phrases = keywords
//     .map((keyword) => keyword.toLowerCase().trim())
//     .filter((keyword) => keyword.split(/\s+/).length >= 2);
//   if (phrases.length === 0) return true;

//   const searchableText = [
//     title.name,
//     title.originalName,
//     title.synopsis,
//     ...(title.genres || []),
//   ]
//     .filter(Boolean)
//     .join(' ')
//     .toLowerCase();

//   if (phrases.some((phrase) => searchableText.includes(phrase))) return true;

//   const anchorWords = Array.from(
//     new Set(phrases.flatMap((phrase) => phrase.split(/\s+/).filter((word) => word.length > 3)))
//   );
//   const matchedAnchorWords = anchorWords.filter((word) => searchableText.includes(word)).length;
//   return anchorWords.length >= 3 && matchedAnchorWords >= Math.ceil(anchorWords.length * 0.67);
// }

// /**
//  * Generate real tailored recommendations based on mood, available time, and taste profile
//  * POST /api/recommendations/solo or GET /api/recommendations/solo
//  */
// export const getSoloRecommendation = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
//   try {
//     const startedAt = Date.now();
//     const body = req.method === 'POST' ? req.body : req.query;
//     const { mood = 'Gripping', duration, type, aiPrompt } = body;

//     let selectedMood = String(mood);
//     let targetGenres: string[] = MOOD_GENRES[selectedMood] || ['Drama', 'Thriller'];
//     const hasDurationFilter = duration !== undefined && duration !== null && duration !== '';
//     let maxRuntime = hasDurationFilter ? Number(duration) : 90;
//     let rationalePrefix = `Selected for your "${mood}" mood`;
//     let rationaleSource: 'gemini' | 'fallback' | 'none' = 'none';
//     let targetKeywords: string[] = [];
//     let promptGenres: string[] = [];
//     let requestedType: 'film' | 'tv' | null = null;
//     let userExclusions: string[] = [];
//     let userSubscribedServices: string[] = [];

//     const userId = req.user?.id;
//     const isPromptSearch = typeof aiPrompt === 'string' && aiPrompt.trim().length > 0;

//     const taste = await RecommendationService.getTasteContext(userId);
//     userExclusions = taste.exclusions;
//     userSubscribedServices = taste.subscribedServices;

//     let fatigueActive = false;
//     if (userId) {
//       const userDoc = await prisma.user.findUnique({
//         where: { id: userId },
//         select: { fatigueCount: true },
//       });
//       fatigueActive = RecommendationService.isFatigued(userDoc?.fatigueCount);
//       if (fatigueActive) {
//         maxRuntime = Math.min(maxRuntime, 100);
//       }
//     }

//     if (aiPrompt && typeof aiPrompt === 'string' && aiPrompt.trim()) {
//       try {
//         const parsed = await AiService.parseVibePrompt(aiPrompt.trim());
//         if (parsed.suggestedGenres?.length) {
//           targetGenres = parsed.suggestedGenres;
//           promptGenres = parsed.suggestedGenres;
//         } else {
//           targetGenres = [];
//         }
//         if (parsed.mood) {
//           selectedMood = parsed.mood;
//         }
//         if (parsed.maxRuntimeMinutes) {
//           maxRuntime = parsed.maxRuntimeMinutes;
//         }
//         if (parsed.rationale) {
//           rationalePrefix = parsed.rationale;
//         }
//         targetKeywords = parsed.targetKeywords || [];
//         requestedType = parsed.requestedType || null;
//         userExclusions = Array.from(new Set([...userExclusions, ...(parsed.exclusions || [])]));
//         rationaleSource = parsed.source;
//       } catch (error: any) {
//         console.warn('[Recommendations][intent-extraction] Gemini/local intent extraction failed:', error?.message || error);
//       }
//     }

//     if (!isPromptSearch && taste.favoriteGenres.length > 0) {
//       targetGenres = Array.from(new Set([...targetGenres, ...taste.favoriteGenres]));
//     }

//     const where: any = {};
//     if (type === 'film' || type === 'tv') {
//       where.type = type;
//     } else if (requestedType) {
//       where.type = requestedType;
//     }

//     const runtimeConditions = maxRuntime && maxRuntime > 0 ? [
//         { runtimeMinutes: { lte: maxRuntime } },
//         { runtimeMinutes: null },
//         { runtimeMinutes: 0 },
//       ] : null;
//     if (runtimeConditions) {
//       where.OR = runtimeConditions;
//     }

//     if (targetGenres.length > 0) {
//       where.genres = { hasSome: targetGenres };
//     }
//     if (targetKeywords.length > 0) {
//       const keywordConditions = targetKeywords.flatMap((keyword) => [
//         { name: { contains: keyword, mode: 'insensitive' } },
//         { synopsis: { contains: keyword, mode: 'insensitive' } },
//       ]);
//       where.AND = [{ OR: keywordConditions }];
//       if (runtimeConditions) {
//         where.AND.push({ OR: runtimeConditions });
//         delete where.OR;
//       }
//     }

//     let candidateTitles = await prisma.title.findMany({
//       where,
//       orderBy: [{ voteAverage: 'desc' }, { releaseYear: 'desc' }],
//       take: fatigueActive ? 40 : 80,
//     });

//     // Keep recommendations useful when a small catalogue has no exact keyword or mood match.
//     if (!isPromptSearch && candidateTitles.length === 0 && (where.OR || where.AND || where.genres)) {
//       delete where.OR;
//       delete where.AND;
//       delete where.genres;
//       candidateTitles = await prisma.title.findMany({
//         where,
//         orderBy: [{ voteAverage: 'desc' }, { releaseYear: 'desc' }],
//         take: fatigueActive ? 40 : 80,
//       });
//     }
//     const candidateIds = candidateTitles.map((t) => t.id);

//     const providers = await prisma.watchProvider.findMany({
//       where: { titleId: { in: candidateIds } },
//     });
//     const providerMap = new Map<string, string[]>();
//     for (const p of providers) {
//       const key = p.titleId;
//       if (!providerMap.has(key)) providerMap.set(key, []);
//       if (!providerMap.get(key)!.includes(p.service)) {
//         providerMap.get(key)!.push(p.service);
//       }
//     }

//     const scored: any[] = [];

//     for (const t of candidateTitles) {
//       if (isPromptSearch && !matchesPromptSemantics(t, targetKeywords)) {
//         console.info(`[Recommendations][semantic-validation] Rejected local title "${t.name}"`);
//         continue;
//       }
//       if (RecommendationService.matchesHardExclusion(t, userExclusions)) continue;

//       const availableServices = providerMap.get(t.id) || [];

//       const { score: matchScore, breakdown } = RecommendationService.scoreSoloCandidate(
//         t,
//         {
//           genreScores: taste.genreScores,
//           favoriteGenres: taste.favoriteGenres,
//           subscribedServices: userSubscribedServices,
//           availableServices,
//         },
//         selectedMood,
//         maxRuntime
//       );

//       const reasons: string[] = [];
//       if (breakdown.genreMatch > 0) reasons.push('Matches your recent taste');
//       if (breakdown.moodTagMatch > 0) reasons.push(`Fits your "${selectedMood}" mood`);
//       if (breakdown.runtimeFit >= 1) reasons.push(`Fits your ${maxRuntime} min window`);
//       if (breakdown.ownedServiceBonus > 0) reasons.push('On a service you subscribe to');

//       scored.push({
//         id: t.id,
//         _id: t.id,
//         tmdbId: t.tmdbId,
//         name: t.name,
//         type: t.type,
//         releaseYear: t.releaseYear,
//         posterUrl: t.posterUrl,
//         backdropUrl: t.backdropUrl,
//         genres: t.genres || [],
//         runtimeMinutes: t.runtimeMinutes || 110,
//         voteAverage: t.voteAverage || 7.8,
//         synopsis: t.synopsis,
//         matchScore,
//         matchReason:
//           reasons.length > 0
//             ? `${rationalePrefix} • ${reasons.join(' • ')}`
//             : `${rationalePrefix} • Highly rated standout choice`,
//         streamingServices: availableServices.slice(0, 4),
//         scoreBreakdown: {
//           genreMatch: Math.round(breakdown.genreMatch * 100),
//           moodTagMatch: Math.round(breakdown.moodTagMatch * 100),
//           runtimeFit: Math.round(breakdown.runtimeFit * 100),
//           ownedServiceBonus: Math.round(breakdown.ownedServiceBonus * 100),
//         },
//       });
//     }

//     scored.sort((a, b) => b.matchScore - a.matchScore);

//     const shortlist = scored.slice(0, fatigueActive ? 3 : 6);

//     let recommendationSource: 'tmdb' | 'catalogue' = 'catalogue';
//     if (tmdbService.hasApiKey()) {
//       try {
//         const tmdbTitles = await tmdbService.discoverTitles({
//           type: requestedType || (type === 'film' || type === 'tv' ? type : undefined),
//           genres: isPromptSearch ? promptGenres : targetGenres,
//           keywords: targetKeywords,
//           query: isPromptSearch ? aiPrompt.trim() : undefined,
//           queries: isPromptSearch
//             ? targetKeywords.filter((keyword) => keyword.includes(' ')).sort((a, b) => b.length - a.length)
//             : undefined,
//           maxRuntime,
//         });
//         const localIds = new Set(shortlist.map((title) => title.tmdbId));
//         const tmdbShortlist = tmdbTitles
//           .filter(
//             (title) =>
//               !localIds.has(title.tmdbId) &&
//               matchesPromptSemantics(title, targetKeywords) &&
//               !RecommendationService.matchesHardExclusion(title, userExclusions)
//           )
//           .map((title) => {
//             const searchableText = [
//               title.name,
//               title.originalName,
//               title.synopsis,
//               ...title.genres,
//             ]
//               .filter(Boolean)
//               .join(' ')
//               .toLowerCase();
//             const keywordRelevance =
//               targetKeywords.length === 0
//                 ? 0
//                 : Math.min(
//                     1,
//                     targetKeywords.reduce((total, keyword) => {
//                       const normalized = keyword.toLowerCase().trim();
//                       if (!normalized) return total;
//                       const words = normalized.split(/\s+/).filter((word) => word.length > 3);
//                       if (words.length >= 2 && searchableText.includes(normalized)) return total + 0.75;
//                       if (searchableText.includes(normalized)) return total + 0.35;
//                       const matchedWords = words.filter((word) => searchableText.includes(word)).length;
//                       return total + (words.length > 1 ? 0.1 * (matchedWords / words.length) : 0);
//                     }, 0)
//                   );
//             const qualityScore = Math.min(1, Math.max(0, title.voteAverage / 10));
//             const { score: matchScore, breakdown } = RecommendationService.scoreSoloCandidate(
//               title,
//               {
//                 genreScores: taste.genreScores,
//                 favoriteGenres: taste.favoriteGenres,
//                 subscribedServices: userSubscribedServices,
//                 availableServices: [],
//               },
//               selectedMood,
//               maxRuntime
//             );
//             const balancedScore = Math.round(
//               (keywordRelevance * 0.5 + qualityScore * 0.2 + (matchScore / 100) * 0.3) * 100
//             );
//             return {
//               id: String(title.tmdbId),
//               _id: undefined,
//               tmdbId: title.tmdbId,
//               name: title.name,
//               type: title.type,
//               releaseYear: title.releaseYear,
//               posterUrl: title.posterUrl,
//               backdropUrl: title.backdropUrl,
//               genres: title.genres,
//               runtimeMinutes: title.runtimeMinutes,
//               voteAverage: title.voteAverage,
//               synopsis: title.synopsis,
//               matchScore: balancedScore,
//               matchReason: `${rationalePrefix} • ${
//                 keywordRelevance > 0 ? 'Theme relevance' : 'Quality and taste match'
//               } • TMDB discovery`,
//               streamingServices: [],
//               scoreBreakdown: {
//                 genreMatch: Math.round(breakdown.genreMatch * 100),
//                 moodTagMatch: Math.round(breakdown.moodTagMatch * 100),
//                 runtimeFit: Math.round(breakdown.runtimeFit * 100),
//                 ownedServiceBonus: 0,
//               },
//             };
//           })
//           .filter((title): title is NonNullable<typeof title> => title !== null);
//         tmdbShortlist.sort((a, b) => b.matchScore - a.matchScore);
//         if (tmdbShortlist.length > 0) {
//           recommendationSource = 'tmdb';
//           shortlist.splice(0, shortlist.length, ...tmdbShortlist.slice(0, fatigueActive ? 3 : 6));
//         } else if (isPromptSearch) {
//           // Do not present generic local/popular titles as if they matched a
//           // specific natural-language request.
//           shortlist.splice(0, shortlist.length);
//           recommendationSource = 'tmdb';
//         }
//       } catch (error: any) {
//         console.warn('[Recommendations] TMDB discovery failed; using catalogue:', error.message);
//         if (isPromptSearch) {
//           shortlist.splice(0, shortlist.length);
//           recommendationSource = 'tmdb';
//         }
//       }
//     }

//     sendSuccess(
//       res,
//       {
//         shortlist,
//         criteria: {
//           mood: selectedMood,
//           maxRuntime,
//           targetGenres,
//           targetKeywords,
//           requestedType,
//           fatigueActive,
//           rationaleSource,
//           recommendationSource,
//           queryDurationMs: Date.now() - startedAt,
//         },
//       },
//       'Solo recommendations generated successfully'
//     );
//   } catch (error: any) {
//     console.error('[Recommendations][solo] Recommendation generation failed:', error?.message || error);
//     next(error);
//   }
// };

// /**
//  * Break decision fatigue by collapsing the shortlist to one definitive pick.
//  * POST /api/recommendations/fatigue
//  */
// export const handleDecisionFatigue = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
//   try {
//     const userId = req.user?.id;

//     const taste = await RecommendationService.getTasteContext(userId);

//     const candidates = await prisma.title.findMany({
//       where: {
//         runtimeMinutes: { gte: 1, lte: 90 },
//       },
//       orderBy: { voteAverage: 'desc' },
//       take: 80,
//     });

//     const candidateIds = candidates.map((c) => c.id);
//     const providers = await prisma.watchProvider.findMany({
//       where: { titleId: { in: candidateIds } },
//     });
//     const providerMap = new Map<string, string[]>();
//     for (const p of providers) {
//       const key = p.titleId;
//       if (!providerMap.has(key)) providerMap.set(key, []);
//       if (!providerMap.get(key)!.includes(p.service)) providerMap.get(key)!.push(p.service);
//     }

//     let champion: any = null;
//     let championScore = -1;
//     for (const t of candidates) {
//       if (RecommendationService.matchesHardExclusion(t, taste.exclusions)) continue;

//       const { score } = RecommendationService.scoreSoloCandidate(
//         t,
//         {
//           genreScores: taste.genreScores,
//           favoriteGenres: taste.favoriteGenres,
//           subscribedServices: taste.subscribedServices,
//           availableServices: providerMap.get(t.id) || [],
//         },
//         'Comfort',
//         90
//       );
//       if (score > championScore) {
//         championScore = score;
//         champion = t;
//       }
//     }

//     const fatigueCount = userId
//       ? await RecommendationService.recordDecisionFatigue(userId)
//       : 1;

//     sendSuccess(
//       res,
//       {
//         championPick: champion
//           ? {
//               id: champion.id,
//               _id: champion.id,
//               tmdbId: champion.tmdbId,
//               name: champion.name,
//               type: champion.type,
//               releaseYear: champion.releaseYear,
//               posterUrl: champion.posterUrl,
//               backdropUrl: champion.backdropUrl,
//               synopsis: champion.synopsis,
//               genres: champion.genres || [],
//               runtimeMinutes: champion.runtimeMinutes,
//               voteAverage: champion.voteAverage,
//               matchScore: championScore,
//               streamingServices: (providerMap.get(champion.id) || []).slice(0, 4),
//             }
//           : null,
//         fatigueCount,
//         fatigued: RecommendationService.isFatigued(fatigueCount),
//         message: champion
//           ? 'Decisive single recommendation selected to break fatigue.'
//           : 'No eligible title found for a champion pick.',
//       },
//       'Decision fatigue resolved'
//     );
//   } catch (error: any) {
//     console.error('[Recommendations][fatigue] Decision-fatigue recommendation failed:', error?.message || error);
//     next(error);
//   }
// };


////////////////////////////////////////////////////////////////////////////////////////


import { Response, NextFunction } from 'express';
import prisma from '../config/prisma';
import { sendSuccess } from '../utils/response';
import { AiService } from '../services/ai.service';
import type { VibeParseResult, CandidateEvaluation, CandidateForEval } from '../services/ai.service';
import { RecommendationService } from '../services/recommendation.service';
import { tmdbService } from '../services/tmdb.service';
import type { IAuthRequest } from '../types';

const MOOD_GENRES: Record<string, string[]> = {
  Comfort: ['Comedy', 'Animation', 'Romance', 'Family', 'Adventure'],
  Gripping: ['Thriller', 'Crime', 'Action', 'Mystery', 'Drama'],
  'Mind-Bending': ['Science Fiction', 'Sci-Fi', 'Mystery', 'Thriller', 'Drama'],
  Fun: ['Comedy', 'Animation', 'Action', 'Adventure'],
  Stunning: ['Science Fiction', 'Sci-Fi', 'Adventure', 'Fantasy', 'Action', 'Drama'],
};

/** A candidate must be judged relevant AND score at least this to be eligible. */
const RELEVANCE_THRESHOLD = 60;
/** Cap per source so ONE batched Gemini call stays small and fast. */
const MAX_LOCAL_EVAL = 15;
const MAX_TMDB_EVAL = 40;
/** If fewer eligible titles than this and the runtime was a filter, retry without runtime. */
const MIN_ELIGIBLE_BEFORE_RELAXING = 2;

/**
 * REMOVED: matchesPromptSemantics().
 *
 * It was the main reason unrelated titles got through:
 *  - it only looked at multi-word keywords; with none, it returned TRUE for
 *    EVERY title (no validation at all);
 *  - it used plain substring matching ("teen" matched "nineteen");
 *  - "3 anchor words, 67% matched" was checked against junk keywords such as
 *    word trigrams from the prompt.
 * Relevance is now judged by AiService.evaluateCandidates() (Gemini, with a
 * conservative local validator as fallback).
 */

/** One shape for BOTH local-DB and TMDB titles so they go through the same pipeline. */
interface Candidate {
  /** Unique key, e.g. "tmdb:tv:1395" or "local:<dbId>". Used to de-duplicate. */
  key: string;
  source: 'local' | 'tmdb';
  /** Original object (Prisma Title or FormattedTmdbTitle) - passed to scoreSoloCandidate. */
  raw: any;
  dbId: string | null;
  tmdbId: number | null;
  name: string;
  type: 'film' | 'tv';
  releaseYear: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  genres: string[];
  runtimeMinutes: number | null;
  voteAverage: number;
  voteCount?: number;
  synopsis: string;
  streamingServices: string[];
}

/**
 * Rating shrinkage ("Bayesian average"). A 9.4 from 12 votes should not beat an
 * 8.2 from 20,000 votes. If vote count is unknown (local DB), use the plain rating.
 */
function bayesianQuality(rating: number, votes?: number): number {
  const priorMean = 6.5;
  const priorWeight = 200;
  if (!votes || votes <= 0) return Math.min(1, Math.max(0, rating / 10));
  const adjusted = (votes / (votes + priorWeight)) * rating + (priorWeight / (votes + priorWeight)) * priorMean;
  return Math.min(1, Math.max(0, adjusted / 10));
}

/**
 * Generate real tailored recommendations based on mood, available time, and taste profile
 * POST /api/recommendations/solo or GET /api/recommendations/solo
 *
 * NEW PIPELINE (was: local shortlist -> overwritten by TMDB shortlist):
 *   1. Understand the request        (Gemini -> local parser, same structure)
 *   2. Retrieve candidates           (local DB + TMDB, in parallel)
 *   3. Merge + de-duplicate
 *   4. Semantic relevance validation (ONE batched Gemini call -> local fallback)
 *   5. ELIGIBILITY gate              (type, relevance, exclusions) - hard pass/fail
 *   6. RANKING of eligible titles    (taste, mood, runtime, services, quality)
 */
export const getSoloRecommendation = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const startedAt = Date.now();
    const body = req.method === 'POST' ? req.body : req.query;
    const { mood = 'Gripping', duration, type, aiPrompt } = body;

    let selectedMood = String(mood);
    let targetGenres: string[] = MOOD_GENRES[selectedMood] || ['Drama', 'Thriller'];
    const hasDurationFilter = duration !== undefined && duration !== null && duration !== '';
    let maxRuntime = hasDurationFilter ? Number(duration) : 90;
    let runtimeIsExplicit = hasDurationFilter; // did the USER actually ask for a length?
    let rationalePrefix = `Selected for your "${mood}" mood`;
    let rationaleSource: 'gemini' | 'fallback' | 'none' = 'none';
    let intent: VibeParseResult | null = null;
    let userExclusions: string[] = [];
    let userSubscribedServices: string[] = [];

    const userId = req.user?.id;
    const promptText = typeof aiPrompt === 'string' ? aiPrompt.trim() : '';
    const isPromptSearch = promptText.length > 0;

    const taste = await RecommendationService.getTasteContext(userId);
    userExclusions = taste.exclusions;
    userSubscribedServices = taste.subscribedServices;

    let fatigueActive = false;
    if (userId) {
      const userDoc = await prisma.user.findUnique({
        where: { id: userId },
        select: { fatigueCount: true },
      });
      fatigueActive = RecommendationService.isFatigued(userDoc?.fatigueCount);
      if (fatigueActive) {
        maxRuntime = Math.min(maxRuntime, 100);
      }
    }

    /* ---------------------------- 1. understand ---------------------------- */
    if (isPromptSearch) {
      try {
        intent = await AiService.parseVibePrompt(promptText);
        // For a prompt search, genres are only SOFT hints (never a hard DB filter).
        targetGenres = intent.suggestedGenres;
        selectedMood = intent.mood || selectedMood;
        if (intent.maxRuntimeMinutes) {
          maxRuntime = intent.maxRuntimeMinutes;
          runtimeIsExplicit = true;
        }
        if (intent.rationale) rationalePrefix = intent.rationale;
        userExclusions = Array.from(new Set([...userExclusions, ...intent.exclusions]));
        rationaleSource = intent.source;
      } catch (error: any) {
        console.warn('[Recommendations][intent-extraction] failed:', error?.message || error);
      }
    } else if (taste.favoriteGenres.length > 0) {
      targetGenres = Array.from(new Set([...targetGenres, ...taste.favoriteGenres]));
    }

    // Explicit `type` param wins, otherwise the type found in the prompt.
    const effectiveType: 'film' | 'tv' | null =
      type === 'film' || type === 'tv' ? type : intent?.requestedType ?? null;

    // The old code ALWAYS applied a default 90 min cap, even to prompt searches
    // where the user never mentioned length. Now it is only a filter if the user asked for it.
    const initialRuntimeFilter: number | null = isPromptSearch && !runtimeIsExplicit ? null : maxRuntime;

    const retrievalTerms = intent
      ? Array.from(
          new Set(
            Object.values(intent.conceptEvidence)
              .flat()
              .filter((t) => t.length >= 4)
          )
        ).slice(0, 20)
      : [];

    // Only judge relevance when the prompt actually contains concepts to judge.
    // Vague prompts ("something fun") skip the AI call entirely: nothing to gate on.
    const needsRelevanceCheck = !!intent && intent.coreConcepts.length > 0;
    // Shared across pipeline passes so the relaxed re-run never calls Gemini twice
    // for the same title (before, a failing Gemini cost 10s per pass).
    const evalCache = new Map<string, CandidateEvaluation>();

    const scoringCtx = (availableServices: string[]) => ({
      genreScores: taste.genreScores,
      favoriteGenres: taste.favoriteGenres,
      subscribedServices: userSubscribedServices,
      availableServices,
    });

    /* ------------------------ the unified pipeline ------------------------- */
    const runPipeline = async (runtimeFilter: number | null) => {
      // ---------- 2a. retrieve LOCAL candidates ----------
      // Only TYPE (and an explicit runtime) are hard DB filters. Genre/keyword
      // conditions just help retrieval, and are relaxed one at a time below.
      const baseWhere: any = {};
      if (effectiveType) baseWhere.type = effectiveType;
      if (runtimeFilter && runtimeFilter > 0) {
        baseWhere.OR = [
          { runtimeMinutes: { lte: runtimeFilter } },
          { runtimeMinutes: null },
          { runtimeMinutes: 0 },
        ];
      }

      const softWhere: any = { ...baseWhere };
      if (isPromptSearch) {
        if (retrievalTerms.length > 0) {
          softWhere.AND = [
            {
              OR: retrievalTerms.flatMap((term) => [
                { name: { contains: term, mode: 'insensitive' } },
                { synopsis: { contains: term, mode: 'insensitive' } },
              ]),
            },
          ];
        }
      } else if (targetGenres.length > 0) {
        softWhere.genres = { hasSome: targetGenres };
      }

      const take = fatigueActive ? 40 : 80;
      const order = [{ voteAverage: 'desc' as const }, { releaseYear: 'desc' as const }];
      let localRows = await prisma.title.findMany({ where: softWhere, orderBy: order, take });

      // Relax ONLY the soft retrieval hints (genre/keyword matching). The required
      // type is kept, and the semantic validator below still gates every title,
      // so this can never let an unrelated popular title through.
      if (localRows.length === 0 && (softWhere.AND || softWhere.genres)) {
        localRows = await prisma.title.findMany({ where: baseWhere, orderBy: order, take });
      }

      const providers = await prisma.watchProvider.findMany({
        where: { titleId: { in: localRows.map((t) => t.id) } },
      });
      const providerMap = new Map<string, string[]>();
      for (const p of providers) {
        if (!providerMap.has(p.titleId)) providerMap.set(p.titleId, []);
        if (!providerMap.get(p.titleId)!.includes(p.service)) providerMap.get(p.titleId)!.push(p.service);
      }

      const localCandidates: Candidate[] = localRows.map((t: any) => ({
        key: t.tmdbId ? `tmdb:${t.type}:${t.tmdbId}` : `local:${t.id}`,
        source: 'local' as const,
        raw: t,
        dbId: t.id,
        tmdbId: t.tmdbId ?? null,
        name: t.name,
        type: t.type,
        releaseYear: t.releaseYear ?? null,
        posterUrl: t.posterUrl ?? null,
        backdropUrl: t.backdropUrl ?? null,
        genres: t.genres || [],
        runtimeMinutes: t.runtimeMinutes ?? null,
        voteAverage: t.voteAverage || 0,
        voteCount: t.voteCount ?? undefined,
        synopsis: t.synopsis || '',
        streamingServices: (providerMap.get(t.id) || []).slice(0, 4),
      }));

      // ---------- 2b. retrieve TMDB candidates ----------
      let tmdbCandidates: Candidate[] = [];
      if (tmdbService.hasApiKey()) {
        try {
          const concepts = intent ? [...intent.coreConcepts, ...intent.preferredThemes, ...intent.targetKeywords] : [];
          const tmdbTitles = await tmdbService.discoverTitles({
            type: effectiveType ?? undefined,
            genres: targetGenres,
            keywords: concepts,
            // One search group PER required concept (setting, subject...). Each is retrieved
            // separately, and titles found by several groups rank first.
            keywordGroups: intent
              ? intent.coreConcepts.map((concept) =>
                  (intent!.conceptEvidence[concept.toLowerCase()] ?? [concept]).filter((t) => t.length >= 4).slice(0, 6)
                )
              : undefined,
            query: isPromptSearch ? promptText : undefined,
            queries: intent ? intent.coreConcepts.filter((c) => c.includes(' ')) : undefined,
            maxRuntime: runtimeFilter ?? undefined,
            limit: MAX_TMDB_EVAL,
          });
          tmdbCandidates = tmdbTitles.map((t) => ({
            key: `tmdb:${t.type}:${t.tmdbId}`,
            source: 'tmdb' as const,
            raw: t,
            dbId: null,
            tmdbId: t.tmdbId,
            name: t.name,
            type: t.type,
            releaseYear: t.releaseYear,
            posterUrl: t.posterUrl,
            backdropUrl: t.backdropUrl,
            genres: t.genres,
            runtimeMinutes: t.runtimeMinutes,
            voteAverage: t.voteAverage,
            voteCount: t.voteCount,
            synopsis: t.synopsis,
            streamingServices: [],
          }));
        } catch (error: any) {
          // Old code wiped the whole shortlist here on prompt searches. Local
          // candidates are validated like everything else, so just carry on.
          console.warn('[Recommendations] TMDB discovery failed; continuing with catalogue:', error?.message || error);
        }
      }

      // ---------- 3. merge + de-duplicate (local wins: it has streaming info) ----------
      const merged = new Map<string, Candidate>();
      for (const c of [...localCandidates.slice(0, MAX_LOCAL_EVAL), ...tmdbCandidates]) {
        if (!merged.has(c.key)) merged.set(c.key, c);
      }
      // Local titles beyond the evaluation cap are only used for non-prompt searches.
      const pool: Candidate[] = isPromptSearch
        ? Array.from(merged.values())
        : Array.from(new Map([...localCandidates, ...tmdbCandidates].map((c) => [c.key, c] as const)).values());

      // ---------- 5a. cheap hard filters (no AI needed) ----------
      const preFiltered = pool.filter((c) => {
        if (effectiveType && c.type !== effectiveType) return false;
        if (RecommendationService.matchesHardExclusion(c.raw, userExclusions)) return false;
        return true;
      });

      // ---------- 4. semantic relevance validation (prompt searches only) ----------
      if (needsRelevanceCheck && intent) {
        const evalInput: CandidateForEval[] = preFiltered
          .filter((c) => !evalCache.has(c.key)) // only titles not judged yet
          .map((c) => ({
            id: c.key,
            name: c.name,
            type: c.type,
            releaseYear: c.releaseYear,
            genres: c.genres,
            synopsis: c.synopsis,
          }));
        if (evalInput.length > 0) {
          const fresh = await AiService.evaluateCandidates(intent, evalInput);
          fresh.forEach((value, key) => evalCache.set(key, value));
        }
      }
      const evaluations = evalCache;

      // ---------- 5b. ELIGIBILITY gate. A high rating can NEVER buy its way past this. ----------
      const eligible = preFiltered.filter((c) => {
        if (!needsRelevanceCheck) return true; // nothing specific requested => type/exclusions only
        const ev = evaluations.get(c.key);
        return !!ev && ev.relevant && ev.relevanceScore >= RELEVANCE_THRESHOLD;
      });

      for (const c of preFiltered) {
        if (!eligible.includes(c) && isPromptSearch) {
          const ev = evaluations.get(c.key);
          console.info(
            `[Recommendations][eligibility] Rejected "${c.name}" (${c.source}): ${ev?.explanation || 'not evaluated'}`
          );
        }
      }

      // ---------- 6. RANK eligible titles only ----------
      const ranked = eligible.map((c) => {
        const { score: tasteScore, breakdown } = RecommendationService.scoreSoloCandidate(
          c.raw,
          scoringCtx(c.streamingServices),
          selectedMood,
          maxRuntime
        );
        const ev = evaluations.get(c.key);
        const quality = bayesianQuality(c.voteAverage, c.voteCount);

        // Prompt searches: relevance is a (smaller) ranking signal among already-eligible titles.
        // Mood-only searches keep the original behaviour (taste score only).
        const matchScore =
          isPromptSearch && ev
            ? Math.round((0.5 * (tasteScore / 100) + 0.2 * quality + 0.3 * (ev.relevanceScore / 100)) * 100)
            : tasteScore;

        const reasons: string[] = [];
        if (ev?.matchedConcepts?.length) reasons.push(`Matches: ${ev.matchedConcepts.slice(0, 3).join(', ')}`);
        if (breakdown.genreMatch > 0) reasons.push('Matches your recent taste');
        if (breakdown.moodTagMatch > 0) reasons.push(`Fits your "${selectedMood}" mood`);
        if (breakdown.runtimeFit >= 1 && c.runtimeMinutes) reasons.push(`Fits your ${maxRuntime} min window`);
        if (breakdown.ownedServiceBonus > 0) reasons.push('On a service you subscribe to');

        return {
          id: c.dbId ?? String(c.tmdbId),
          _id: c.dbId ?? undefined,
          tmdbId: c.tmdbId,
          name: c.name,
          type: c.type,
          releaseYear: c.releaseYear,
          posterUrl: c.posterUrl,
          backdropUrl: c.backdropUrl,
          genres: c.genres,
          runtimeMinutes: c.runtimeMinutes || (c.source === 'local' ? 110 : 0),
          voteAverage: c.voteAverage || (c.source === 'local' ? 7.8 : 0),
          synopsis: c.synopsis,
          matchScore,
          matchReason:
            reasons.length > 0
              ? `${rationalePrefix} • ${reasons.join(' • ')}`
              : `${rationalePrefix} • Highly rated standout choice`,
          streamingServices: c.streamingServices,
          source: c.source,
          relevanceScore: ev?.relevanceScore,
          matchedConcepts: ev?.matchedConcepts,
          scoreBreakdown: {
            genreMatch: Math.round(breakdown.genreMatch * 100),
            moodTagMatch: Math.round(breakdown.moodTagMatch * 100),
            runtimeFit: Math.round(breakdown.runtimeFit * 100),
            ownedServiceBonus: Math.round(breakdown.ownedServiceBonus * 100),
          },
        };
      });
      ranked.sort((a, b) => b.matchScore - a.matchScore);

      return {
        ranked,
        retrieved: pool.length,
        rejected: preFiltered.length - eligible.length,
      };
    };

    let pipelineResult = await runPipeline(initialRuntimeFilter);
    const relaxed: string[] = [];

    // Gradual relaxation: an explicit runtime is a PREFERENCE, so it may be dropped
    // when almost nothing qualifies. Type, subject and setting are never dropped.
    if (
      isPromptSearch &&
      initialRuntimeFilter !== null &&
      pipelineResult.ranked.length < MIN_ELIGIBLE_BEFORE_RELAXING
    ) {
      const retry = await runPipeline(null);
      if (retry.ranked.length > pipelineResult.ranked.length) {
        pipelineResult = retry;
        relaxed.push('runtime');
      }
    }

    // Return FEWER (even zero) results instead of padding with unrelated popular titles.
    const shortlist = pipelineResult.ranked.slice(0, fatigueActive ? 3 : 6);

    const sources = new Set(shortlist.map((s) => s.source));
    const recommendationSource: 'tmdb' | 'catalogue' | 'mixed' =
      sources.size > 1 ? 'mixed' : sources.has('tmdb') ? 'tmdb' : 'catalogue';

    sendSuccess(
      res,
      {
        shortlist,
        criteria: {
          mood: selectedMood,
          maxRuntime,
          targetGenres,
          targetKeywords: intent?.targetKeywords || [],
          coreConcepts: intent?.coreConcepts || [],
          requestedType: effectiveType,
          fatigueActive,
          rationaleSource,
          recommendationSource,
          // Lets the UI tell "empty" apart from "relaxed".
          relaxedFilters: relaxed,
          candidatesRetrieved: pipelineResult.retrieved,
          candidatesRejected: pipelineResult.rejected,
          emptyReason:
            shortlist.length === 0 && isPromptSearch
              ? 'No titles matched the core of your request. Try rephrasing or loosening the setting/subject.'
              : null,
          queryDurationMs: Date.now() - startedAt,
        },
      },
      'Solo recommendations generated successfully'
    );
  } catch (error: any) {
    console.error('[Recommendations][solo] Recommendation generation failed:', error?.message || error);
    next(error);
  }
};

/**
 * Break decision fatigue by collapsing the shortlist to one definitive pick.
 * POST /api/recommendations/fatigue
 * (unchanged)
 */
export const handleDecisionFatigue = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;

    const taste = await RecommendationService.getTasteContext(userId);

    const candidates = await prisma.title.findMany({
      where: {
        runtimeMinutes: { gte: 1, lte: 90 },
      },
      orderBy: { voteAverage: 'desc' },
      take: 80,
    });

    const candidateIds = candidates.map((c) => c.id);
    const providers = await prisma.watchProvider.findMany({
      where: { titleId: { in: candidateIds } },
    });
    const providerMap = new Map<string, string[]>();
    for (const p of providers) {
      const key = p.titleId;
      if (!providerMap.has(key)) providerMap.set(key, []);
      if (!providerMap.get(key)!.includes(p.service)) providerMap.get(key)!.push(p.service);
    }

    let champion: any = null;
    let championScore = -1;
    for (const t of candidates) {
      if (RecommendationService.matchesHardExclusion(t, taste.exclusions)) continue;

      const { score } = RecommendationService.scoreSoloCandidate(
        t,
        {
          genreScores: taste.genreScores,
          favoriteGenres: taste.favoriteGenres,
          subscribedServices: taste.subscribedServices,
          availableServices: providerMap.get(t.id) || [],
        },
        'Comfort',
        90
      );
      if (score > championScore) {
        championScore = score;
        champion = t;
      }
    }

    const fatigueCount = userId
      ? await RecommendationService.recordDecisionFatigue(userId)
      : 1;

    sendSuccess(
      res,
      {
        championPick: champion
          ? {
              id: champion.id,
              _id: champion.id,
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
              streamingServices: (providerMap.get(champion.id) || []).slice(0, 4),
            }
          : null,
        fatigueCount,
        fatigued: RecommendationService.isFatigued(fatigueCount),
        message: champion
          ? 'Decisive single recommendation selected to break fatigue.'
          : 'No eligible title found for a champion pick.',
      },
      'Decision fatigue resolved'
    );
  } catch (error: any) {
    console.error('[Recommendations][fatigue] Decision-fatigue recommendation failed:', error?.message || error);
    next(error);
  }
};