import { Router } from 'express';
import multer from 'multer';
import {
  getProfile,
  updateProfile,
  uploadAvatar,
  searchPeople,
  getTasteProfile,
  updateTasteProfile,
  updateSubscribedServices,
  completeOnboarding,
  getConnections,
  getUserSuggestions,
  getNotifications,
  requestConnection,
  respondToConnection,
  removeConnection,
} from '../controllers/user.controller';
import { authenticate, optionalAuthenticate } from '../middleware/auth.middleware';
import { validateBody } from '../middleware/validate.middleware';
import { updateProfileSchema } from '../validation/schemas';
import { writeLimiter } from '../middleware/rateLimit.middleware';

const router = Router();

// Images are buffered in memory only long enough to inspect the bytes, then
// uploaded to Supabase Storage from the server.
const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 },
});

router.get('/notifications', optionalAuthenticate, getNotifications);
router.get('/suggestions', optionalAuthenticate, getUserSuggestions);
router.get('/search', optionalAuthenticate, searchPeople);
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, validateBody(updateProfileSchema), updateProfile);
router.post('/avatar', authenticate, writeLimiter, avatarUpload.single('avatar'), uploadAvatar);
// No :userId segment -> the controller falls back to the signed-in member.
router.get('/connections', authenticate, getConnections);
router.get('/:userId/profile', optionalAuthenticate, getProfile);
router.get('/:userId/connections', optionalAuthenticate, getConnections);
router.get('/taste-profile', authenticate, getTasteProfile);
router.put('/taste-profile', authenticate, updateTasteProfile);
router.put('/subscribed-services', authenticate, updateSubscribedServices);
router.post('/onboarding', authenticate, completeOnboarding);
router.post('/connections/request', authenticate, requestConnection);
router.post('/connections/respond', authenticate, respondToConnection);
router.delete('/connections/:targetUserId', authenticate, removeConnection);

export default router;
