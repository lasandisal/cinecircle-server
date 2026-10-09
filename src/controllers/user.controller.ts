import { Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import { sendSuccess } from '../utils/response';

export const getProfile = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Profile retrieval with mutual-watched comparisons
    sendSuccess(res, { profile: null }, 'User profile retrieved');
  } catch (error) {
    next(error);
  }
};

export const updateTasteProfile = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: TasteProfile onboarding and updates
    sendSuccess(res, { tasteProfile: null }, 'Taste profile updated');
  } catch (error) {
    next(error);
  }
};

export const updateSubscribedServices = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: User streaming services updates
    sendSuccess(res, { subscribedServices: [] }, 'Subscribed services updated');
  } catch (error) {
    next(error);
  }
};

export const toggleFollow = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Follow/unfollow user or title
    sendSuccess(res, { following: true }, 'Follow status updated');
  } catch (error) {
    next(error);
  }
};
