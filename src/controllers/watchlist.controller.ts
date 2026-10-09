import { Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import { sendSuccess } from '../utils/response';

export const getWatchlist = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Retrieve user's watchlist
    sendSuccess(res, { watchlist: [] }, 'Watchlist retrieved');
  } catch (error) {
    next(error);
  }
};

export const addToWatchlist = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Add title to watchlist
    sendSuccess(res, { item: null }, 'Title added to watchlist', 201);
  } catch (error) {
    next(error);
  }
};

export const markAsWatched = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Tick title as watched & create WatchHistory record
    sendSuccess(res, { item: null }, 'Marked as watched');
  } catch (error) {
    next(error);
  }
};

export const rateTitle = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Rate 1-5 stars & update WatchHistory
    sendSuccess(res, { item: null }, 'Rating recorded');
  } catch (error) {
    next(error);
  }
};
