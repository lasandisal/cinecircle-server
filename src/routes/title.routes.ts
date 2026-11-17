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
  likeTitle,
  likeComment,
  getCommentLikers,
  getCommentReplies,
  reactToComment,
  reportComment,
  voteCommentPoll,
  deleteComment,
  searchMusic,
  addTitleSoundtrack,
  getFeedActivity,
} from '../controllers/title.controller';
import { authenticate, optionalAuthenticate } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';
import { commentSchema, pollVoteSchema, reportCommentSchema } from '../validation/schemas';
import { writeLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

// Feed activity
router.get('/feed', optionalAuthenticate, getFeedActivity);

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
// optionalAuthenticate lets the response personalise `reportedByMe` per comment
// without requiring a token for guests.
router.get('/:titleId', optionalAuthenticate, getTitleDetails);
router.get('/:titleId/seasons/:seasonNumber', getSeasonEpisodes);
router.post('/:titleId/soundtracks', addTitleSoundtrack);
router.get('/:titleId/comments', optionalAuthenticate, getComments);
router.post('/:titleId/comments', authenticate, writeLimiter, validateBody(commentSchema), addComment);
router.post('/:titleId/like', authenticate, writeLimiter, likeTitle);
router.post('/comments/:commentId/like', authenticate, writeLimiter, likeComment);
router.get('/comments/:commentId/likers', optionalAuthenticate, getCommentLikers);
router.get('/comments/:commentId/replies', optionalAuthenticate, getCommentReplies);
router.post('/comments/:commentId/react', authenticate, writeLimiter, reactToComment);
router.post('/comments/:commentId/report', authenticate, writeLimiter, validateBody(reportCommentSchema), reportComment);
router.post('/comments/:commentId/poll/vote', authenticate, writeLimiter, validateBody(pollVoteSchema), voteCommentPoll);
router.delete('/comments/:commentId', authenticate, deleteComment);

export default router;
