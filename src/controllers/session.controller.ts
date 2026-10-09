import { Request, Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import { Session, Title, User, Vote } from '../models';
import { AppError } from '../middleware/error.middleware';
import { sendSuccess } from '../utils/response';

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

    const populatedSession = await Session.findById(session._id)
      .populate('host', 'name email avatar')
      .populate('participants', 'name email avatar')
      .populate('shortlist', 'name posterUrl releaseYear type genres runtimeMinutes voteAverage overview')
      .lean();

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
      .populate('shortlist', 'name posterUrl releaseYear type genres runtimeMinutes voteAverage')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean();

    sendSuccess(res, { sessions }, 'Active sessions retrieved');
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
    const cleanCode = (joinCode || '').toUpperCase().trim();

    const session = await Session.findOne({ joinCode: cleanCode })
      .populate('host', 'name email avatar')
      .populate('participants', 'name email avatar')
      .populate('shortlist', 'name posterUrl releaseYear type genres runtimeMinutes voteAverage overview')
      .populate('finalPick', 'name posterUrl releaseYear type genres runtimeMinutes voteAverage overview')
      .lean();

    if (!session) {
      return next(new AppError('Session room not found with code ' + cleanCode, 404));
    }

    // Also get all votes for this session
    const votes = await Vote.find({ session: session._id })
      .populate('user', 'name')
      .lean();

    sendSuccess(res, { session, votes }, 'Session retrieved successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Join an existing watch decision session
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
    const session = await Session.findOne({ joinCode: cleanCode });

    if (!session) {
      return next(new AppError(`No active session found with code ${cleanCode}`, 404));
    }

    // Add user to participants array if not already present
    const isParticipant = session.participants.some((p: any) => p.toString() === userId.toString());
    if (!isParticipant) {
      session.participants.push(userId as any);
      await session.save();
    }

    const populatedSession = await Session.findById(session._id)
      .populate('host', 'name email avatar')
      .populate('participants', 'name email avatar')
      .populate('shortlist', 'name posterUrl releaseYear type genres runtimeMinutes voteAverage overview')
      .populate('finalPick', 'name posterUrl releaseYear type genres runtimeMinutes voteAverage overview')
      .lean();

    sendSuccess(res, { session: populatedSession }, 'Joined session successfully');
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

    const finalizedSession = await Session.findById(sessionId)
      .populate('host', 'name email avatar')
      .populate('participants', 'name email avatar')
      .populate('shortlist', 'name posterUrl releaseYear type genres runtimeMinutes voteAverage overview')
      .populate('finalPick', 'name posterUrl releaseYear type genres runtimeMinutes voteAverage overview')
      .lean();

    sendSuccess(res, { session: finalizedSession, winnerId }, 'Session decision finalized successfully');
  } catch (error) {
    next(error);
  }
};
