import { Router } from 'express';
import {
  getProfile,
  updateProfile,
  searchPeople,
  getTasteProfile,
  updateTasteProfile,
  updateSubscribedServices,
  completeOnboarding,
  toggleFollow,
  getConnections,
  getUserSuggestions,
  getNotifications,
  requestConnection,
  respondToConnection,
} from '../controllers/user.controller';
import { authenticate, optionalAuthenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/notifications', optionalAuthenticate, getNotifications);
router.get('/suggestions', optionalAuthenticate, getUserSuggestions);
router.get('/search', optionalAuthenticate, searchPeople);
router.get('/profile', authenticate, getProfile);
router.put('/profile', authenticate, updateProfile);
// No :userId segment -> the controller falls back to the signed-in member.
router.get('/connections', authenticate, getConnections);
router.get('/:userId/profile', optionalAuthenticate, getProfile);
router.get('/:userId/connections', optionalAuthenticate, getConnections);
router.get('/taste-profile', authenticate, getTasteProfile);
router.put('/taste-profile', authenticate, updateTasteProfile);
router.put('/subscribed-services', authenticate, updateSubscribedServices);
router.post('/onboarding', authenticate, completeOnboarding);
router.post('/follow', authenticate, toggleFollow);
router.post('/connections/request', authenticate, requestConnection);
router.post('/connections/respond', authenticate, respondToConnection);

export default router;
