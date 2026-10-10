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
} from '../controllers/session.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/active', getActiveSessions);
router.get('/code/:joinCode', getSessionByCode);
router.post('/create', authenticate, createSession);
router.post('/join', authenticate, joinSession);
router.post('/:sessionId/shortlist', authenticate, addTitleToShortlist);
router.delete('/:sessionId/shortlist/:titleId', authenticate, removeTitleFromShortlist);
router.post('/:sessionId/vote', authenticate, submitVote);
router.post('/:sessionId/lock', authenticate, lockSessionPick);

export default router;
