import { Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import { AiService } from '../services/ai.service';
import { AppError } from '../middleware/error.middleware';
import { sendSuccess } from '../utils/response';

/**
 * Parse natural language watch requests via Gemini AI
 * POST /api/ai/vibe-parse
 */
export const parseVibePrompt = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { prompt } = req.body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return next(new AppError('Please provide a natural language prompt.', 400));
    }

    const result = await AiService.parseVibePrompt(prompt.trim());
    sendSuccess(res, result, 'Vibe parsed successfully with Gemini AI.');
  } catch (error) {
    next(error);
  }
};

/**
 * Generate charismatic group compromise pitch via Gemini AI
 * POST /api/ai/compromise-pitch
 */
export const generateGroupCompromisePitch = async (
  req: IAuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { roomName, winnerTitle, winnerSynopsis, participants } = req.body;

    if (!winnerTitle) {
      return next(new AppError('winnerTitle is required to generate compromise pitch.', 400));
    }

    const pitch = await AiService.generateGroupCompromisePitch({
      roomName: roomName || 'Watch Decision Room',
      winnerTitle,
      winnerSynopsis: winnerSynopsis || '',
      participants: Array.isArray(participants) ? participants : [],
    });

    sendSuccess(res, { pitch }, 'Group compromise pitch generated.');
  } catch (error) {
    next(error);
  }
};
