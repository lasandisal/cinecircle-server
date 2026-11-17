import { z } from 'zod';

/**
 * Request body schemas.
 *
 * Controllers still perform their business checks (uniqueness, ownership,
 * OTP validity). These schemas only guarantee that whatever reaches the
 * controller has the right shape, type and length - so no handler has to
 * trust `req.body`.
 */

const emailField = z
  .string()
  .trim()
  .email('Please provide a valid email address.')
  .max(254, 'Email address is too long.')
  .transform((value) => value.toLowerCase());

const otpField = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit verification code.');

const passwordField = z
  .string()
  .min(6, 'Password must be at least 6 characters long.')
  .max(128, 'Password is too long.');

export const sendOtpSchema = z.object({
  email: emailField,
  type: z.enum(['register', 'login'], {
    message: 'Type must be either register or login.',
  }).optional(),
});

export const verifyOtpSchema = z.object({
  email: emailField,
  otp: otpField,
});

export const registerSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(80, 'Name is too long.'),
  email: emailField,
  password: passwordField,
  otp: otpField.optional(),
  bio: z.string().trim().max(180, 'Bio must be 180 characters or fewer.').optional(),
});

export const loginSchema = z
  .object({
    email: emailField,
    password: z.string().min(1, 'Password is required.').max(128).optional(),
    otp: otpField.optional(),
  })
  .refine((data) => Boolean(data.password || data.otp), {
    message: 'Email and either password or verification code are required.',
    path: ['password'],
  });

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1, 'Name is required.').max(80, 'Name is too long.').optional(),
  bio: z.string().trim().max(180, 'Bio must be 180 characters or fewer.').optional(),
  handle: z
    .string()
    .trim()
    .max(30, 'Handle is too long.')
    .regex(/^@?[a-zA-Z0-9_.]{3,30}$/, 'Handle may only contain letters, numbers, dots and underscores.')
    .optional(),
  avatar: z.string().trim().max(2048, 'Avatar URL is too long.').optional(),
  subscribedServices: z.array(z.string().trim().max(60)).max(20).optional(),
  favoriteGenres: z.array(z.string().trim().max(60)).max(30).optional(),
  exclusions: z.array(z.string().trim().max(60)).max(30).optional(),
  favoriteTitles: z.array(z.string().trim().max(64)).max(100).optional(),
});

export const commentSchema = z.object({
  text: z
    .string()
    .trim()
    .min(1, 'Comment cannot be empty.')
    .max(2000, 'Comment must be 2000 characters or fewer.'),
  rating: z.coerce.number().min(0).max(5).optional(),
  containsSpoilers: z.boolean().optional(),
  parentId: z.string().trim().max(64).nullish(),
  poll: z
    .object({
      question: z.string().trim().min(1, 'Poll question is required.').max(200, 'Poll question is too long.'),
      options: z
        .array(z.string().trim().min(1, 'Poll options cannot be empty.').max(100, 'Poll option is too long.'))
        .min(2, 'A poll needs at least two options.')
        .max(4, 'A poll can have at most four options.'),
    })
    .optional(),
});

export const reportCommentSchema = z.object({
  reason: z.string().trim().max(280, 'Reason must be 280 characters or fewer.').optional(),
});

export const pollVoteSchema = z.object({
  optionIndex: z.coerce
    .number()
    .int('Option index must be a whole number.')
    .min(0, 'Option index is invalid.')
    .max(10, 'Option index is invalid.'),
});

export const avatarUploadSchema = z.object({
  // The file itself is validated by multer + magic-byte sniffing; this only
  // documents that no other body fields are accepted.
});
