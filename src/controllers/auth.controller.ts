import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import prisma from '../config/prisma';
import { ENV } from '../config/env';
import { IAuthRequest } from '../types';
import { AppError } from '../middleware/error.middleware';
import { sendSuccess } from '../utils/response';
import { EmailService } from '../services/email.service';
import { clearAuthCookie, setAuthCookie } from '../utils/authCookie';

const MAX_OTP_ATTEMPTS = 5;

/**
 * Generate JWT token helper
 */
const generateToken = (id: string, email: string, role: string): string => {
  return jwt.sign({ id, email, role }, ENV.JWT_SECRET, {
    expiresIn: (ENV.JWT_EXPIRES_IN || '7d') as any,
  });
};

/**
 * A code is unusable when it has no expiry (legacy row) or the expiry passed.
 */
const isOtpExpired = (record: { expiresAt: Date | null }): boolean =>
  !record.expiresAt || record.expiresAt.getTime() <= Date.now();

const otpExpiryDate = (): Date => new Date(Date.now() + ENV.OTP_TTL_MINUTES * 60_000);

const deleteOtpsForEmail = async (email: string): Promise<void> => {
  await prisma.otp.deleteMany({ where: { email } });
};

/**
 * Format user for API responses (providing both id and _id for backwards compatibility)
 */
