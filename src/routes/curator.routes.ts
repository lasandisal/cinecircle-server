import { Router } from 'express';
import {
  addCuratedSoundtrack,
  updateCuratedEpisodes,
  moderateComment,
  getFlaggedComments,
} from '../controllers/curator.controller';
import { authenticate, requireRole, authenticateCuratorOrKey } from '../middleware/auth.middleware';

const router = Router();

// Autonomous AI agent webhook or Admin authenticated
router.post('/soundtracks', authenticateCuratorOrKey, addCuratedSoundtrack);
router.post('/episodes', authenticateCuratorOrKey, updateCuratedEpisodes);
router.get('/comments/flagged', authenticate, requireRole('admin'), getFlaggedComments);
router.patch('/comments/:commentId/moderate', authenticate, requireRole('admin'), moderateComment);

export default router;
