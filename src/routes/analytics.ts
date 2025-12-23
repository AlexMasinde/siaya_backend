import { Router } from 'express';
import { AnalyticsController } from '../controllers/AnalyticsController';
import { authenticate, requireSuperAdmin } from '../middleware/auth';

import { asyncHandler } from '../utils/asyncHandler';

const router = Router();

// Get hierarchical events stats
// Access: Super Admin only
router.get(
  '/hierarchy/:eventId',
  authenticate,
  requireSuperAdmin,
  asyncHandler(AnalyticsController.getEventHierarchyStats)
);

export default router;
