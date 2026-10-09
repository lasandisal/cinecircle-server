import { Router } from 'express';
import { register, login, getMe, refreshToken, sendOtp, verifyOtp } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.post('/send-otp', sendOtp);
router.post('/verify-otp', verifyOtp);
router.post('/register', register);
router.post('/login', login);
router.get('/me', authenticate, getMe);
router.post('/refresh', authenticate, refreshToken);

export default router;
