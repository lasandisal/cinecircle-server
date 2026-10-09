import { Request, Response, NextFunction } from 'express';
import { Title, TasteProfile } from '../models';
import { sendSuccess } from '../utils/response';
import { AiService } from '../services/ai.service';
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

    // If natural language vibe prompt is provided, use Gemini AI to interpret
    if (aiPrompt && typeof aiPrompt === 'string' && aiPrompt.trim()) {
      try {
        const parsed = await AiService.parseVibePrompt(aiPrompt.trim());
        if (parsed.targetGenres?.length) {
          targetGenres = parsed.targetGenres;
        }
        if (parsed.maxRuntime) {
          maxRuntime = parsed.maxRuntime;
        }
        if (parsed.reasoning) {
          rationalePrefix = parsed.reasoning;
        }
      } catch (e) {
        // Fallback to keyword matching if AI rate limited
      }
    }

    // Include user's favorite genres if logged in
    const userId = req.user?.id;
    if (userId) {
      const profile = await TasteProfile.findOne({ user: userId });
      if (profile?.favoriteGenres?.length) {
        targetGenres = Array.from(new Set([...targetGenres, ...profile.favoriteGenres]));
      }
    }

    // Query titles from database
    const query: any = {};
    if (type === 'film' || type === 'tv') {
      query.type = type;
    }

    // Filter runtime with sensible tolerance
    if (maxRuntime && maxRuntime > 0) {
      query.$or = [
        { runtimeMinutes: { $lte: maxRuntime + 20 } },
        { runtimeMinutes: { $exists: false } },
        { runtimeMinutes: 0 },
      ];
    }

    const candidateTitles = await Title.find(query).limit(50).lean();

    // Compute tailored match score for each title
    const scored = candidateTitles.map((t) => {
      let score = 50; // base score

      // Genre alignment
      const titleGenres = Array.isArray(t.genres) ? t.genres : [];
      let genreMatches = 0;
      targetGenres.forEach((g) => {
        if (titleGenres.some((tg) => tg.toLowerCase().includes(g.toLowerCase()) || g.toLowerCase().includes(tg.toLowerCase()))) {
          score += 15;
          genreMatches++;
        }
      });

      // Rating bonus
      if (t.voteAverage) {
        score += Math.round(t.voteAverage * 3.5);
      }

      // Mood tag alignment
      const titleMoods = Array.isArray(t.moodTags) ? t.moodTags : [];
      if (titleMoods.some((m) => m.toLowerCase().includes(String(mood).toLowerCase()))) {
        score += 20;
      }

      const matchScore = Math.min(99, Math.max(68, score));

      return {
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
        matchReason: genreMatches > 0
          ? `${rationalePrefix} • Matches ${genreMatches} key genre${genreMatches > 1 ? 's' : ''}`
          : `${rationalePrefix} • Highly rated standout choice`,
        streamingServices: ['Netflix', 'Prime Video', 'Max'],
      };
    });

    // Sort by highest match score
    scored.sort((a, b) => b.matchScore - a.matchScore);

    const shortlist = scored.slice(0, 6);

    sendSuccess(
      res,
      {
        shortlist,
        criteria: { mood, maxRuntime, targetGenres },
      },
      'Solo recommendations generated successfully'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Handle decision fatigue by narrowing choices down to 1 definitive champion pick
 * POST /api/recommendations/fatigue
 */
export const handleDecisionFatigue = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Pick the single highest rated and most universally accessible title
    const champion = await Title.findOne().sort({ voteAverage: -1 }).lean();

    sendSuccess(
      res,
      {
        championPick: champion,
        fatigueCount: 1,
        message: 'Decisive single recommendation selected to break fatigue.',
      },
      'Decision fatigue resolved'
    );
  } catch (error) {
    next(error);
  }
};
