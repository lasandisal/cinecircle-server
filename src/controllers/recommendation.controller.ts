import { Request, Response, NextFunction } from 'express';
import prisma from '../config/prisma';
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
    let rationaleSource: 'gemini' | 'fallback' | 'none' = 'none';
    let userExclusions: string[] = [];
    let userSubscribedServices: string[] = [];

    const userId = req.user?.id;

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
        // Fallback
      }
    }

    if (taste.favoriteGenres.length > 0) {
      targetGenres = Array.from(new Set([...targetGenres, ...taste.favoriteGenres]));
    }

    const where: any = {};
    if (type === 'film' || type === 'tv') {
      where.type = type;
    }

    if (maxRuntime && maxRuntime > 0) {
      where.OR = [
        { runtimeMinutes: { lte: maxRuntime } },
        { runtimeMinutes: null },
        { runtimeMinutes: 0 },
      ];
    }

    const candidateTitles = await prisma.title.findMany({
      where,
      orderBy: [{ voteAverage: 'desc' }, { releaseYear: 'desc' }],
      take: fatigueActive ? 40 : 80,
    });
    const candidateIds = candidateTitles.map((t) => t.id);

    const providers = await prisma.watchProvider.findMany({
      where: { titleId: { in: candidateIds } },
    });
    const providerMap = new Map<string, string[]>();
    for (const p of providers) {
      const key = p.titleId;
      if (!providerMap.has(key)) providerMap.set(key, []);
      if (!providerMap.get(key)!.includes(p.service)) {
        providerMap.get(key)!.push(p.service);
      }
    }

    const scored: any[] = [];

    for (const t of candidateTitles) {
      if (RecommendationService.matchesHardExclusion(t, userExclusions)) continue;

      const availableServices = providerMap.get(t.id) || [];

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
        id: t.id,
        _id: t.id,
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
  } catch (error) {
    next(error);
  }
};
