import { Request, Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import { sendSuccess } from '../utils/response';

export const searchTitles = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: TMDB search integration
    sendSuccess(res, { results: [] }, 'Titles searched');
  } catch (error) {
    next(error);
  }
};

export const getTitleDetails = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: TMDB detail, synopsis, seasons, episodes, cast
    sendSuccess(res, { title: null }, 'Title details retrieved');
  } catch (error) {
    next(error);
  }
};

export const addComment = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Add comment to title
    sendSuccess(res, { comment: null }, 'Comment added', 201);
  } catch (error) {
    next(error);
  }
};

export const getComments = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: List title comments
    sendSuccess(res, { comments: [] }, 'Comments retrieved');
  } catch (error) {
    next(error);
  }
};
