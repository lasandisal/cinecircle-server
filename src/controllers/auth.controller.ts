import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { User, TasteProfile, Otp } from '../models';
import { ENV } from '../config/env';
import { IAuthRequest } from '../types';
import { AppError } from '../middleware/error.middleware';
import { sendSuccess } from '../utils/response';
import { EmailService } from '../services/EmailService';

/**
 * Generate JWT token helper
 */
const generateToken = (id: string, email: string, role: string): string => {
  return jwt.sign({ id, email, role }, ENV.JWT_SECRET, {
    expiresIn: (ENV.JWT_EXPIRES_IN || '7d') as any,
  });
};

/**
 * Send 6-digit OTP verification code via Brevo email
 * POST /api/auth/send-otp
 */
export const sendOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, type = 'register' } = req.body;

    if (!email || typeof email !== 'string') {
      return next(new AppError('Please provide a valid email address.', 400));
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = email.toLowerCase().trim();

    if (!emailRegex.test(cleanEmail)) {
      return next(new AppError('Please provide a valid email address.', 400));
    }

    if (type === 'register') {
      const existing = await User.findOne({ email: cleanEmail });
      if (existing) {
        return next(new AppError('An account with this email already exists.', 409));
      }
    } else if (type === 'login') {
      const existing = await User.findOne({ email: cleanEmail });
      if (!existing) {
        return next(new AppError('No account found with this email.', 404));
      }
    }

    // Rate limiting: enforce a 30s cooldown between code dispatches
    const existingOtp = await Otp.findOne({ email: cleanEmail });
    if (existingOtp) {
      const elapsedMs = Date.now() - new Date(existingOtp.createdAt).getTime();
      if (elapsedMs < 30000) {
        const waitSec = Math.ceil((30000 - elapsedMs) / 1000);
        return next(new AppError(`Please wait ${waitSec}s before requesting a new code.`, 429));
      }
    }

    // Generate cryptographic 6-digit numeric code
    const plainOtp = Math.floor(100000 + Math.random() * 900000).toString();
    const salt = await bcrypt.genSalt(10);
    const otpHash = await bcrypt.hash(plainOtp, salt);

    await Otp.findOneAndUpdate(
      { email: cleanEmail },
      {
        email: cleanEmail,
        otpHash,
        type,
        verified: false,
        attempts: 0,
        createdAt: new Date(),
      },
      { upsert: true, new: true }
    );

    const emailResult = await EmailService.sendVerificationOtp(cleanEmail, plainOtp, type as any);

    sendSuccess(
      res,
      {
        email: cleanEmail,
        type,
        devCode: emailResult.devCode,
      },
      'Verification code sent successfully to your email.'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Verify 6-digit OTP code
 * POST /api/auth/verify-otp
 */
export const verifyOtp = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return next(new AppError('Email and 6-digit verification code are required.', 400));
    }

    const cleanEmail = email.toLowerCase().trim();
    const record = await Otp.findOne({ email: cleanEmail });

    if (!record) {
      return next(
        new AppError('Verification code has expired or was not requested. Please request a new code.', 400)
      );
    }

    if (record.attempts >= 5) {
      await Otp.deleteOne({ email: cleanEmail });
      return next(new AppError('Too many failed attempts. Please request a new verification code.', 429));
    }

    const isMatch = await bcrypt.compare(String(otp).trim(), record.otpHash);
    if (!isMatch) {
      record.attempts += 1;
      await record.save();
      return next(new AppError('Invalid verification code. Please check your email and try again.', 400));
    }

    record.verified = true;
    await record.save();

    sendSuccess(res, { verified: true, email: cleanEmail }, 'Email verified successfully.');
  } catch (error) {
    next(error);
  }
};

/**
 * Register a new user with OTP verification
 * POST /api/auth/register
 */
export const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, email, password, otp, role } = req.body;

    if (!name || !email || !password) {
      return next(new AppError('Name, email, and password are required.', 400));
    }

    if (password.length < 6) {
      return next(new AppError('Password must be at least 6 characters long.', 400));
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = email.toLowerCase().trim();

    if (!emailRegex.test(cleanEmail)) {
      return next(new AppError('Please provide a valid email address.', 400));
    }

    const existingUser = await User.findOne({ email: cleanEmail });
    if (existingUser) {
      return next(new AppError('An account with this email already exists.', 409));
    }

    // Verify OTP requirement
    const otpRecord = await Otp.findOne({ email: cleanEmail });
    if (!otpRecord) {
      return next(new AppError('Email verification required. Please request a verification code.', 400));
    }

    let isOtpValid = otpRecord.verified;
    if (!isOtpValid && otp) {
      isOtpValid = await bcrypt.compare(String(otp).trim(), otpRecord.otpHash);
    }

    if (!isOtpValid) {
      return next(new AppError('Invalid or unverified email code. Please enter the 6-digit code sent to your email.', 400));
    }

    // Clean up OTP record upon successful registration
    await Otp.deleteOne({ email: cleanEmail });

    // Hash password with bcryptjs
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user
    const user = new User({
      name: name.trim(),
      email: cleanEmail,
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
      'User registered and email verified successfully.',
      201
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Log in existing user (supports password or OTP)
 * POST /api/auth/login
 */
export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { email, password, otp } = req.body;

    if (!email || (!password && !otp)) {
      return next(new AppError('Email and either password or verification code are required.', 400));
    }

    const cleanEmail = email.toLowerCase().trim();
    const user = await User.findOne({ email: cleanEmail }).populate('tasteProfile');
    if (!user) {
      return next(new AppError('Invalid email or credentials.', 401));
    }

    if (otp) {
      // OTP passwordless verification
      const otpRecord = await Otp.findOne({ email: cleanEmail, type: 'login' });
      if (!otpRecord) {
        return next(new AppError('Verification code has expired. Please request a new code.', 400));
      }
      const isOtpMatch = await bcrypt.compare(String(otp).trim(), otpRecord.otpHash);
      if (!isOtpMatch) {
        return next(new AppError('Invalid verification code.', 400));
      }
      await Otp.deleteOne({ email: cleanEmail });
    } else {
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return next(new AppError('Invalid email or password.', 401));
      }
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
