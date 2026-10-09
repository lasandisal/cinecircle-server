import { Router } from 'express';
import { parseVibePrompt, generateGroupCompromisePitch } from '../controllers/ai.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Route to parse natural vibe prompts into structured parameters
router.post('/vibe-parse', authenticate, parseVibePrompt);

// Route to generate AI group compromise pitch
router.post('/compromise-pitch', authenticate, generateGroupCompromisePitch);

export default router;
