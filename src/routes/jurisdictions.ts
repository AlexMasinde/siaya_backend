import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { JurisdictionService } from '../services/JurisdictionService';
import logger from '../config/logger';

const router = Router();

router.get('/counties', authenticate, async (_req: Request, res: Response): Promise<void> => {
  try {
    const counties = await JurisdictionService.getCounties();
    res.json({ data: counties });
  } catch (error) {
    logger.error('Get counties error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/constituencies', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { county } = req.query;
    if (!county || typeof county !== 'string') {
      res.status(400).json({ message: 'county query parameter is required' });
      return;
    }
    const constituencies = await JurisdictionService.getConstituencies(county);
    res.json({ data: constituencies });
  } catch (error) {
    logger.error('Get constituencies error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/wards', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { constituency, county } = req.query;
    if (!constituency || typeof constituency !== 'string') {
      res.status(400).json({ message: 'constituency query parameter is required' });
      return;
    }
    const wards = await JurisdictionService.getWards(
      constituency,
      typeof county === 'string' ? county : undefined
    );
    res.json({ data: wards });
  } catch (error) {
    logger.error('Get wards error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

router.get('/polling-centers', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { constituency, ward } = req.query;
    if (!constituency || typeof constituency !== 'string' || !ward || typeof ward !== 'string') {
      res.status(400).json({ message: 'constituency and ward query parameters are required' });
      return;
    }
    const centers = await JurisdictionService.getPollingCenters(constituency, ward);
    res.json({ data: centers });
  } catch (error) {
    logger.error('Get polling centers error:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

export default router;
