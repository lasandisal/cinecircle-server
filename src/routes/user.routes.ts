import { Router } from 'express';
import {
  getProfile,
  updateProfile,
  searchPeople,
  updateTasteProfile,
  updateSubscribedServices,
  completeOnboarding,
  toggleFollow,
  getUserSuggestions,
  getNotifications,
} from '../controllers/user.controller';
import { authenticate, optionalAuthenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/notifications', optionalAuthenticate, getNotifications);
router.get('/suggestions', optionalAuthenticate, getUserSuggestions);
router.get('/search', optionalAuthenticate, searchPeople);
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
router.get('/:userId/profile', optionalAuthenticate, getProfile);
router.put('/taste-profile', authenticate, updateTasteProfile);
router.put('/subscribed-services', authenticate, updateSubscribedServices);
router.post('/onboarding', authenticate, completeOnboarding);
router.post('/follow', authenticate, toggleFollow);

export default router;
