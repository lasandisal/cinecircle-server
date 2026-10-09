import { Request, Response, NextFunction } from 'express';
import { IAuthRequest } from '../types';
import { sendSuccess } from '../utils/response';

export const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Register user logic to be implemented
    sendSuccess(res, { message: 'Register endpoint skeleton' }, 'Registered successfully', 201);
  } catch (error) {
    next(error);
  }
};

export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Login user logic to be implemented
    sendSuccess(res, { token: 'jwt_token_skeleton' }, 'Login successful');
  } catch (error) {
    next(error);
  }
};

export const getMe = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Skeleton: Current user logic to be implemented
    sendSuccess(res, { user: req.user }, 'Current user retrieved');
  } catch (error) {
    next(error);
  }
};
