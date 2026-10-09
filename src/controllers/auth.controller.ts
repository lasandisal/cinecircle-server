import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, TasteProfile } from '../models';
import { ENV } from '../config/env';
import { IAuthRequest } from '../types';
import { AppError } from '../middleware/error.middleware';
import { sendSuccess } from '../utils/response';

/**
 * Generate JWT token helper
 */
const generateToken = (id: string, email: string, role: string): string => {
  return jwt.sign({ id, email, role }, ENV.JWT_SECRET, {
    expiresIn: (ENV.JWT_EXPIRES_IN || '7d') as any,
  });
};


/**
 * Register a new user
 * POST /api/auth/register
 */
export const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password) {
      return next(new AppError('Name, email, and password are required.', 400));
    }

    if (password.length < 6) {
      return next(new AppError('Password must be at least 6 characters long.', 400));
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return next(new AppError('Please provide a valid email address.', 400));
    }

    const existingUser = await User.findOne({ email: email.toLowerCase().trim() });
    if (existingUser) {
      return next(new AppError('An account with this email already exists.', 409));
    }

    // Hash password with bcryptjs
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user (default role is 'user', but allows 'admin' if explicitly assigned during development)
    const user = new User({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      passwordHash,
      role: role === 'admin' ? 'admin' : 'user',
      subscribedServices: [],
      fatigueCount: 0,
    });

    await user.save();

    // Automatically initialize linked TasteProfile for onboarding
    const tasteProfile = await TasteProfile.create({
      user: user._id,
      favoriteGenres: [],
      favoriteTitles: [],
      exclusions: [],
    });

    user.tasteProfile = tasteProfile._id;
    await user.save();

    const token = generateToken(user._id.toString(), user.email, user.role);

    sendSuccess(
      res,
      {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          subscribedServices: user.subscribedServices,
          fatigueCount: user.fatigueCount,
          tasteProfile: user.tasteProfile,
        },
        token,
      },
      'User registered successfully.',
      201
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Log in existing user
 * POST /api/auth/login
 */
export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return next(new AppError('Email and password are required.', 400));
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() }).populate('tasteProfile');
    if (!user) {
      return next(new AppError('Invalid email or password.', 401));
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      return next(new AppError('Invalid email or password.', 401));
    }

    const token = generateToken(user._id.toString(), user.email, user.role);

    sendSuccess(
      res,
      {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          subscribedServices: user.subscribedServices,
          fatigueCount: user.fatigueCount,
          tasteProfile: user.tasteProfile,
        },
        token,
      },
      'Login successful.'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Get current authenticated user profile
 * GET /api/auth/me
 */
export const getMe = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      return next(new AppError('Unauthorized.', 401));
    }

    const user = await User.findById(req.user.id)
      .select('-passwordHash')
      .populate('tasteProfile');

    if (!user) {
      return next(new AppError('User not found.', 404));
    }

    sendSuccess(res, { user }, 'Current user retrieved successfully.');
  } catch (error) {
    next(error);
  }
};

/**
 * Refresh JWT Token
 * POST /api/auth/refresh
 */
export const refreshToken = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      return next(new AppError('Unauthorized.', 401));
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      return next(new AppError('User not found.', 404));
    }

    const newToken = generateToken(user._id.toString(), user.email, user.role);

    sendSuccess(res, { token: newToken }, 'Token refreshed successfully.');
  } catch (error) {
    next(error);
  }
};
