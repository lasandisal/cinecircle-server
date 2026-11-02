import { Request, Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import prisma from '../config/prisma';
import { AppError } from '../middleware/error.middleware';
import { sendSuccess } from '../utils/response';
import { tmdbService } from '../services/TmdbService';
import { SessionService, SessionServiceError } from '../services/session.service';
import { SocketService } from '../services/socket.service';

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
 * Helper to fetch, sanitize, and populate a session
 */
async function getPopulatedSession(sessionId: string) {
  if (!sessionId) return null;

  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: {
      creator: { select: { id: true, name: true, email: true, avatar: true } },
      participants: { select: { id: true, name: true, email: true, avatar: true } },
    },
  });

  if (!session) return null;

  const shortlist = session.shortlistIds && session.shortlistIds.length > 0
    ? await prisma.title.findMany({
        where: { id: { in: session.shortlistIds } },
      })
    : [];

  const finalPick = session.finalPickId
    ? await prisma.title.findUnique({ where: { id: session.finalPickId } })
    : null;

  return {
    ...session,
    _id: session.id,
    host: session.creator ? { ...session.creator, _id: session.creator.id } : null,
    participants: session.participants.map((p) => ({ ...p, _id: p.id })),
    shortlist: shortlist.map((t) => ({ ...t, _id: t.id })),
    finalPick: finalPick ? { ...finalPick, _id: finalPick.id } : null,
  };
}

function sanitizePeople(doc: any): any {
  if (!doc) return doc;
  const { email, passwordHash, subscribedServices, tasteProfile, fatigueCount, ...safe } = doc;
  return safe;
}

