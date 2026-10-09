import { Router } from 'express';
import {
  createSession,
  joinSession,
  submitVote,
  lockSessionPick,
} from '../controllers/session.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.post('/create', authenticate, createSession);
router.post('/join', authenticate, joinSession);
router.post('/:sessionId/vote', authenticate, submitVote);
router.post('/:sessionId/lock', authenticate, lockSessionPick);

export default router;
