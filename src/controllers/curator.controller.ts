import { Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import { sendSuccess } from '../utils/response';

export const addCuratedSoundtrack = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Curator adds curated soundtrack item for flagship title
    sendSuccess(res, { soundtrack: null }, 'Soundtrack entry added', 201);
  } catch (error) {
    next(error);
  }
};

export const moderateComment = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Admin/curator reviews flagged comment (hide/dismiss)
    sendSuccess(res, { comment: null }, 'Comment moderation updated');
  } catch (error) {
    next(error);
  }
};

export const getFlaggedComments = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Get reported comments for curation
    sendSuccess(res, { reportedComments: [] }, 'Flagged comments retrieved');
  } catch (error) {
    next(error);
  }
};
