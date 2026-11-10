import { Router } from 'express';
import {
  createSession,
  joinSession,
  submitVote,
  lockSessionPick,
  getActiveSessions,
  getSessionByCode,
  addTitleToShortlist,
  removeTitleFromShortlist,
  inviteMembers,
  respondToSessionInvitation,
  deleteSession,
  reopenSession,
} from '../controllers/session.controller';
import { authenticate, optionalAuthenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/active', optionalAuthenticate, getActiveSessions);
router.get('/code/:joinCode', getSessionByCode);
router.post('/create', authenticate, createSession);
router.post('/join', authenticate, joinSession);
router.post('/:sessionId/invitations', authenticate, inviteMembers);
router.post('/invitations/:invitationId/respond', authenticate, respondToSessionInvitation);
router.delete('/:sessionId', authenticate, deleteSession);
router.post('/:sessionId/reopen', authenticate, reopenSession);
router.post('/:sessionId/shortlist', authenticate, addTitleToShortlist);
router.delete('/:sessionId/shortlist/:titleId', authenticate, removeTitleFromShortlist);
router.post('/:sessionId/vote', authenticate, submitVote);
router.post('/:sessionId/lock', authenticate, lockSessionPick);

export default router;
