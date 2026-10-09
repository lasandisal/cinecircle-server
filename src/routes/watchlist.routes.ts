import { Router } from 'express';
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  markAsWatched,
  rateTitle,
} from '../controllers/watchlist.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/', authenticate, getWatchlist);
router.post('/', authenticate, addToWatchlist);
router.delete('/:id', authenticate, removeFromWatchlist);
router.patch('/:id/watched', authenticate, markAsWatched);
router.patch('/:id/rate', authenticate, rateTitle);

export default router;
