import { Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import { sendSuccess } from '../utils/response';

export const createSession = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Create group session and generate joinCode
    sendSuccess(res, { session: null, joinCode: 'XXXXXX' }, 'Group session created', 201);
  } catch (error) {
    next(error);
  }
};

export const joinSession = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Join group session via joinCode
    sendSuccess(res, { session: null }, 'Joined session successfully');
  } catch (error) {
    next(error);
  }
};

export const submitVote = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Submit vote reaction (yes/no) and strength (1-5)
    sendSuccess(res, { vote: null }, 'Vote recorded');
  } catch (error) {
    next(error);
  }
};

export const lockSessionPick = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Calculate weighted compromise score and finalize pick
    sendSuccess(res, { finalPick: null }, 'Session finalized');
  } catch (error) {
    next(error);
  }
};
