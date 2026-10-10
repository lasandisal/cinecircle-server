import { Request, Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import { Session, Title, User, Vote } from '../models';
import { AppError } from '../middleware/error.middleware';
import { sendSuccess } from '../utils/response';
import { tmdbService } from '../services/TmdbService';

/**
 * Generate a unique 6-character room code (e.g., SCI890)
 */
function generateJoinCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

/**
 * Helper to fetch, sanitize, and populate a session with deduplicated participants
 */
async function getPopulatedSession(sessionId: any) {
  const sessionDoc = await Session.findById(sessionId);
  if (!sessionDoc) return null;

  // Clean duplicate ObjectIds in DB if any exist
  const uniqueParticipantIds = Array.from(
    new Set(sessionDoc.participants.map((p: any) => p.toString()))
  );
  if (uniqueParticipantIds.length !== sessionDoc.participants.length) {
    sessionDoc.participants = uniqueParticipantIds as any;
    await sessionDoc.save();
  }

  const populated = await Session.findById(sessionId)
    .populate('host', 'name email avatar')
    .populate('participants', 'name email avatar')
    .populate('shortlist', 'name posterUrl backdropUrl releaseYear type genres runtimeMinutes voteAverage overview synopsis')
    .populate('finalPick', 'name posterUrl backdropUrl releaseYear type genres runtimeMinutes voteAverage overview synopsis')
    .lean();

  if (populated?.participants) {
    const seen = new Set<string>();
    populated.participants = populated.participants.filter((p: any) => {
      const pid = (p?._id || p)?.toString();
      if (!pid || seen.has(pid)) return false;
      seen.add(pid);
      return true;
    });
  }

  return populated;
}

/**
 * Create a new group decision room with real shortlist candidates
 * POST /api/sessions/create
 */
export const createSession = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { name, maxRuntime, moodFilter, shortlistTitleIds } = req.body;

    let candidateIds = Array.isArray(shortlistTitleIds) && shortlistTitleIds.length > 0 ? shortlistTitleIds : [];

    // If no candidate titles were selected, automatically seed with 3-4 top real titles from MongoDB
    if (candidateIds.length === 0) {
      const titles = await Title.find().sort({ voteAverage: -1 }).limit(4).select('_id').lean();
      candidateIds = titles.map((t) => t._id);
    }

    // Generate unique join code
    let joinCode = generateJoinCode();
    let collision = await Session.findOne({ joinCode });
    while (collision) {
      joinCode = generateJoinCode();
      collision = await Session.findOne({ joinCode });
    }

    const session = await Session.create({
      name: name?.trim() || 'Watch Decision Party',
      host: userId,
      joinCode,
      participants: [userId],
      constraints: {
        maxRuntime: maxRuntime ? Number(maxRuntime) : undefined,
        moodFilter: moodFilter?.trim() || undefined,
      },
      shortlist: candidateIds,
      status: 'open',
      createdAt: new Date(),
    });

    const populatedSession = await getPopulatedSession(session._id);

    sendSuccess(res, { session: populatedSession, joinCode }, 'Group session created successfully', 201);
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve all currently active open sessions (for circles carousel)
 * GET /api/sessions/active
 */
export const getActiveSessions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const sessions = await Session.find({ status: 'open' })
      .populate('host', 'name email avatar')
      .populate('participants', 'name email avatar')
      .populate('shortlist', 'name posterUrl backdropUrl releaseYear type genres runtimeMinutes voteAverage overview synopsis')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    // Deduplicate participants in active sessions
    const sanitized = sessions.map((s) => {
      if (s.participants) {
        const seen = new Set<string>();
        s.participants = s.participants.filter((p: any) => {
          const pid = (p?._id || p)?.toString();
          if (!pid || seen.has(pid)) return false;
          seen.add(pid);
          return true;
        });
      }
      return s;
    });

    sendSuccess(res, { sessions: sanitized }, 'Active sessions retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Get single session by joinCode
 * GET /api/sessions/code/:joinCode
 */
export const getSessionByCode = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { joinCode } = req.params;
    const cleanCode = String(joinCode || '').toUpperCase().trim();

    const sessionDoc = await Session.findOne({ joinCode: cleanCode });
    if (!sessionDoc) {
      return next(new AppError('Session room not found with code ' + cleanCode, 404));
    }

    const populatedSession = await getPopulatedSession(sessionDoc._id);

    // Also get all votes for this session
    const votes = await Vote.find({ session: sessionDoc._id })
      .populate('user', 'name')
      .lean();

    sendSuccess(res, { session: populatedSession, votes }, 'Session retrieved successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Join an existing watch decision session (Atomic $addToSet prevents duplicates)
 * POST /api/sessions/join
 */
export const joinSession = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { joinCode } = req.body;
    if (!joinCode) {
      return next(new AppError('joinCode is required', 400));
    }

    const cleanCode = joinCode.toUpperCase().trim();

    // Atomic $addToSet guarantees an ID can NEVER be added more than once
    const session = await Session.findOneAndUpdate(
      { joinCode: cleanCode },
      { $addToSet: { participants: userId } },
      { new: true }
    );

    if (!session) {
      return next(new AppError(`No active session found with code ${cleanCode}`, 404));
    }

    const populatedSession = await getPopulatedSession(session._id);

    const votes = await Vote.find({ session: session._id })
      .populate('user', 'name')
      .lean();

    sendSuccess(res, { session: populatedSession, votes }, 'Joined session successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Add a title (movie/show) to the candidate shortlist of an active session
 * POST /api/sessions/:sessionId/shortlist
 */
export const addTitleToShortlist = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { sessionId } = req.params;
    const { titleId, tmdbId, type, titleData } = req.body;

    const session = await Session.findById(sessionId);
    if (!session) {
      return next(new AppError('Session room not found', 404));
    }

    if (session.status !== 'open') {
      return next(new AppError('Cannot add titles to a closed/finalized session', 400));
    }

    let finalTitleId = titleId;

    // 1. If tmdbId is provided, find or create title in MongoDB
    if (!finalTitleId && tmdbId) {
      let titleDoc = await Title.findOne({ tmdbId: Number(tmdbId) });
      if (!titleDoc) {
        if (titleData) {
          titleDoc = await Title.create({
            name: titleData.name || titleData.title,
            originalName: titleData.originalName,
            type: titleData.type || (type === 'tv' ? 'tv' : 'film'),
            tmdbId: Number(tmdbId),
            releaseYear: titleData.releaseYear,
            runtimeMinutes: titleData.runtimeMinutes,
            genres: titleData.genres || [],
            overview: titleData.overview || titleData.synopsis,
            synopsis: titleData.synopsis || titleData.overview,
            posterUrl: titleData.posterUrl,
            backdropUrl: titleData.backdropUrl,
            voteAverage: titleData.voteAverage || 7.5,
            voteCount: titleData.voteCount || 100,
          });
        } else if (tmdbService.hasApiKey()) {
          const mediaType: 'tv' | 'film' = type === 'tv' ? 'tv' : 'film';
          const details = await tmdbService.fetchDetails(Number(tmdbId), mediaType);
          if (details) {
            titleDoc = await Title.create({
              name: details.name,
              originalName: details.originalName,
              type: details.type,
              tmdbId: details.tmdbId,
              releaseYear: details.releaseYear,
              runtimeMinutes: details.runtimeMinutes,
              genres: details.genres,
              overview: details.synopsis,
              synopsis: details.synopsis,
              posterUrl: details.posterUrl,
              backdropUrl: details.backdropUrl,
              voteAverage: details.voteAverage,
              moodTags: details.moodTags || [],
            });
          }
        }
      }
      if (titleDoc) {
        finalTitleId = titleDoc._id;
      }
    } else if (finalTitleId) {
      // If finalTitleId is not a MongoDB ObjectId (e.g. numeric ID or tmdbId string)
      if (
        typeof finalTitleId === 'number' ||
        (!finalTitleId.toString().match(/^[0-9a-fA-F]{24}$/) && !isNaN(Number(finalTitleId)))
      ) {
        let titleDoc = await Title.findOne({ tmdbId: Number(finalTitleId) });
        if (!titleDoc && titleData) {
          titleDoc = await Title.create({
            name: titleData.name || titleData.title,
            type: titleData.type || 'film',
            tmdbId: Number(finalTitleId),
            releaseYear: titleData.releaseYear,
            runtimeMinutes: titleData.runtimeMinutes,
            genres: titleData.genres || [],
            overview: titleData.overview,
            posterUrl: titleData.posterUrl,
            backdropUrl: titleData.backdropUrl,
            voteAverage: titleData.voteAverage || 7.5,
          });
        }
        if (titleDoc) {
          finalTitleId = titleDoc._id;
        }
      }
    }

    if (!finalTitleId) {
      return next(new AppError('Valid titleId or tmdbId is required', 400));
    }

    // Atomic $addToSet for shortlist items as well
    await Session.findByIdAndUpdate(sessionId, {
      $addToSet: { shortlist: finalTitleId },
    });

    const populatedSession = await getPopulatedSession(sessionId);

    const votes = await Vote.find({ session: sessionId })
      .populate('user', 'name')
      .lean();

    sendSuccess(res, { session: populatedSession, votes }, 'Title added to session shortlist successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Remove a title from the candidate shortlist
 * DELETE /api/sessions/:sessionId/shortlist/:titleId
 */
export const removeTitleFromShortlist = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { sessionId, titleId } = req.params;
    const session = await Session.findById(sessionId);
    if (!session) {
      return next(new AppError('Session room not found', 404));
    }

    if (session.status !== 'open') {
      return next(new AppError('Cannot modify a closed session', 400));
    }

    await Session.findByIdAndUpdate(sessionId, {
      $pull: { shortlist: titleId },
    });

    const populatedSession = await getPopulatedSession(sessionId);

    sendSuccess(res, { session: populatedSession }, 'Title removed from shortlist');
  } catch (error) {
    next(error);
  }
};

/**
 * Submit vote reaction for a candidate title in a session
 * POST /api/sessions/:sessionId/vote
 */
export const submitVote = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { sessionId } = req.params;
    const { titleId, reaction = 'yes', strength = 3 } = req.body;

    if (!titleId) {
      return next(new AppError('titleId is required to vote', 400));
    }

    const vote = await Vote.findOneAndUpdate(
      { session: sessionId, user: userId, title: titleId },
      {
        session: sessionId,
        user: userId,
        title: titleId,
        reaction: reaction === 'no' ? 'no' : 'yes',
        strength: Math.min(5, Math.max(1, Number(strength) || 3)),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    sendSuccess(res, { vote }, 'Vote recorded successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Lock session and finalize winning title
 * POST /api/sessions/:sessionId/lock
 */
export const lockSessionPick = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { sessionId } = req.params;
    const session = await Session.findById(sessionId);

    if (!session) {
      return next(new AppError('Session not found', 404));
    }

    // Only host can lock session
    if (session.host.toString() !== userId.toString()) {
      return next(new AppError('Only the room host can finalize the decision pick', 403));
    }

    // Tally votes for each candidate in shortlist
    const votes = await Vote.find({ session: sessionId }).lean();
    const scores: Record<string, number> = {};

    session.shortlist.forEach((tId) => {
      scores[tId.toString()] = 0;
    });

    votes.forEach((v) => {
      const tKey = v.title.toString();
      if (scores[tKey] !== undefined) {
        if (v.reaction === 'yes') {
          scores[tKey] += v.strength || 3;
        } else {
          scores[tKey] -= v.strength || 2;
        }
      }
    });

    // Find highest score candidate
    let winnerId = session.shortlist[0];
    let maxScore = -Infinity;
    for (const [tId, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        winnerId = tId as any;
      }
    }

    session.finalPick = winnerId;
    session.status = 'closed';
    await session.save();

    const finalizedSession = await getPopulatedSession(sessionId);

    sendSuccess(res, { session: finalizedSession, winnerId }, 'Session decision finalized successfully');
  } catch (error) {
    next(error);
  }
};
