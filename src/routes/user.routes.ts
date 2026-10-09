import { Router } from 'express';
import {
  getProfile,
  updateTasteProfile,
  updateSubscribedServices,
  toggleFollow,
} from '../controllers/user.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

router.get('/:userId/profile', authenticate, getProfile);
router.put('/taste-profile', authenticate, updateTasteProfile);
router.put('/subscribed-services', authenticate, updateSubscribedServices);
router.post('/follow', authenticate, toggleFollow);

export default router;
