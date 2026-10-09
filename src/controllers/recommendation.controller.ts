import { Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import { sendSuccess } from '../utils/response';

export const getSoloRecommendation = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Solo recommendation scoring algorithm
    // Blends tasteProfile, mood, availableTime, and owned services bonus
    sendSuccess(res, { shortlist: [] }, 'Solo recommendations generated');
  } catch (error) {
    next(error);
  }
};

export const handleDecisionFatigue = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Increment fatigue count and narrow future shortlists
    sendSuccess(res, { fatigueCount: 0 }, 'Fatigue count updated');
  } catch (error) {
    next(error);
  }
};
