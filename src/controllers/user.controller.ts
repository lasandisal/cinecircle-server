import { Request, Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import prisma from '../config/prisma';
import { sendSuccess } from '../utils/response';
import { AppError } from '../middleware/error.middleware';
import { CompatibilityService } from '../services/compatibility.service';
import { RecommendationService } from '../services/recommendation.service';
import { ConnectionGraphService } from '../services/connection-graph.service';
import { ConnectionError, ConnectionService } from '../services/connection.service';

/**
 * Redact a user document for someone who is not the owner.
 */
function redactUserForViewer(user: any, viewerId?: string, viewerRole?: string) {
  const isOwner = !!viewerId && user.id === viewerId;
  const isAdmin = viewerRole === 'admin';
  if (isOwner || isAdmin) return user;

  const { email, passwordHash, fatigueCount, onboarded, ...publicFields } = user;
  return {
    ...publicFields,
    email: email ? maskEmail(email) : undefined,
  };
}

function maskEmail(email: string): string {
  const [local, domain] = String(email).split('@');
  if (!domain) return '•••';
  const visible = local.slice(0, 2);
  return `${visible}${'•'.repeat(Math.max(2, local.length - 2))}@${domain}`;
}

const formatTitleForCard = (t: any) => {
  if (!t) return null;
  return {
    ...t,
    _id: t.id,
  };
};

/**
 * Get Instagram-like comprehensive user profile
 * GET /api/users/:userId/profile or GET /api/users/me
 */
export const getProfile = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rawParam = req.params.userId;
    const targetUserId: string =
      (typeof rawParam === 'string' && rawParam !== 'me' && rawParam !== '' ? rawParam : req.user?.id) || '';
    if (!targetUserId) {
      return next(new AppError('User ID is required', 400));
    }

    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const safeUser = redactUserForViewer(user, req.user?.id, req.user?.role);

    const [
      tasteProfile,
      watchlistCount,
      watchedCount,
      circlesCount,
      reviewsCount,
      connectionsCount,
      connectionStatus,
    ] = await Promise.all([
      prisma.tasteProfile.findUnique({ where: { userId: targetUserId } }),
      prisma.watchlist.count({ where: { userId: targetUserId, watched: false } }),
      prisma.watchlist.count({ where: { userId: targetUserId, watched: true } }),
      prisma.session.count({
        where: { participants: { some: { id: targetUserId } } },
      }),
      prisma.comment.count({ where: { userId: targetUserId } }),
      ConnectionService.countAccepted(targetUserId),
      ConnectionService.getStatus(req.user?.id, targetUserId),
    ]);

    const [
      recentWatchedDocs,
      recentWatchlistDocs,
      recentReviewsDocs,
      userCirclesDocs,
    ] = await Promise.all([
      prisma.watchlist.findMany({
        where: { userId: targetUserId, watched: true },
        include: { title: true },
        orderBy: [{ watchedAt: 'desc' }, { addedAt: 'desc' }],
        take: 12,
      }),
      prisma.watchlist.findMany({
        where: { userId: targetUserId, watched: false },
        include: { title: true },
        orderBy: { addedAt: 'desc' },
        take: 18,
      }),
      prisma.comment.findMany({
        where: { userId: targetUserId },
        include: { title: true },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
      prisma.session.findMany({
        where: { participants: { some: { id: targetUserId } } },
        include: { creator: { select: { id: true, name: true, avatar: true } } },
        orderBy: { createdAt: 'desc' },
        take: 6,
      }),
    ]);

    const compatibility = await CompatibilityService.compute(
      targetUserId,
      req.user?.id
    );

    let mutualWatchedTitles: any[] = [];
    if (req.user && req.user.id !== targetUserId) {
      const viewerWatchedItems = await prisma.watchlist.findMany({
        where: { userId: req.user.id, watched: true },
        select: { titleId: true },
      });
      const viewerWatchedIds = viewerWatchedItems.map((w) => w.titleId);

      if (viewerWatchedIds.length > 0) {
        mutualWatchedTitles = await prisma.watchlist.findMany({
          where: {
            userId: targetUserId,
            watched: true,
            titleId: { in: viewerWatchedIds },
          },
          include: { title: true },
          orderBy: [{ watchedAt: 'desc' }, { addedAt: 'desc' }],
        });
      }
    }

    sendSuccess(
      res,
      {
        profile: {
          ...safeUser,
          _id: user.id,
          avatar: user.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name)}&background=6366f1&color=fff`,
          handle: user.handle || `@${(user.email.split('@')[0] || user.name).toLowerCase().replace(/\s+/g, '')}`,
          bio: user.bio || 'Film lover & decision maker on CineCircle 🍿',
          tasteProfile,
          stats: {
            watchlistCount,
            watchedCount,
            connectionsCount,
            circlesCount,
            reviewsCount,
            mutualWatchedCount: mutualWatchedTitles.length,
            circleCompatibility: compatibility.score,
            circleCompatibilityBasis: compatibility.basis,
            circleCompatibilityExplanation: compatibility.explanation,
          },
          connectionStatus: connectionStatus.status,
          connectionRequestId: connectionStatus.requestId,
          mutualWatchedTitles: mutualWatchedTitles
            .filter((w) => w.title != null)
            .map((w) => ({ ...w, _id: w.id, title: formatTitleForCard(w.title) })),
          recentWatched: recentWatchedDocs
            .filter((w) => w.title != null)
            .map((w) => ({ ...w, _id: w.id, title: formatTitleForCard(w.title) })),
          savedWatchlist: recentWatchlistDocs
            .filter((w) => w.title != null)
            .map((w) => ({ ...w, _id: w.id, title: formatTitleForCard(w.title) })),
          recentReviews: recentReviewsDocs
            .filter((r) => r.title != null)
            .map((r) => ({ ...r, _id: r.id, title: formatTitleForCard(r.title) })),
          userCircles: userCirclesDocs.map((s) => ({
            ...s,
            _id: s.id,
            host: s.creator ? { ...s.creator, _id: s.creator.id } : null,
          })),
          isMutualConnection: connectionStatus.status === 'accepted',
          isSelf: req.user ? req.user.id === targetUserId : false,
        },
      },
      'User profile retrieved successfully'
    );
  } catch (error) {
    next(error);
  }
};

export const requestConnection = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user?.id || !req.body?.targetUserId) {
      return next(new AppError('targetUserId is required', 400));
    }
    await ConnectionService.request(req.user.id, req.body.targetUserId);
    sendSuccess(res, { status: 'pending_sent' }, 'Connection request sent');
  } catch (error: any) {
    next(error instanceof ConnectionError ? new AppError(error.message, error.statusCode) : error);
  }
};

export const respondToConnection = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user?.id || !req.body?.requestId || !['accepted', 'rejected'].includes(req.body.status)) {
      return next(new AppError('requestId and a valid status are required', 400));
    }
    await ConnectionService.respond(req.user.id, req.body.requestId, req.body.status);
    sendSuccess(res, { status: req.body.status }, `Connection request ${req.body.status}`);
  } catch (error: any) {
    next(error instanceof ConnectionError ? new AppError(error.message, error.statusCode) : error);
  }
};

/**
 * Edit user profile details (Name, Bio, Handle, Avatar)
 * PUT /api/users/profile
 */
export const updateProfile = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { name, bio, handle, avatar, subscribedServices } = req.body;

    const data: any = {};
    if (name && typeof name === 'string') data.name = name.trim();
    if (bio !== undefined) data.bio = String(bio).trim();
    if (handle && typeof handle === 'string') {
      const cleanHandle = handle.startsWith('@') ? handle : `@${handle.trim()}`;
      data.handle = cleanHandle;
    }
    if (avatar && typeof avatar === 'string') data.avatar = avatar.trim();
    if (Array.isArray(subscribedServices)) data.subscribedServices = subscribedServices;

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data,
    });

    sendSuccess(
      res,
      { user: { ...updatedUser, _id: updatedUser.id } },
      'Profile updated successfully'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Find more people / Community directory search
 * GET /api/users/search?q=...
 */
export const searchPeople = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { q = '' } = req.query;
    const currentUserId = req.user?.id;

    const where: any = {};
    if (currentUserId) {
      where.id = { not: currentUserId };
    }

    if (q && typeof q === 'string' && q.trim()) {
      const term = q.trim();
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { email: { contains: term, mode: 'insensitive' } },
        { handle: { contains: term, mode: 'insensitive' } },
      ];
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        handle: true,
        avatar: true,
        bio: true,
        role: true,
        subscribedServices: true,
        createdAt: true,
      },
      take: 20,
    });

    const userIds = users.map((u) => u.id);
    const [watchedRows, compatByUser] = await Promise.all([
      prisma.watchlist.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, watched: true },
        _count: { titleId: true },
      }),
      CompatibilityService.computeBatch(currentUserId, userIds),
    ]);

    const watchedMap = new Map(watchedRows.map((r) => [r.userId, r._count.titleId]));

    const people = users.map((u) => {
      const id = u.id;
      const compat = compatByUser.get(id);

      return {
        id,
        _id: id,
        name: u.name,
        email: u.email,
        handle: u.handle || `@${(u.email.split('@')[0] || u.name).toLowerCase().replace(/\s+/g, '')}`,
        avatar: u.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=6366f1&color=fff`,
        bio: u.bio || 'Movie enthusiast & CineCircle circle member',
        role: u.role,
        stats: {
          watchedCount: watchedMap.get(id) || 0,
          circlesCount: 0,
        },
        matchScore: compat?.score ?? null,
        matchExplanation: compat?.explanation || '',
        mutualWatchedCount: compat?.mutualWatchedCount ?? 0,
      };
    });

    sendSuccess(res, { people }, 'People search results retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Complete First-Time Onboarding Wizard
 * POST /api/users/onboarding
 */
export const completeOnboarding = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { favoriteGenres = [], exclusions = [], favoriteTitles = [], subscribedServices = [] } = req.body;

    const profile = await prisma.tasteProfile.upsert({
      where: { userId },
      create: {
        userId,
        favoriteGenres,
        exclusions,
        favoriteTitleIds: favoriteTitles,
        updatedAt: new Date(),
      },
      update: {
        favoriteGenres,
        exclusions,
        favoriteTitleIds: favoriteTitles,
        updatedAt: new Date(),
      },
    });

    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: {
        subscribedServices,
        onboarded: true,
      },
      include: {
        tasteProfile: true,
      },
    });

    sendSuccess(
      res,
      {
        user: { ...updatedUser, _id: updatedUser.id },
        tasteProfile: { ...profile, _id: profile.id },
      },
      'Onboarding completed successfully'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Read the member's taste profile
 * GET /api/users/taste-profile
 */
export const getTasteProfile = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const profile = await prisma.tasteProfile.findUnique({ where: { userId } });
    const computed = await RecommendationService.computeRecencyWeightedTasteProfile(userId);

    sendSuccess(
      res,
      {
        tasteProfile: {
          favoriteGenres: profile?.favoriteGenres || [],
          favoriteTitles: profile?.favoriteTitleIds || [],
          exclusions: profile?.exclusions || [],
          genreScores: computed.genreScores,
          historyEvents: computed.totalEvents,
          tasteComputedAt: computed.lastComputedAt,
        },
      },
      'Taste profile retrieved'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Update taste profile
 * PUT /api/users/taste-profile
 */
export const updateTasteProfile = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { favoriteGenres = [], exclusions = [], favoriteTitles = [] } = req.body;

    const profile = await prisma.tasteProfile.upsert({
      where: { userId },
      create: {
        userId,
        favoriteGenres,
        exclusions,
        favoriteTitleIds: favoriteTitles,
        updatedAt: new Date(),
      },
      update: {
        favoriteGenres,
        exclusions,
        favoriteTitleIds: favoriteTitles,
        updatedAt: new Date(),
      },
    });

    if (favoriteGenres.length > 0) {
      await prisma.user.update({
        where: { id: userId },
        data: { onboarded: true },
      }).catch(() => null);
    }

    sendSuccess(res, { tasteProfile: { ...profile, _id: profile.id } }, 'Taste profile updated');
  } catch (error) {
    next(error);
  }
};

