import { Router } from 'express';
import {
  getTitles,
  getTrendingTitles,
  searchTitles,
  getGenres,
  getTitleDetails,
  seedTitles,
  addComment,
  getComments,
  likeComment,
} from '../controllers/title.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Catalogue listing & search
router.get('/', getTitles);
router.get('/trending', getTrendingTitles);
router.get('/genres', getGenres);
router.get('/search', searchTitles);

// Catalog Seeding
router.post('/seed', seedTitles);

// Title details & comments
router.get('/:titleId', getTitleDetails);
router.get('/:titleId/comments', getComments);
router.post('/:titleId/comments', authenticate, addComment);
router.post('/comments/:commentId/like', likeComment);

export default router;
