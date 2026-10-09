import { Router } from 'express';
import {
  getTitles,
  getTrendingTitles,
  searchTitles,
  getGenres,
  getTitleDetails,
  getSeasonEpisodes,
  seedTitles,
  addComment,
  getComments,
  likeComment,
  reactToComment,
  voteCommentPoll,
  searchMusic,
  addTitleSoundtrack,
} from '../controllers/title.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Music search for soundtrack discovery
router.get('/music/search', searchMusic);

// Catalogue listing & search
router.get('/', getTitles);
router.get('/trending', getTrendingTitles);
router.get('/genres', getGenres);
router.get('/search', searchTitles);

// Catalog Seeding
router.post('/seed', seedTitles);

// Title details, seasons & comments
router.get('/:titleId', getTitleDetails);
router.get('/:titleId/seasons/:seasonNumber', getSeasonEpisodes);
router.post('/:titleId/soundtracks', addTitleSoundtrack);
router.get('/:titleId/comments', getComments);
router.post('/:titleId/comments', authenticate, addComment);
router.post('/comments/:commentId/like', likeComment);
router.post('/comments/:commentId/react', authenticate, reactToComment);
router.post('/comments/:commentId/poll/vote', authenticate, voteCommentPoll);

export default router;
