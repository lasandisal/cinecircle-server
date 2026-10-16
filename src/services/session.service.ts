import mongoose from 'mongoose';
import { Session, Title, Vote } from '../models';
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

/**
 * Single source of truth for session membership, voting and finalisation.
 *
 * Both the REST controllers and the Socket.IO handlers call these methods, so a
 * vote cast over a socket is validated and persisted exactly like one cast over
 * HTTP. Previously the socket path merely re-broadcast whatever payload the
 * client sent, so a "winner" announced by socket never existed in the database.
 */
export class SessionService {
  /** Deterministic room name derived from the database id, never client input. */
  public static roomName(sessionId: string): string {
    return `session:${sessionId}`;
  }

  /**
   * Resolve a join code to a session and add the user to its participants.
   * Rejects closed rooms - previously a locked room stayed joinable forever.
   */
  public static async joinByCode(joinCode: string, userId: string) {
    const cleanCode = String(joinCode || '').toUpperCase().trim();
    if (!cleanCode) {
      throw new SessionServiceError('joinCode is required', 400);
    }

    const session = await Session.findOne({ joinCode: cleanCode });
    if (!session) {
      throw new SessionServiceError(`No session found with code ${cleanCode}`, 404);
    }
    if (session.status !== 'open') {
      throw new SessionServiceError('This decision has already been finalized', 409);
    }

    // $addToSet is atomic, so a repeated join can never duplicate the user.
    const alreadyPresent = session.participants.some((p) => p.toString() === userId);
    if (!alreadyPresent) {
      await Session.updateOne({ _id: session._id }, { $addToSet: { participants: userId } });
      session.participants.push(new mongoose.Types.ObjectId(userId));
    }

    return { session, alreadyPresent };
  }

  /** All votes in a session, with voter identities populated. */
  public static async getVotes(sessionId: string) {
    return Vote.find({ session: sessionId })
      .populate('user', 'name email avatar')
      .lean();
  }

  public static isMember(session: any, userId: string): boolean {
    return (session.participants || []).some((p: any) => p.toString() === userId);
  }

  public static isHost(session: any, userId: string): boolean {
    return session.host?.toString() === userId;
  }

  /**
   * Cast (or change) a vote. Validates that the session is open, the voter is a
   * member, and the title is actually on the shortlist - none of which the old
   * REST handler checked, so votes could be cast on arbitrary titles or after a
   * lock, and invalid ids surfaced as 500s.
   */
  public static async castVote(input: VoteInput) {
    const { sessionId, userId, titleId, reaction, strength } = input;

    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      throw new SessionServiceError('Invalid session id', 400);
    }
    if (!titleId || !mongoose.Types.ObjectId.isValid(titleId)) {
      throw new SessionServiceError('Invalid title id', 400);
    }

    const session = await Session.findById(sessionId);
    if (!session) {
      throw new SessionServiceError('Session not found', 404);
    }
    if (session.status !== 'open') {
      throw new SessionServiceError('This decision has already been finalized', 409);
    }
    if (!this.isMember(session, userId)) {
      throw new SessionServiceError('Join the room before voting', 403);
    }
    if (!(session.shortlist || []).some((t: any) => t.toString() === titleId)) {
      throw new SessionServiceError('That title is not on the shortlist', 400);
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

    const votes = await Vote.find({ session: sessionId })
      .populate('user', 'name email avatar')
      .lean();

    return { vote, votes };
  }

  /**
   * Close the room and record the compromise winner.
   *
   * Score is the documented formula:
   *   titleScore = Σ( voteStrength × (+1 if 'yes' else −1) ) / participantCount
   *
   * Also drives decision fatigue: a room closed with no votes at all counts as
   * an abandoned decision, and a successful pick resets the host's counter.
   */
  public static async finalize(sessionId: string, userId: string): Promise<FinalizeResult> {
    if (!mongoose.Types.ObjectId.isValid(sessionId)) {
      throw new SessionServiceError('Invalid session id', 400);
    }

    const session = await Session.findById(sessionId);
    if (!session) {
      throw new SessionServiceError('Session not found', 404);
    }
    if (!this.isHost(session, userId)) {
      throw new SessionServiceError('Only the room host can finalize the decision pick', 403);
    }
    if (session.status === 'closed') {
      throw new SessionServiceError('This decision has already been finalized', 409);
    }

    const votes = await Vote.find({ session: sessionId }).lean();
    const scores = RecommendationService.computeGroupCompromise(votes, session.participants.length);
    const byId = new Map(scores.map((s) => [s.titleId, s]));

    let winnerId: any;
    let best = -Infinity;
    for (const tId of session.shortlist) {
      const score = byId.get(tId.toString())?.score ?? 0;
      if (score > best) {
        best = score;
        winnerId = tId;
      }
    }

    const hadAnyVote = votes.length > 0;

    session.finalPick = hadAnyVote ? winnerId : undefined;
    session.status = 'closed';
    await session.save();

    if (hadAnyVote) {
      await RecommendationService.clearDecisionFatigue(userId);
    } else {
      await RecommendationService.recordDecisionFatigue(userId);
    }

    let aiPitch: string | undefined;
    let aiPitchGenerated = false;
    if (hadAnyVote && winnerId) {
      try {
        const winner = await Title.findById(winnerId).select('name synopsis').lean();
        const voters = await Vote.find({ session: sessionId, title: winnerId })
          .populate('user', 'name')
          .lean();
        const pitch = await AiService.generateGroupCompromisePitch({
          roomName: session.name || 'the room',
          winnerTitle: winner?.name || 'the compromise pick',
          winnerSynopsis: winner?.synopsis || '',
          participants: voters.map((v: any) => ({
            name: v.user?.name || 'A participant',
            votedYes: v.reaction === 'yes',
            strength: v.strength,
          })),
        });
        aiPitch = pitch.pitch;
        // Honest provenance: only claim Gemini wrote it if Gemini actually did.
        aiPitchGenerated = pitch.source === 'gemini';
      } catch (err: any) {
        console.warn('[SessionService] AI pitch generation failed:', err.message);
      }
    }

    const populated = await Session.findById(session._id)
      .populate('host', 'name email avatar')
      .populate('participants', 'name email avatar')
      .populate({
        path: 'shortlist',
        select:
          'name posterUrl backdropUrl releaseYear type genres runtimeMinutes voteAverage synopsis',
      })
      .lean();

    return {
      session: populated,
      winnerId: hadAnyVote ? String(winnerId) : undefined,
      scores,
      aiPitch,
      aiPitchGenerated,
    };
  }
}