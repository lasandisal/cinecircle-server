import { Router } from 'express';
import {
  getWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  markAsWatched,
  rateTitle,
  getTitleWatchlistStatus,
} from '../controllers/watchlist.controller';
import { authenticate, optionalAuthenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/', authenticate, getWatchlist);
router.get('/status/:titleId', optionalAuthenticate, getTitleWatchlistStatus);
router.post('/', authenticate, addToWatchlist);
router.delete('/:id', authenticate, removeFromWatchlist);
router.patch('/:id/watched', authenticate, markAsWatched);
router.patch('/:id/rate', authenticate, rateTitle);

export default router;
