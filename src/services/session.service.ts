import prisma from '../config/prisma';
import { RecommendationService } from './recommendation.service';
import { AiService } from './ai.service';

export class SessionServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export interface VoteInput {
  sessionId: string;
  userId: string;
  titleId: string;
  reaction?: string;
  strength?: number;
}

export interface FinalizeResult {
  session: any;
  winnerId?: string;
  scores: ReturnType<typeof RecommendationService.computeGroupCompromise>;
  aiPitch?: string;
  aiPitchGenerated: boolean;
}

const formatSessionResponse = (s: any) => {
  if (!s) return null;
  return {
    ...s,
    _id: s.id,
    host: s.creator ? { ...s.creator, _id: s.creator.id } : s.creatorId,
    participants: (s.participants || []).map((p: any) => ({ ...p, _id: p.id })),
    shortlist: s.shortlist || [],
  };
};

export class SessionService {
  /** Deterministic room name derived from the database id */
  public static roomName(sessionId: string): string {
    return `session:${sessionId}`;
  }

  /**
   * Resolve a join code to a session and add the user to its participants.
   */
  public static async joinByCode(joinCode: string, userId: string) {
    const cleanCode = String(joinCode || '').toUpperCase().trim();
    if (!cleanCode) {
      throw new SessionServiceError('joinCode is required', 400);
    }

    const session = await prisma.session.findUnique({
      where: { joinCode: cleanCode },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        participants: { select: { id: true, name: true, avatar: true } },
      },
    });

    if (!session) {
      throw new SessionServiceError(`No session found with code ${cleanCode}`, 404);
    }
    if (session.status !== 'open') {
      throw new SessionServiceError('This decision has already been finalized', 409);
    }

    const alreadyPresent = session.participants.some((p) => p.id === userId);
    if (!alreadyPresent) {
      await prisma.session.update({
        where: { id: session.id },
        data: {
          participants: {
            connect: { id: userId },
          },
        },
      });
      session.participants.push({ id: userId } as any);
    }