function sanitizeSessionPeople(session: any): any {
  if (!session) return session;
  if (session.host) session.host = sanitizePeople(session.host);
  if (Array.isArray(session.participants)) {
    session.participants = session.participants.map(sanitizePeople);
  }
  return session;
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

    let candidateIds: string[] = Array.isArray(shortlistTitleIds) && shortlistTitleIds.length > 0 ? shortlistTitleIds : [];

    // If no candidate titles were selected, automatically seed with 4 top real titles from PostgreSQL
    if (candidateIds.length === 0) {
      const titles = await prisma.title.findMany({
        orderBy: { voteAverage: 'desc' },
        take: 4,
        select: { id: true },
      });
      candidateIds = titles.map((t) => t.id);
    }

    // Generate unique join code
    let joinCode = generateJoinCode();
    let collision = await prisma.session.findUnique({ where: { joinCode } });
    while (collision) {
      joinCode = generateJoinCode();
      collision = await prisma.session.findUnique({ where: { joinCode } });
    }

    const session = await prisma.session.create({
      data: {
        name: name?.trim() || 'Watch Decision Party',
        creatorId: userId,
        joinCode,
        status: 'open',
        shortlistIds: candidateIds,
        constraints: {
          maxRuntime: maxRuntime ? Number(maxRuntime) : undefined,
          moodFilter: moodFilter?.trim() || undefined,
        },
        participants: {
          connect: { id: userId },
        },
      },
    });

    const populatedSession = await getPopulatedSession(session.id);

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
    const sessions = await prisma.session.findMany({
      where: { status: 'open' },
      include: {
        creator: { select: { id: true, name: true, email: true, avatar: true } },
        participants: { select: { id: true, name: true, email: true, avatar: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    const sessionIds = sessions.map((s) => s.id);
    const votes = sessionIds.length
      ? await prisma.vote.findMany({
          where: { sessionId: { in: sessionIds } },
        })
      : [];

    const tallyBySession = new Map<string, Map<string, { yes: number; no: number; net: number }>>();
    for (const v of votes) {
      const sid = v.sessionId;
      const tid = v.titleId;
      if (!tallyBySession.has(sid)) tallyBySession.set(sid, new Map());
      const perTitle = tallyBySession.get(sid)!;
      if (!perTitle.has(tid)) perTitle.set(tid, { yes: 0, no: 0, net: 0 });
      const entry = perTitle.get(tid)!;
      if (v.reaction === 'yes') {
        entry.yes += 1;
        entry.net += v.strength || 1;
      } else {
        entry.no += 1;
        entry.net -= v.strength || 1;
      }
    }

    // Load shortlist titles for all sessions
    const allShortlistIds = Array.from(new Set(sessions.flatMap((s) => s.shortlistIds)));
    const allTitles = allShortlistIds.length
      ? await prisma.title.findMany({ where: { id: { in: allShortlistIds } } })
      : [];
    const titleMap = new Map(allTitles.map((t) => [t.id, t]));

    const sanitized = sessions.map((s) => {
      const sessionDoc: any = {
        ...s,
        _id: s.id,
        host: s.creator ? { ...s.creator, _id: s.creator.id } : null,
        participants: s.participants.map((p) => ({ ...p, _id: p.id })),
        shortlist: s.shortlistIds.map((tid) => titleMap.get(tid)).filter(Boolean).map((t: any) => ({ ...t, _id: t.id })),
      };

      sanitizeSessionPeople(sessionDoc);

      const perTitle = tallyBySession.get(s.id);
      const participantCount = s.participants.length || 1;

      sessionDoc.voteTally = (sessionDoc.shortlist || []).map((t: any) => {
        const counts = perTitle?.get(t.id) || { yes: 0, no: 0, net: 0 };
        const totalVotes = counts.yes + counts.no;
        return {
          titleId: t.id,
          yes: counts.yes,
          no: counts.no,
          totalVotes,
          yesPercent: Math.round((counts.yes / participantCount) * 100),
          netScore: counts.net / participantCount,
        };
      });

      sessionDoc.participantCount = s.participants.length;
      return sessionDoc;
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

    const sessionDoc = await prisma.session.findUnique({
      where: { joinCode: cleanCode },
    });
    if (!sessionDoc) {
      return next(new AppError('Session room not found with code ' + cleanCode, 404));
    }

    const populatedSession = await getPopulatedSession(sessionDoc.id);
    sanitizeSessionPeople(populatedSession);

    const votes = await SessionService.getVotes(sessionDoc.id);
    const safeVotes = votes.map((v: any) => ({ ...v, user: sanitizePeople(v.user) }));

    sendSuccess(res, { session: populatedSession, votes: safeVotes }, 'Session retrieved successfully');
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

    try {
      const { session, alreadyPresent } = await SessionService.joinByCode(joinCode, userId);
      const populatedSession = await getPopulatedSession(session.id || session._id);
      const votes = await SessionService.getVotes(session.id || session._id);
      const safeVotes = votes.map((v: any) => ({ ...v, user: sanitizePeople(v.user) }));
      sanitizeSessionPeople(populatedSession);

      if (!alreadyPresent) {
        SocketService.emitToSession(session.id || session._id, 'participant:joined', {
          sessionId: session.id || session._id,
          user: { id: userId },
        });
      }

      sendSuccess(res, { session: populatedSession, votes: safeVotes }, 'Joined session successfully');
    } catch (err: any) {
      next(err instanceof SessionServiceError ? new AppError(err.message, err.statusCode) : err);
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Add a title to the candidate shortlist of an active session
 * POST /api/sessions/:sessionId/shortlist
 */
export const addTitleToShortlist = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const sessionId = String(req.params.sessionId);
    const { titleId, tmdbId, type, titleData } = req.body;

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { participants: { select: { id: true } } },
    });
    if (!session) {
      return next(new AppError('Session room not found', 404));
    }

    if (session.status !== 'open') {
      return next(new AppError('Cannot add titles to a closed/finalized session', 400));
    }

    if (!SessionService.isMember(session, userId)) {
      return next(
        new AppError('Join the room with its code before adding candidates', 403)
      );
    }

    let finalTitleId = titleId;

    if (!finalTitleId && tmdbId) {
      let titleDoc = await prisma.title.findUnique({ where: { tmdbId: Number(tmdbId) } });
      if (!titleDoc) {
        if (titleData) {
          titleDoc = await prisma.title.create({
            data: {
              name: titleData.name || titleData.title,
              originalName: titleData.originalName,
              type: titleData.type || (type === 'tv' ? 'tv' : 'film'),
              tmdbId: Number(tmdbId),
              releaseYear: titleData.releaseYear,
              runtimeMinutes: titleData.runtimeMinutes,
              genres: titleData.genres || [],
              synopsis: titleData.synopsis || titleData.overview || '',
              posterUrl: titleData.posterUrl,
              backdropUrl: titleData.backdropUrl,
              voteAverage: titleData.voteAverage || 7.5,
            },
          });
        } else if (tmdbService.hasApiKey()) {
          const mediaType: 'tv' | 'film' = type === 'tv' ? 'tv' : 'film';
          const details = await tmdbService.fetchDetails(Number(tmdbId), mediaType);
          if (details) {
            titleDoc = await prisma.title.create({
              data: {
                name: details.name,
                originalName: details.originalName,
                type: details.type,
                tmdbId: details.tmdbId,
                releaseYear: details.releaseYear,
                runtimeMinutes: details.runtimeMinutes,
                genres: details.genres,
                synopsis: details.synopsis || '',
                posterUrl: details.posterUrl,
                backdropUrl: details.backdropUrl,
                voteAverage: details.voteAverage,
                moodTags: details.moodTags || [],
              },
            });
          }
        }
      }
      if (titleDoc) {
        finalTitleId = titleDoc.id;
      }
    } else if (finalTitleId) {
      // Check if it's numeric tmdbId
      if (!isNaN(Number(finalTitleId)) && !String(finalTitleId).includes('-')) {
        const titleDoc = await prisma.title.findUnique({ where: { tmdbId: Number(finalTitleId) } });
        if (titleDoc) {
          finalTitleId = titleDoc.id;
        }
      }
    }

    if (!finalTitleId) {
      return next(new AppError('Valid titleId or tmdbId is required', 400));
    }

    // Add to shortlistIds array if not present
    if (!session.shortlistIds.includes(finalTitleId)) {
      await prisma.session.update({
        where: { id: sessionId },
        data: {
          shortlistIds: [...session.shortlistIds, finalTitleId],
        },
      });
    }

    const populatedSession = await getPopulatedSession(sessionId);
    sanitizeSessionPeople(populatedSession);

    const votes = await SessionService.getVotes(sessionId);

    sendSuccess(
      res,
      { session: populatedSession, votes: votes.map((v: any) => ({ ...v, user: sanitizePeople(v.user) })) },
      'Title added to session shortlist successfully'
    );
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

    const sessionId = String(req.params.sessionId);
    const titleId = String(req.params.titleId);
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) {
      return next(new AppError('Session room not found', 404));
    }

    if (session.status !== 'open') {
      return next(new AppError('Cannot modify a closed session', 400));
    }

    if (!SessionService.isHost(session, userId)) {
      return next(new AppError('Only the room host can remove candidates', 403));
    }

    await prisma.session.update({
      where: { id: sessionId },
      data: {
        shortlistIds: session.shortlistIds.filter((id) => id !== titleId),
      },
    });

    const populatedSession = await getPopulatedSession(sessionId);
    sanitizeSessionPeople(populatedSession);

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

    const sessionId = String(req.params.sessionId);
    const { titleId, reaction = 'yes', strength = 3 } = req.body;

    try {
      const { vote, votes } = await SessionService.castVote({
        sessionId,
        userId,
        titleId,
        reaction,
        strength,
      });

      SocketService.emitToSession(sessionId, 'vote:updated', { sessionId, votes, vote });

      sendSuccess(res, { vote, votes }, 'Vote recorded successfully');
    } catch (err: any) {
      next(err instanceof SessionServiceError ? new AppError(err.message, err.statusCode) : err);
    }
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

    const sessionId = String(req.params.sessionId);

    try {
      const result = await SessionService.finalize(sessionId, userId);

      SocketService.emitToSession(sessionId, 'session:finalized', result);

      sendSuccess(
        res,
        result,
        result.winnerId
          ? 'Session decision finalized successfully'
          : 'Session closed with no decision'
      );
    } catch (err: any) {
      next(err instanceof SessionServiceError ? new AppError(err.message, err.statusCode) : err);
    }
  } catch (error) {
    next(error);
  }
};