export const formatUserResponse = (user: any) => {
  const onboarded = Boolean(
    user.onboarded ||
    (user.tasteProfile && Array.isArray(user.tasteProfile.favoriteGenres) && user.tasteProfile.favoriteGenres.length > 0)
  );

  return {
    id: user.id,
    _id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    avatar: user.avatar,
    handle: user.handle,
    bio: user.bio,
    subscribedServices: user.subscribedServices || [],
    fatigueCount: user.fatigueCount || 0,
    tasteProfile: user.tasteProfile || null,
    onboarded,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
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
      const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
      if (existing) {
        return next(new AppError('An account with this email already exists.', 409));
      }
    } else if (type === 'login') {
      const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
      if (!existing) {
        return next(new AppError('No account found with this email.', 404));
      }
    }

    // Drop codes that are already past their hard expiry (legacy rows with no
    // expiresAt included) so they can neither be used nor trigger the cooldown.
    await prisma.otp.deleteMany({
      where: {
        email: cleanEmail,
        OR: [{ expiresAt: null }, { expiresAt: { lt: new Date() } }],
      },
    });

    // Rate limiting: enforce a 30s cooldown between code dispatches
    const existingOtp = await prisma.otp.findFirst({
      where: { email: cleanEmail },
      orderBy: { createdAt: 'desc' },
    });

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

    // Clean previous codes for this email and insert new code
    await deleteOtpsForEmail(cleanEmail);
    await prisma.otp.create({
      data: {
        email: cleanEmail,
        otpHash,
        type,
        verified: false,
        attempts: 0,
        expiresAt: otpExpiryDate(),
      },
    });

    const emailResult = await EmailService.sendVerificationOtp(cleanEmail, plainOtp, type as any);

    sendSuccess(
      res,
      {
        email: cleanEmail,
        type,
        expiresInMinutes: ENV.OTP_TTL_MINUTES,
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
    const record = await prisma.otp.findFirst({
      where: { email: cleanEmail },
      orderBy: { createdAt: 'desc' },
    });

    if (!record) {
      return next(
        new AppError('Verification code has expired or was not requested. Please request a new code.', 400)
      );
    }

    if (isOtpExpired(record)) {
      await deleteOtpsForEmail(cleanEmail);
      return next(new AppError('Verification code has expired. Please request a new code.', 400));
    }

    if (record.attempts >= MAX_OTP_ATTEMPTS) {
      await deleteOtpsForEmail(cleanEmail);
      return next(new AppError('Too many failed attempts. Please request a new verification code.', 429));
    }

    const isMatch = await bcrypt.compare(String(otp).trim(), record.otpHash);
    if (!isMatch) {
      await prisma.otp.update({
        where: { id: record.id },
        data: { attempts: record.attempts + 1 },
      });
      return next(new AppError('Invalid verification code. Please check your email and try again.', 400));
    }

    await prisma.otp.update({
      where: { id: record.id },
      data: { verified: true },
    });

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
    const { name, email, password, otp, bio } = req.body;

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

    const existingUser = await prisma.user.findUnique({ where: { email: cleanEmail } });
    if (existingUser) {
      return next(new AppError('An account with this email already exists.', 409));
    }

    // Verify OTP requirement
    const otpRecord = await prisma.otp.findFirst({
      where: { email: cleanEmail },
      orderBy: { createdAt: 'desc' },
    });

    if (!otpRecord) {
      return next(new AppError('Email verification required. Please request a verification code.', 400));
    }

    if (isOtpExpired(otpRecord)) {
      await deleteOtpsForEmail(cleanEmail);
      return next(new AppError('Verification code has expired. Please request a new code.', 400));
    }

    if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
      await deleteOtpsForEmail(cleanEmail);
      return next(new AppError('Too many failed attempts. Please request a new verification code.', 429));
    }

    let isOtpValid = otpRecord.verified;
    if (!isOtpValid && otp) {
      isOtpValid = await bcrypt.compare(String(otp).trim(), otpRecord.otpHash);
      if (!isOtpValid) {
        await prisma.otp.update({
          where: { id: otpRecord.id },
          data: { attempts: otpRecord.attempts + 1 },
        });
      }
    }

    if (!isOtpValid) {
      return next(new AppError('Invalid or unverified email code. Please enter the 6-digit code sent to your email.', 400));
    }

    // Clean up OTP record upon successful registration
    await deleteOtpsForEmail(cleanEmail);

    // Hash password with bcryptjs
    const salt = await bcrypt.genSalt(10);
    const passwordHash = await bcrypt.hash(password, salt);

    // Create user and initialize tasteProfile
    const user = await prisma.user.create({
      data: {
        name: name.trim(),
        email: cleanEmail,
        passwordHash,
        role: 'user',
        bio: typeof bio === 'string' ? bio.trim().slice(0, 180) : '',
        subscribedServices: [],
        fatigueCount: 0,
        tasteProfile: {
          create: {
            favoriteGenres: [],
            favoriteTitleIds: [],
            exclusions: [],
          },
        },
      },
      include: {
        tasteProfile: true,
      },
    });

    const token = generateToken(user.id, user.email, user.role);
    setAuthCookie(res, token);

    sendSuccess(
      res,
      {
        user: formatUserResponse(user),
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
    const user = await prisma.user.findUnique({
      where: { email: cleanEmail },
      include: { tasteProfile: true },
    });

    if (!user) {
      return next(new AppError('Invalid email or credentials.', 401));
    }

    if (otp) {
      // OTP passwordless verification
      const otpRecord = await prisma.otp.findFirst({
        where: { email: cleanEmail, type: 'login' },
        orderBy: { createdAt: 'desc' },
      });

      if (!otpRecord) {
        return next(new AppError('Verification code has expired. Please request a new code.', 400));
      }

      if (isOtpExpired(otpRecord)) {
        await deleteOtpsForEmail(cleanEmail);
        return next(new AppError('Verification code has expired. Please request a new code.', 400));
      }

      if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
        await deleteOtpsForEmail(cleanEmail);
        return next(new AppError('Too many failed attempts. Please request a new verification code.', 429));
      }

      const isOtpMatch = await bcrypt.compare(String(otp).trim(), otpRecord.otpHash);
      if (!isOtpMatch) {
        await prisma.otp.update({
          where: { id: otpRecord.id },
          data: { attempts: otpRecord.attempts + 1 },
        });
        return next(new AppError('Invalid verification code.', 400));
      }

      await deleteOtpsForEmail(cleanEmail);
    } else {
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return next(new AppError('Invalid email or password.', 401));
      }
    }

    const token = generateToken(user.id, user.email, user.role);
    setAuthCookie(res, token);

    sendSuccess(
      res,
      {
        user: formatUserResponse(user),
      },
      'Login successful.'
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Clear the session cookie
 * POST /api/auth/logout
 */
export const logout = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    clearAuthCookie(res);
    sendSuccess(res, {}, 'Logged out successfully.');
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

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { tasteProfile: true },
    });

    if (!user) {
      return next(new AppError('User not found.', 404));
    }

    sendSuccess(res, { user: formatUserResponse(user) }, 'Current user retrieved successfully.');
  } catch (error) {
    next(error);
  }
};

/**
 * Refresh JWT Token (re-issues the cookie before it expires)
 * POST /api/auth/refresh
 */
export const refreshToken = async (req: IAuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!req.user) {
      return next(new AppError('Unauthorized.', 401));
    }

    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
    });

    if (!user) {
      return next(new AppError('User not found.', 404));
    }

    const newToken = generateToken(user.id, user.email, user.role);
    setAuthCookie(res, newToken);

    sendSuccess(res, {}, 'Token refreshed successfully.');
  } catch (error) {
    next(error);
  }
};