    return { session: formatSessionResponse(session), alreadyPresent };
  }

  /** All votes in a session, with voter identities populated. */
  public static async getVotes(sessionId: string) {
    const votes = await prisma.vote.findMany({
      where: { sessionId },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
    });

    return votes.map((v) => ({
      ...v,
      _id: v.id,
      session: v.sessionId,
      title: v.titleId,
      user: v.user ? { ...v.user, _id: v.user.id } : null,
    }));
  }

  public static isMember(session: any, userId: string): boolean {
    return (session.participants || []).some((p: any) => (p.id || p._id || p).toString() === userId);
  }

  public static isHost(session: any, userId: string): boolean {
    const hostId = session.creatorId || session.creator?.id || session.host?._id || session.host;
    return String(hostId) === userId;
  }

  /**
   * Cast (or change) a vote.
   */
  public static async castVote(input: VoteInput) {
    const { sessionId, userId, titleId, reaction = 'yes', strength = 3 } = input;

    if (!sessionId) {
      throw new SessionServiceError('Invalid session id', 400);
    }
    if (!titleId) {
      throw new SessionServiceError('titleId is required', 400);
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { participants: { select: { id: true } } },
    });

    if (!session) {
      throw new SessionServiceError('Session not found', 404);
    }
    if (session.status !== 'open') {
      throw new SessionServiceError('Voting has already closed for this session', 409);
    }

    const isParticipant = session.participants.some((p) => p.id === userId);
    if (!isParticipant) {
      throw new SessionServiceError('You must join this session before voting', 403);
    }

    const vote = await prisma.vote.upsert({
      where: {
        sessionId_userId_titleId: {
          sessionId,
          userId,
          titleId,
        },
      },
      create: {
        sessionId,
        userId,
        titleId,
        reaction,
        strength: Number(strength) || 3,
      },
      update: {
        reaction,
        strength: Number(strength) || 3,
      },
      include: {
        user: { select: { id: true, name: true, email: true, avatar: true } },
      },
    });

    const votes = await this.getVotes(sessionId);

    return {
      vote: {
        ...vote,
        _id: vote.id,
        session: vote.sessionId,
        title: vote.titleId,
        user: vote.user ? { ...vote.user, _id: vote.user.id } : null,
      },
      votes,
    };
  }

  /**
   * Lock the room and pick the winning title.
   */
  public static async finalize(sessionId: string, hostUserId: string): Promise<FinalizeResult> {
    if (!sessionId) {
      throw new SessionServiceError('Invalid session id', 400);
    }

    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        participants: { select: { id: true, name: true, avatar: true } },
        votes: true, // Added to resolve property 'votes' does not exist error
      },
    });

    if (!session) {
      throw new SessionServiceError('Session not found', 404);
    }
    if (session.creatorId !== hostUserId) {
      // Cookie sessions are shared by every tab in a browser. If someone signs
      // in as another account in a second tab, the first tab still renders the
      // old user but every request carries the new account's cookie - which is
      // exactly how a "host" ends up here. Say so instead of a bare 403.
      const hostName = session.creator?.name || 'the room host';
      throw new SessionServiceError(
        `Only ${hostName} can lock this decision. ` +
          `This browser is signed in as a different account - sign in as the host and try again.`,
        403
      );
    }
    if (session.status !== 'open') {
      throw new SessionServiceError('This session has already been finalized', 409);
    }

    const votes = await prisma.vote.findMany({ where: { sessionId } });
    const participantCount = session.participants.length || 1;
    const scores = RecommendationService.computeGroupCompromise(votes, participantCount);

    let winnerId: string | undefined;
    if (scores.length > 0) {
      scores.sort((a, b) => b.score - a.score);
      winnerId = scores[0].titleId;
    } else if (session.shortlistIds.length > 0) {
      winnerId = session.shortlistIds[0];
    }

    let aiPitch: string | undefined;
    let aiPitchGenerated = false;

    if (winnerId) {
      const winningTitle = await prisma.title.findUnique({ where: { id: winnerId } });
      if (winningTitle) {
        try {
          const votesForWinner = session.votes.filter((v: any) => v.titleId === winnerId);
          const participantsInput = session.participants.map((p) => {
            const v = votesForWinner.find((vote: any) => vote.userId === p.id);
            return {
              name: p.name,
              preferredMood: (session.constraints as any)?.moodFilter || 'Group Watch',
              votedYes: v ? v.reaction === 'yes' : false,
              strength: v ? v.strength : 1,
            };
          });

          const generated = await AiService.generateGroupCompromisePitch({
            roomName: session.name || 'Group Watch',
            winnerTitle: winningTitle.name,
            winnerSynopsis: winningTitle.synopsis || '',
            participants: participantsInput,
          });
          aiPitch = generated.pitch;
          aiPitchGenerated = generated.source === 'gemini';
        } catch (err: any) {
          console.warn('[SessionService] AI pitch generation failed, proceeding with fallback:', err.message);
          aiPitch = `The circle selected "${winningTitle.name}"! Perfect runtime and genre match for tonight.`;
        }

      }
    }

    const updated = await prisma.session.update({
      where: { id: sessionId },
      data: {
        status: 'closed',
        winnerId,
        finalPickId: winnerId,
        aiPitch,
      },
      include: {
        creator: { select: { id: true, name: true, avatar: true } },
        participants: { select: { id: true, name: true, avatar: true } },
      },
    });
    const winningTitle = winnerId
      ? await prisma.title.findUnique({ where: { id: winnerId } })
      : null;
    const formattedSession = formatSessionResponse(updated);
    formattedSession.finalPick = winningTitle
      ? { ...winningTitle, _id: winningTitle.id }
      : null;

    if (winningTitle) {
      const hostName = session.creator?.name || 'Watch Circle Host';
      const hostAvatar =
        session.creator?.avatar ||
        `https://ui-avatars.com/api/?name=${encodeURIComponent(hostName)}&background=f59e0b&color=fff`;
      await prisma.notification.createMany({
        data: session.participants.map((participant) => ({
          userId: participant.id,
          type: 'verdict',
          actorName: hostName,
          actorAvatar: hostAvatar,
          title: `Your watch circle chose "${winningTitle.name}".`,
          detail: session.name || `Room Code: #${session.joinCode}`,
          actionUrl: `/group?code=${session.joinCode}`,
          actionText: 'View Winner',
          sessionId,
        })),
      });
    }

    return {
      session: formattedSession,
      winnerId,
      scores,
      aiPitch,
      aiPitchGenerated,
    };
  }

  /**
   * Reopen a finalized room for another round while preserving its shortlist
   * and room identity.
   */
  public static async reopen(sessionId: string, hostUserId: string) {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      include: { participants: { select: { id: true } } },
    });

    if (!session) throw new SessionServiceError('Session not found', 404);
    if (session.creatorId !== hostUserId) {
      throw new SessionServiceError('Only the host can start a new round', 403);
    }
    if (session.status !== 'closed') {
      throw new SessionServiceError('The room is already open', 409);
    }

    await prisma.vote.deleteMany({ where: { sessionId } });
    return prisma.session.update({
      where: { id: sessionId },
      data: {
        status: 'open',
        winnerId: null,
        finalPickId: null,
        aiPitch: null,
      },
    });
  }
}