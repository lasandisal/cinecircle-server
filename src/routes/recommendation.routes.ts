import { Router } from 'express';
import {
  getSoloRecommendation,
  handleDecisionFatigue,
} from '../controllers/recommendation.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.post('/solo', authenticate, getSoloRecommendation);
router.post('/fatigue', authenticate, handleDecisionFatigue);

export default router;
