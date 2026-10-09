import { Router } from 'express';
import {
  addCuratedSoundtrack,
  moderateComment,
  getFlaggedComments,
} from '../controllers/curator.controller';
import { authenticate, requireRole } from '../middleware/auth.middleware';

const router = Router();

// Restricted to admin / curator
router.post('/soundtracks', authenticate, requireRole('admin'), addCuratedSoundtrack);
router.get('/comments/flagged', authenticate, requireRole('admin'), getFlaggedComments);
router.patch('/comments/:commentId/moderate', authenticate, requireRole('admin'), moderateComment);

export default router;
