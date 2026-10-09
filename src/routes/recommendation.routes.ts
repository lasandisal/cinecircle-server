import { Router } from 'express';
import {
  getSoloRecommendation,
  handleDecisionFatigue,
} from '../controllers/recommendation.controller';
import { optionalAuthenticate, authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/solo', optionalAuthenticate, getSoloRecommendation);
router.post('/solo', optionalAuthenticate, getSoloRecommendation);
router.post('/fatigue', authenticate, handleDecisionFatigue);

export default router;
