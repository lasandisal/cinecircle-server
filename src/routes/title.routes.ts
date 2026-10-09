import { Router } from 'express';
import {
  searchTitles,
  getTitleDetails,
  addComment,
  getComments,
} from '../controllers/title.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/search', searchTitles);
router.get('/:titleId', getTitleDetails);
router.get('/:titleId/comments', getComments);
router.post('/:titleId/comments', authenticate, addComment);

export default router;
