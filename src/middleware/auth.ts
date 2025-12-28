import { Request, Response, NextFunction } from 'express';
import { verifyToken, TokenPayload } from '../utils/auth';
import { AppDataSource } from '../config/database';
import { User, UserRole } from '../entities/User';

export interface AuthRequest extends Request {
  user?: User;
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    try {
      const decoded = verifyToken(token) as TokenPayload;
      
      const userRepository = AppDataSource.getRepository(User);
      const user = await userRepository.findOne({
        where: { id: decoded.userId },
      });

      if (!user) {
        res.status(401).json({ message: 'User found in token no longer exists' });
        return;
      }

      req.user = user;
      next();
    } catch (error) {
      res.status(401).json({ message: 'Invalid or expired token' });
      return;
    }
  } catch (error) {
    res.status(500).json({ message: 'Internal server error during authentication' });
  }
};

export const requireAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  // Check both enum value and string value for compatibility
  const role = req.user.role as string;
  if (role !== UserRole.ADMIN && role !== UserRole.SUPER_ADMIN && role !== 'admin' && role !== 'super_admin') {
    res.status(403).json({ message: 'Admin access required' });
    return;
  }

  next();
};

export const requireSuperAdmin = (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void => {
  if (!req.user) {
    res.status(401).json({ message: 'Unauthorized' });
    return;
  }

  // Check both enum value and string value for compatibility
  const role = req.user.role as string;
  if (role !== UserRole.SUPER_ADMIN && role !== 'super_admin') {
    res.status(403).json({ message: 'Super Admin access required' });
    return;
  }

  next();
};
