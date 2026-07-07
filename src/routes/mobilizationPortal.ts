import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { MobilizationRosterService } from '../services/MobilizationRosterService';
import logger from '../config/logger';

const router = Router();

router.get('/my/events', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const events = await MobilizationRosterService.listMyMobilizerEvents(req.user!.id);
    res.json({ events });
  } catch (error) {
    logger.error('Mobilization my events error:', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
