import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { User, UserRole } from '../entities/User';
import {
  generateAccessToken,
  generateRefreshToken,
  hashPassword,
  comparePassword,
  verifyToken,
  TokenPayload,
} from '../utils/auth';
import { AuthRequest, authenticate, requireAdmin, requireSuperAdmin } from '../middleware/auth';
import logger from '../config/logger';
import { env } from '../config/env';
import { smsService } from '../services/sms';

const router = Router();

// Helper function to get cookie options based on environment
function getCookieOptions() {
  const isProduction = env.NODE_ENV === 'production';
  
  // Cookie options for cross-origin authentication
  // Note: We don't set the 'domain' attribute because mobile browsers (especially iOS Safari)
  // reject cookies with domain attribute when sameSite: 'none' is used.
  // Without domain, the cookie is scoped to the exact origin (events-api.uda.ke),
  // but sameSite: 'none' still allows it to be sent cross-origin to events.uda.ke
  const cookieOptions: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'none' | 'lax' | 'strict';
    maxAge: number;
    path: string;
  } = {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? ('none' as const) : ('lax' as const), // 'none' required for cross-origin API calls
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
  };

  return cookieOptions;
}

// Signup
router.post('/signup', async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, phoneNumber } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({
        message: 'Name, email, and password are required',
      });
      return;
    }

    const userRepository = AppDataSource.getRepository(User);

    // Check if user already exists
    const existingUser = await userRepository.findOne({
      where: { email },
    });

    if (existingUser) {
      res.status(400).json({ message: 'User with this email already exists' });
      return;
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create user
    const user = userRepository.create({
      name,
      email,
      password: hashedPassword,
      role: UserRole.USER,
      phoneNumber: phoneNumber || null,
    });

    await userRepository.save(user);

    // Generate tokens
    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Save refresh token to database
    user.refreshToken = refreshToken;
    await userRepository.save(user);

    // Set refresh token as http-only cookie
    res.cookie('refreshToken', refreshToken, getCookieOptions());

    res.status(201).json({
      message: 'User created successfully',
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    logger.error('Signup error:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Login
router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({
        message: 'Email and password are required',
      });
      return;
    }

    const userRepository = AppDataSource.getRepository(User);

    // Find user
    const user = await userRepository.findOne({
      where: { email },
    });

    if (!user) {
      res.status(401).json({ message: 'Invalid email or password' });
      return;
    }

    // Verify password
    const isPasswordValid = await comparePassword(password, user.password);

    if (!isPasswordValid) {
      res.status(401).json({ message: 'Invalid email or password' });
      return;
    }

    // Generate tokens
    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);

    // Save refresh token to database
    user.refreshToken = refreshToken;
    await userRepository.save(user);

    // Set refresh token as http-only cookie
    res.cookie('refreshToken', refreshToken, getCookieOptions());

    res.json({
      message: 'Login successful',
      accessToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error) {
    logger.error('Login error:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Refresh token
router.post('/refresh', async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshToken = req.cookies.refreshToken;

    if (!refreshToken) {
      res.status(401).json({ message: 'Refresh token not provided' });
      return;
    }

    // Verify refresh token
    const decoded = verifyToken(refreshToken) as TokenPayload;

    const userRepository = AppDataSource.getRepository(User);
    const user = await userRepository.findOne({
      where: { id: decoded.userId },
    });

    if (!user || user.refreshToken !== refreshToken) {
      res.status(401).json({ message: 'Invalid refresh token' });
      return;
    }

    // Generate new tokens
    const tokenPayload: TokenPayload = {
      userId: user.id,
      email: user.email,
      role: user.role,
    };

    const newAccessToken = generateAccessToken(tokenPayload);
    const newRefreshToken = generateRefreshToken(tokenPayload);

    // Update refresh token in database
    user.refreshToken = newRefreshToken;
    await userRepository.save(user);

    // Set new refresh token as http-only cookie
    res.cookie('refreshToken', newRefreshToken, getCookieOptions());

    res.json({
      message: 'Token refreshed successfully',
      accessToken: newAccessToken,
    });
  } catch (error) {
    logger.error('Refresh token error:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(401).json({ message: 'Invalid refresh token' });
  }
});

// Logout
router.post('/logout', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const userRepository = AppDataSource.getRepository(User);

    // Clear refresh token from database
    user.refreshToken = null;
    await userRepository.save(user);

    // Clear refresh token cookie (must use same options as setCookie)
    const clearCookieOptions = getCookieOptions();
    // Remove maxAge for clearCookie
    const { maxAge, ...clearOptions } = clearCookieOptions;
    res.clearCookie('refreshToken', clearOptions);

    res.json({ message: 'Logout successful' });
  } catch (error) {
    logger.error('Logout error:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ message: 'Internal server error' });
  }
});

// Helper function to generate random password
function generateRandomPassword(): string {
  const length = 12;
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  
  for (let i = 0; i < length; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  
  return password;
}

// Get users (Admin only) - returns users assigned to the admin, or all users for super admin
router.get(
  '/users',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const userRepository = AppDataSource.getRepository(User);

      // Parse pagination parameters
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      // Build query based on user role
      let queryBuilder = userRepository.createQueryBuilder('user')
        .select(['user.id', 'user.name', 'user.email', 'user.role', 'user.adminId', 'user.phoneNumber', 'user.createdAt'])
        .orderBy('user.createdAt', 'DESC');

      const userRole = req.user!.role as string;
      if (userRole === UserRole.SUPER_ADMIN || userRole === 'super_admin') {
        // Super admin sees all users (including other admins) - no additional where clause
      } else {
        // Regular admin sees only users assigned to them
        const adminId = req.user!.id;
        queryBuilder = queryBuilder.where('user.adminId = :adminId', { adminId });
      }

      // Get total count
      const total = await queryBuilder.getCount();

      // Get paginated results
      const users = await queryBuilder
        .skip(skip)
        .take(limit)
        .getMany();

      const totalPages = Math.ceil(total / limit);

      // For super admin, calculate role-based statistics
      let statistics = undefined;
      if (userRole === UserRole.SUPER_ADMIN || userRole === 'super_admin') {
        const totalAdmins = await userRepository.count({
          where: { role: UserRole.ADMIN },
        });
        const totalRegularUsers = await userRepository.count({
          where: { role: UserRole.USER },
        });
        statistics = {
          totalAdmins,
          totalRegularUsers,
        };
      }

      res.json({
        message: 'Users fetched successfully',
        users,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
        ...(statistics && { statistics }),
      });
    } catch (error) {
      logger.error('Get users error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Create user (Admin only)
router.post(
  '/users',
  authenticate,
  requireSuperAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { name, email, phoneNumber } = req.body;
      
      logger.info('Creating new user:', { name, email, phoneNumber });

      if (!name || !email || !phoneNumber) {
        res.status(400).json({
          message: 'Name, email, and phone number are required',
        });
        return;
      }

      const normalizedPhone = smsService.normalizePhoneNumber(phoneNumber);
      if (typeof normalizedPhone === 'object' && 'error' in normalizedPhone) {
        res.status(400).json({ message: 'Invalid phone number format' });
        return;
      }
      const displayPhone = `0${normalizedPhone.slice(3)}`;

      const userRepository = AppDataSource.getRepository(User);

      // Check if user already exists
      const existingUser = await userRepository.findOne({
        where: { email },
      });

      if (existingUser) {
        res.status(400).json({ message: 'User with this email already exists' });
        return;
      }

      // Generate random password
      const randomPassword = generateRandomPassword();
      const hashedPassword = await hashPassword(randomPassword);

      // Create user assigned to the creating admin
      const user = userRepository.create({
        name,
        email,
        password: hashedPassword,
        role: UserRole.USER,
        adminId: req.user!.id, // Assign to the creating admin
        phoneNumber: displayPhone,
      });

      await userRepository.save(user);

      // Send SMS with credentials
      const smsSent = await smsService.sendUserCredentials(
        displayPhone,
        email,
        randomPassword,
      );

      if (smsSent) {
        res.status(201).json({
          message: 'User created successfully. Login credentials have been sent to their phone number.',
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            adminId: user.adminId,
            phoneNumber: user.phoneNumber,
          },
        });
      } else {
        res.status(201).json({
          message: 'User created successfully, but failed to send SMS. Please provide credentials manually.',
          user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            adminId: user.adminId,
            phoneNumber: user.phoneNumber,
          },
          password: randomPassword, // Return password if email failed
        });
      }
    } catch (error) {
      logger.error('Create user error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

const SMS_SEND_DELAY_MS = 2000;
const MAX_RESEND_BATCH_SIZE = 30;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function canManageUser(actor: User, target: User): boolean {
  const actorRole = actor.role as string;
  if (actorRole === UserRole.SUPER_ADMIN || actorRole === 'super_admin') {
    return true;
  }
  return target.adminId === actor.id;
}

// Resend passwords via SMS (queued sequentially)
router.post(
  '/users/resend-passwords',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { userIds } = req.body as { userIds?: string[] };

      if (!Array.isArray(userIds) || userIds.length === 0) {
        res.status(400).json({ message: 'userIds array is required' });
        return;
      }

      if (userIds.length > MAX_RESEND_BATCH_SIZE) {
        res.status(400).json({
          message: `You can resend passwords for at most ${MAX_RESEND_BATCH_SIZE} users at a time`,
        });
        return;
      }

      const userRepository = AppDataSource.getRepository(User);
      const actor = req.user!;
      const results: Array<{
        userId: string;
        name: string;
        email: string;
        status: 'success' | 'error' | 'skipped';
        message?: string;
      }> = [];

      const usersToProcess: User[] = [];
      for (const userId of userIds) {
        const target = await userRepository.findOne({ where: { id: userId } });
        if (!target) {
          results.push({
            userId,
            name: '',
            email: '',
            status: 'skipped',
            message: 'User not found',
          });
          continue;
        }

        if (target.id === actor.id) {
          results.push({
            userId: target.id,
            name: target.name,
            email: target.email,
            status: 'skipped',
            message: 'Cannot reset your own password here',
          });
          continue;
        }

        const targetRole = target.role as string;
        if (targetRole === UserRole.SUPER_ADMIN || targetRole === 'super_admin') {
          results.push({
            userId: target.id,
            name: target.name,
            email: target.email,
            status: 'skipped',
            message: 'Cannot reset super admin passwords',
          });
          continue;
        }

        if (!canManageUser(actor, target)) {
          results.push({
            userId: target.id,
            name: target.name,
            email: target.email,
            status: 'skipped',
            message: 'Access denied',
          });
          continue;
        }

        if (!target.phoneNumber?.trim()) {
          results.push({
            userId: target.id,
            name: target.name,
            email: target.email,
            status: 'skipped',
            message: 'No phone number on file',
          });
          continue;
        }

        const normalizedPhone = smsService.normalizePhoneNumber(target.phoneNumber);
        if (typeof normalizedPhone === 'object' && 'error' in normalizedPhone) {
          results.push({
            userId: target.id,
            name: target.name,
            email: target.email,
            status: 'skipped',
            message: 'Invalid phone number on file',
          });
          continue;
        }

        usersToProcess.push(target);
      }

      for (let i = 0; i < usersToProcess.length; i++) {
        const target = usersToProcess[i];
        const newPassword = generateRandomPassword();
        target.password = await hashPassword(newPassword);
        await userRepository.save(target);

        const smsSent = await smsService.sendPasswordReset(
          target.phoneNumber!,
          target.email,
          newPassword,
        );

        results.push({
          userId: target.id,
          name: target.name,
          email: target.email,
          status: smsSent ? 'success' : 'error',
          message: smsSent
            ? 'New password sent via SMS'
            : 'Password reset but SMS failed to send',
        });

        if (i < usersToProcess.length - 1) {
          await sleep(SMS_SEND_DELAY_MS);
        }
      }

      const successCount = results.filter((r) => r.status === 'success').length;
      const errorCount = results.filter((r) => r.status === 'error').length;
      const skippedCount = results.filter((r) => r.status === 'skipped').length;

      res.json({
        message: `Password resend complete. ${successCount} sent, ${errorCount} failed, ${skippedCount} skipped.`,
        results,
        summary: { successCount, errorCount, skippedCount },
      });
    } catch (error) {
      logger.error('Resend passwords error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Delete user (Admin only)
router.delete(
  '/users/:email',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { email } = req.params;

      if (!email) {
        res.status(400).json({
          message: 'Email is required',
        });
        return;
      }

      const userRepository = AppDataSource.getRepository(User);

      // Find user by email
      const user = await userRepository.findOne({
        where: { email },
      });

      if (!user) {
        res.status(404).json({ message: 'User not found' });
        return;
      }

      // Prevent deleting yourself
      if (user.id === req.user!.id) {
        res.status(400).json({ message: 'You cannot delete your own account' });
        return;
      }

      // Regular admins can only delete users assigned to them
      const userRole = req.user!.role as string;
      if (userRole !== UserRole.SUPER_ADMIN && userRole !== 'super_admin') {
        if (user.adminId !== req.user!.id) {
          res.status(403).json({ message: 'Access denied. You can only delete users assigned to you.' });
          return;
        }
      }

      // Revoke all tokens by clearing refresh token
      user.refreshToken = null;
      await userRepository.save(user);

      // Delete user from database
      await userRepository.remove(user);

      logger.info('User deleted successfully', {
        email,
        deletedBy: req.user!.id,
      });

      res.json({
        message: 'User deleted successfully. All access tokens and refresh tokens have been revoked.',
      });
    } catch (error) {
      logger.error('Delete user error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

export default router;

