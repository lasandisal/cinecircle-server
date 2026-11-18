import { Router } from 'express';
import {
  register,
  login,
  logout,
  getMe,
  refreshToken,
  issueSocketToken,
  sendOtp,
  verifyOtp,
} from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';
import {
  loginSchema,
  registerSchema,
  sendOtpSchema,
  verifyOtpSchema,
} from '../validation/schemas';
import {
  authLimiter,
  otpSendLimiter,
  otpVerifyLimiter,
} from '../middleware/rateLimit.middleware';

const router = Router();

router.post('/send-otp', otpSendLimiter, validateBody(sendOtpSchema), sendOtp);
router.post('/verify-otp', otpVerifyLimiter, validateBody(verifyOtpSchema), verifyOtp);
router.post('/register', authLimiter, validateBody(registerSchema), register);
router.post('/login', authLimiter, validateBody(loginSchema), login);
router.post('/logout', logout);
router.get('/me', authenticate, getMe);
router.get('/socket-token', authenticate, issueSocketToken);
router.post('/refresh', authenticate, refreshToken);

export default router;