/**
 * Update subscribed streaming services
 * PUT /api/users/subscribed-services
 */
export const updateSubscribedServices = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return next(new AppError('Unauthorized', 401));
    }

    const { services = [] } = req.body;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { subscribedServices: services },
      select: { subscribedServices: true },
    });

    sendSuccess(res, { subscribedServices: user.subscribedServices || [] }, 'Subscribed services updated');
  } catch (error) {
    next(error);
  }
};

/**
 * Full social graph for a member
 * GET /api/users/:userId/connections
 */
export const getConnections = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rawParam = req.params.userId;
    const userId =
      typeof rawParam === 'string' && rawParam !== 'me' && rawParam !== '' ? rawParam : req.user?.id;
    if (!userId) {
      return next(new AppError('User ID is required', 400));
    }

    const [graph, counts] = await Promise.all([
      ConnectionGraphService.getGraph(userId),
      ConnectionGraphService.getCounts(userId),
    ]);

    sendSuccess(
      res,
      { ...graph, counts },
      'Connections retrieved'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Retrieve suggested users
 * GET /api/users/suggestions
 */
export const getUserSuggestions = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const currentUserId = req.user?.id;
    const where: any = {};
    if (currentUserId) {
      where.id = { not: currentUserId };
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatar: true,
        handle: true,
        bio: true,
        createdAt: true,
      },
      take: 6,
    });

    const candidateUserIds = users.map((u) => u.id);
    const compatByUser = await CompatibilityService.computeBatch(currentUserId, candidateUserIds);

    const matches = users.map((u, idx) => {
      const handle = u.handle || (u.email ? `@${u.email.split('@')[0]}` : `@${u.name.toLowerCase().replace(/\s+/g, '')}`);
      const id = u.id;
      const compat = compatByUser.get(id);
      return {
        id,
        _id: id,
        name: u.name,
        handle,
        avatar: u.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.name)}&background=${idx % 2 === 0 ? '6366f1' : '8b5cf6'}&color=fff`,
        matchScore: compat?.score ?? null,
        matchExplanation: compat?.explanation || '',
        mutualCount: compat?.mutualWatchedCount ?? 0,
      };
    });

    matches.sort((a, b) => (b.matchScore ?? -1) - (a.matchScore ?? -1));

    sendSuccess(res, { users: matches }, 'User suggestions retrieved');
  } catch (error) {
    next(error);
  }
};

/**
 * Get real dynamic notifications for the user
 * GET /api/users/notifications
 */
export const getNotifications = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      sendSuccess(res, { notifications: [] }, 'No notifications for guest');
      return;
    }

    const notifications: any[] = [];

    // 1. Sessions where user is participant
    const userSessions = await prisma.session.findMany({
      where: {
        participants: { some: { id: userId } },
        status: 'active',
      },
      include: {
        creator: { select: { id: true, name: true, avatar: true, handle: true } },
        participants: { select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 4,
    });

    for (const s of userSessions) {
      const hostName = s.creator?.name || 'Watch Circle Host';
      const hostAvatar = s.creator?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(hostName)}&background=6366f1&color=fff`;
      const isHost = s.creator?.id === userId;

      notifications.push({
        id: `session-${s.id}`,
        type: 'circle',
        actorName: hostName,
        actorAvatar: hostAvatar,
        title: isHost
          ? `Your watch circle is active and voting.`
          : `invited you to join live watch circle`,
        detail: `Room Code: #${s.joinCode} • ${s.participants.length} participant(s)`,
        timestamp: s.createdAt ? new Date(s.createdAt).toLocaleDateString() : 'Recent',
        read: false,
        actionUrl: `/group`,
        actionText: 'Enter Room',
        createdAt: s.createdAt,
      });
    }

    // 2. Pending connection requests addressed to this user
    const pendingRequests = await prisma.connectionRequest.findMany({
      where: {
        recipientId: userId,
        status: 'pending',
      },
      include: {
        sender: { select: { id: true, name: true, avatar: true, handle: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });

    for (const request of pendingRequests) {
      const senderName = request.sender.name || 'Community Member';
      notifications.push({
        id: `connection-request-${request.id}`,
        type: 'follow',
        requestId: request.id,
        actorName: senderName,
        actorAvatar:
          request.sender.avatar ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(senderName)}&background=6366f1&color=fff`,
        title: 'sent you a connection request.',
        detail: request.sender.handle || 'Accept or ignore this request',
        timestamp: request.createdAt ? new Date(request.createdAt).toLocaleDateString() : 'Recent',
        read: false,
        actionUrl: `/profile/${request.sender.id}`,
        createdAt: request.createdAt,
      });
    }

    notifications.sort((a, b) => {
      const timeA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const timeB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return timeB - timeA;
    });

    sendSuccess(res, { notifications }, 'Real notifications retrieved successfully');
  } catch (error) {
    next(error);
  }
};
