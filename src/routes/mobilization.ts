import { Router, Response } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth';
import { AppDataSource } from '../config/database';
import { EventMobilizationAssignment } from '../entities/EventMobilizationAssignment';
import { EventMobilizationRoleType } from '../entities/EventMobilizationRole';
import {
  assertCoordinatorAccess,
  assertEventMembership,
  assertMobilizationAdmin,
  assertMobilizerAccess,
  getEventOrThrow,
  getMobilizationRole,
  isMobilizationAdmin,
  MobilizationAccessError,
  MAX_MOBILIZER_ASSIGNMENTS,
  MAX_MOBILIZERS_PER_COORDINATOR,
} from '../services/MobilizationAccessService';
import { MobilizationRosterService } from '../services/MobilizationRosterService';
import { MobilizationAssignmentService } from '../services/MobilizationAssignmentService';
import { MobilizationReadService } from '../services/MobilizationReadService';
import { MobilizationOnboardingService } from '../services/MobilizationOnboardingService';
import { MobilizationCheckInService } from '../services/MobilizationCheckInService';
import { normalizePollingCenterFields, pollingCenterLabel } from '../utils/mobilizationPollingCenter';
import logger from '../config/logger';

const router = Router({ mergeParams: true });

function handleError(res: Response, error: unknown): void {
  if (error instanceof MobilizationAccessError) {
    res.status(error.statusCode).json({ message: error.message });
    return;
  }
  logger.error('Mobilization route error:', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  res.status(500).json({ message: 'Internal server error' });
}

// POST /api/events/:eventId/mobilization/voters/checkin — mobilizer checks in a new voter (not on campaign) and assigns to self
router.post('/voters/checkin', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;
    const event = await getEventOrThrow(eventId);
    await assertMobilizerAccess(req.user!, event);

    const role = await getMobilizationRole(req.user!.id, eventId);
    if (role !== EventMobilizationRoleType.MOBILIZER) {
      throw new MobilizationAccessError('Only mobilizers can check in voters for mobilization', 403);
    }

    const {
      idNumber,
      phoneNumber,
      name,
      dateOfBirth,
      sex,
      county,
      constituency,
      ward,
      pollingCenter,
      isRegisteredVoter,
      isInvited,
    } = req.body as {
      idNumber?: string;
      phoneNumber?: string;
      name?: string;
      dateOfBirth?: string;
      sex?: string;
      county?: string;
      constituency?: string;
      ward?: string;
      pollingCenter?: string;
      isRegisteredVoter?: boolean;
      isInvited?: boolean;
    };

    if (!idNumber?.trim()) {
      res.status(400).json({ message: 'idNumber is required' });
      return;
    }

    const result = await MobilizationCheckInService.checkInAndAssign(
      eventId,
      req.user!.id,
      {
        idNumber,
        phoneNumber,
        name,
        dateOfBirth,
        sex,
        county,
        constituency,
        ward,
        pollingCenter,
        isRegisteredVoter,
        isInvited,
      },
      req.user!.id
    );

    res.status(201).json(result);
  } catch (error) {
    handleError(res, error);
  }
});

// POST /api/events/:eventId/mobilization/coordinators/create
router.post('/coordinators/create', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;
    const { name, email, phoneNumber } = req.body as {
      name?: string;
      email?: string;
      phoneNumber?: string;
    };

    const event = await getEventOrThrow(eventId);
    await assertMobilizationAdmin(req.user!, event);

    const result = await MobilizationOnboardingService.createCoordinator(
      event,
      {
        name: name ?? '',
        email: email ?? '',
        phoneNumber: phoneNumber ?? '',
      },
      req.user!.id
    );

    res.status(201).json(result);
  } catch (error) {
    handleError(res, error);
  }
});

// POST /api/events/:eventId/mobilization/mobilizers/create
router.post('/mobilizers/create', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;
    const { name, email, phoneNumber, pollingCenter, ward, constituency } = req.body as {
      name?: string;
      email?: string;
      phoneNumber?: string;
      pollingCenter?: string;
      ward?: string;
      constituency?: string;
    };

    if (!pollingCenter?.trim()) {
      res.status(400).json({ message: 'pollingCenter is required' });
      return;
    }

    const event = await getEventOrThrow(eventId);
    const admin = isMobilizationAdmin(req.user!, event);

    if (admin) {
      await assertMobilizationAdmin(req.user!, event);
    } else {
      await assertCoordinatorAccess(req.user!, event);
    }

    const result = await MobilizationOnboardingService.createMobilizer(
      event,
      {
        name: name ?? '',
        email: email ?? '',
        phoneNumber: phoneNumber ?? '',
        pollingCenter: normalizePollingCenterFields(pollingCenter, ward, constituency),
      },
      req.user!.id,
      { enforceCoordinatorCapacity: !admin }
    );

    res.status(201).json(result);
  } catch (error) {
    handleError(res, error);
  }
});

// GET /api/events/:eventId/mobilization/summary
router.get('/summary', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;
    const event = await getEventOrThrow(eventId);
    await assertEventMembership(req.user!, eventId);

    const role = await getMobilizationRole(req.user!.id, eventId);
    const isAdmin = await (async () => {
      try {
        await assertMobilizationAdmin(req.user!, event);
        return true;
      } catch {
        return false;
      }
    })();

    const isCoordinator = role === EventMobilizationRoleType.COORDINATOR;
    let mobilizerContext: {
      pollingCenterLabel: string | null;
      assigned: number;
      slotsRemaining: number;
    } | null = null;

    if (role === EventMobilizationRoleType.MOBILIZER) {
      try {
        const pc = await MobilizationRosterService.getMobilizerPollingCenterOrThrow(
          eventId,
          req.user!.id
        );
        const assigned = await MobilizationAssignmentService.countForMobilizer(
          eventId,
          req.user!.id
        );
        mobilizerContext = {
          pollingCenterLabel: pollingCenterLabel(pc),
          assigned,
          slotsRemaining: Math.max(0, MAX_MOBILIZER_ASSIGNMENTS - assigned),
        };
      } catch {
        mobilizerContext = null;
      }
    }

    let coordinatorContext: {
      mobilizersAdded: number;
      maxMobilizers: number;
      slotsRemaining: number;
    } | null = null;

    if (isCoordinator && !isAdmin) {
      coordinatorContext = await MobilizationRosterService.getCoordinatorMobilizerCapacityForUser(
        eventId,
        req.user!.id
      );
    }

    res.json({
      maxAssignmentsPerMobilizer: MAX_MOBILIZER_ASSIGNMENTS,
      maxMobilizersPerCoordinator: MAX_MOBILIZERS_PER_COORDINATOR,
      role: isAdmin ? 'admin' : role,
      canCoordinate: isAdmin || isCoordinator,
      canMobilize:
        isAdmin ||
        role === EventMobilizationRoleType.MOBILIZER ||
        isCoordinator,
      canManageMobilizers: isAdmin || isCoordinator,
      canManageCoordinators: isAdmin,
      canClaimVoters: role === EventMobilizationRoleType.MOBILIZER,
      mobilizer: mobilizerContext,
      coordinator: coordinatorContext,
      event: {
        scopeType: event.scopeType,
        county: event.county,
        constituency: event.constituency,
        ward: event.ward,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
});

// GET /api/events/:eventId/mobilization/polling-centers
router.get('/polling-centers', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;
    await getEventOrThrow(eventId);
    await assertEventMembership(req.user!, eventId);

    const pollingCenters = await MobilizationRosterService.listEventPollingCenters(eventId);
    res.json({ pollingCenters });
  } catch (error) {
    handleError(res, error);
  }
});

// GET /api/events/:eventId/mobilization/roles
router.get('/roles', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;
    const event = await getEventOrThrow(eventId);
    await assertCoordinatorAccess(req.user!, event);

    const roles = await MobilizationRosterService.listRoles(eventId);
    res.json({ roles });
  } catch (error) {
    handleError(res, error);
  }
});

// GET /api/events/:eventId/mobilization/eligible-users
router.get('/eligible-users', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;
    const event = await getEventOrThrow(eventId);
    await assertCoordinatorAccess(req.user!, event);

    const users = await MobilizationRosterService.listEligibleUsers(eventId);
    res.json({ users });
  } catch (error) {
    handleError(res, error);
  }
});

// POST /api/events/:eventId/mobilization/roles
router.post('/roles', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;
    const { userId, role, pollingCenter, ward, constituency } = req.body as {
      userId?: string;
      role?: EventMobilizationRoleType;
      pollingCenter?: string;
      ward?: string;
      constituency?: string;
    };

    if (!userId || !role) {
      res.status(400).json({ message: 'userId and role are required' });
      return;
    }

    const event = await getEventOrThrow(eventId);
    const admin = isMobilizationAdmin(req.user!, event);

    if (admin) {
      await assertMobilizationAdmin(req.user!, event);
    } else {
      await assertCoordinatorAccess(req.user!, event);
      if (role !== EventMobilizationRoleType.MOBILIZER) {
        throw new MobilizationAccessError('Coordinators can only add mobilizers', 403);
      }
    }

    const pc =
      role === EventMobilizationRoleType.MOBILIZER && pollingCenter
        ? normalizePollingCenterFields(pollingCenter, ward, constituency)
        : null;

    const row = await MobilizationRosterService.addRole(
      eventId,
      userId,
      role,
      req.user!.id,
      pc,
      { enforceCoordinatorCapacity: !admin && role === EventMobilizationRoleType.MOBILIZER }
    );
    res.status(201).json({ role: row });
  } catch (error) {
    handleError(res, error);
  }
});

// DELETE /api/events/:eventId/mobilization/roles/:userId
router.delete(
  '/roles/:userId',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const eventId = req.params.eventId as string;
      const userId = req.params.userId as string;
      const event = await getEventOrThrow(eventId);
      const admin = isMobilizationAdmin(req.user!, event);
      const target = await MobilizationRosterService.findRole(eventId, userId);

      if (!target) {
        throw new MobilizationAccessError('Role not found', 404);
      }

      if (admin) {
        await assertMobilizationAdmin(req.user!, event);
      } else {
        await assertCoordinatorAccess(req.user!, event);
        if (target.role !== EventMobilizationRoleType.MOBILIZER) {
          throw new MobilizationAccessError('Coordinators can only remove mobilizers', 403);
        }
      }

      await MobilizationRosterService.removeRole(eventId, userId);
      res.json({ message: 'Role removed' });
    } catch (error) {
      handleError(res, error);
    }
  }
);

// GET /api/events/:eventId/mobilization/participants
router.get('/participants', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;
    const event = await getEventOrThrow(eventId);
    await assertCoordinatorAccess(req.user!, event);

    const assignmentStatus = req.query.assignmentStatus as
      | 'all'
      | 'assigned'
      | 'unassigned'
      | undefined;
    const voted = req.query.voted as 'all' | 'voted' | 'not_voted' | undefined;

    const result = await MobilizationReadService.listParticipants(eventId, {
      search: req.query.search as string | undefined,
      ward: req.query.ward as string | undefined,
      pollingCenter: req.query.pollingCenter as string | undefined,
      assignmentStatus: assignmentStatus ?? 'all',
      mobilizerUserId: req.query.mobilizerUserId as string | undefined,
      voted: voted ?? 'all',
      page: parseInt(req.query.page as string, 10) || 1,
      limit: parseInt(req.query.limit as string, 10) || 20,
    });

    const counts = await MobilizationReadService.getMobilizerAssignmentCounts(eventId);

    res.json({ ...result, mobilizerCounts: counts });
  } catch (error) {
    handleError(res, error);
  }
});

// GET /api/events/:eventId/mobilization/pool — available registered voters in mobilizer's polling center
router.get('/pool', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;
    const event = await getEventOrThrow(eventId);
    await assertMobilizerAccess(req.user!, event);

    const role = await getMobilizationRole(req.user!.id, eventId);
    const isAdmin = isMobilizationAdmin(req.user!, event);
    const requestedMobilizerId = req.query.mobilizerUserId as string | undefined;

    let mobilizerUserId: string;
    if (role === EventMobilizationRoleType.MOBILIZER && !isAdmin) {
      mobilizerUserId = req.user!.id;
    } else if (requestedMobilizerId) {
      await assertCoordinatorAccess(req.user!, event);
      await MobilizationRosterService.assertCanManageMobilizer(
        eventId,
        requestedMobilizerId,
        req.user!.id,
        { isAdmin }
      );
      mobilizerUserId = requestedMobilizerId;
    } else {
      throw new MobilizationAccessError(
        role === EventMobilizationRoleType.COORDINATOR || isAdmin
          ? 'mobilizerUserId is required'
          : 'Only mobilizers can browse the voter pool',
        role === EventMobilizationRoleType.COORDINATOR || isAdmin ? 400 : 403
      );
    }

    const result = await MobilizationReadService.listMobilizerPool(eventId, mobilizerUserId, {
      search: req.query.search as string | undefined,
      page: parseInt(req.query.page as string, 10) || 1,
      limit: parseInt(req.query.limit as string, 10) || 50,
    });

    res.json(result);
  } catch (error) {
    handleError(res, error);
  }
});

// POST /api/events/:eventId/mobilization/assignments/claim — mobilizer self-selects, or coordinator assigns
router.post(
  '/assignments/claim',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const eventId = req.params.eventId as string;
      const { participantIds, mobilizerUserId: bodyMobilizerUserId } = req.body as {
        participantIds?: string[];
        mobilizerUserId?: string;
      };

      if (!Array.isArray(participantIds)) {
        res.status(400).json({ message: 'participantIds array is required' });
        return;
      }

      const event = await getEventOrThrow(eventId);
      await assertMobilizerAccess(req.user!, event);

      const role = await getMobilizationRole(req.user!.id, eventId);
      const isAdmin = isMobilizationAdmin(req.user!, event);

      let mobilizerUserId: string;
      let allowOnBehalf = false;

      if (role === EventMobilizationRoleType.MOBILIZER && !isAdmin) {
        mobilizerUserId = req.user!.id;
      } else if (bodyMobilizerUserId) {
        await assertCoordinatorAccess(req.user!, event);
        mobilizerUserId = bodyMobilizerUserId;
        allowOnBehalf = true;
      } else {
        throw new MobilizationAccessError(
          'mobilizerUserId is required when assigning on behalf of a mobilizer',
          400
        );
      }

      const result = await MobilizationAssignmentService.claimBatch(
        eventId,
        mobilizerUserId,
        participantIds,
        req.user!.id,
        { allowOnBehalf, isAdmin }
      );
      res.status(201).json(result);
    } catch (error) {
      handleError(res, error);
    }
  }
);

// DELETE /api/events/:eventId/mobilization/assignments/:assignmentId
router.delete(
  '/assignments/:assignmentId',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const eventId = req.params.eventId as string;
      const assignmentId = req.params.assignmentId as string;
      const event = await getEventOrThrow(eventId);
      const role = await getMobilizationRole(req.user!.id, eventId);
      const isAdmin = isMobilizationAdmin(req.user!, event);

      if (role === EventMobilizationRoleType.MOBILIZER && !isAdmin) {
        await assertMobilizerAccess(req.user!, event);
        await MobilizationAssignmentService.releaseClaim(
          eventId,
          assignmentId,
          req.user!.id
        );
      } else {
        await assertCoordinatorAccess(req.user!, event);
        const assignment = await AppDataSource.getRepository(EventMobilizationAssignment).findOne({
          where: { id: assignmentId, eventId },
        });
        if (!assignment) {
          throw new MobilizationAccessError('Assignment not found', 404);
        }
        await MobilizationRosterService.assertCanManageMobilizer(
          eventId,
          assignment.mobilizerUserId,
          req.user!.id,
          { isAdmin }
        );
        await MobilizationAssignmentService.releaseClaim(
          eventId,
          assignmentId,
          req.user!.id,
          { coordinatorOverride: true }
        );
      }
      res.json({ message: 'Assignment removed' });
    } catch (error) {
      handleError(res, error);
    }
  }
);

// GET /api/events/:eventId/mobilization/monitor
router.get('/monitor', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;
    const event = await getEventOrThrow(eventId);
    await assertCoordinatorAccess(req.user!, event);

    const monitor = await MobilizationReadService.getMonitor(eventId);
    res.json(monitor);
  } catch (error) {
    handleError(res, error);
  }
});

// GET /api/events/:eventId/mobilization/my
router.get('/my', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const eventId = req.params.eventId as string;
    const event = await getEventOrThrow(eventId);
    await assertMobilizerAccess(req.user!, event);

    const voted = req.query.voted as 'all' | 'voted' | 'not_voted' | undefined;
    const role = await getMobilizationRole(req.user!.id, eventId);

    const mobilizerUserId =
      role === EventMobilizationRoleType.MOBILIZER
        ? req.user!.id
        : (req.query.mobilizerUserId as string | undefined);

    if (!mobilizerUserId) {
      res.status(400).json({ message: 'mobilizerUserId is required for coordinators' });
      return;
    }

    if (mobilizerUserId !== req.user!.id) {
      await assertCoordinatorAccess(req.user!, event);
      await MobilizationRosterService.assertCanManageMobilizer(
        eventId,
        mobilizerUserId,
        req.user!.id,
        { isAdmin: isMobilizationAdmin(req.user!, event) }
      );
    }

    const assignments = await MobilizationReadService.listMyAssignments(
      eventId,
      mobilizerUserId,
      voted ?? 'all'
    );

    res.json({
      event: {
        eventId: event.eventId,
        eventName: event.eventName,
        date: event.date,
      },
      assignments,
      stats: {
        assigned: assignments.length,
        voted: assignments.filter((a) => a.voted).length,
        outstanding: assignments.filter((a) => !a.voted).length,
      },
    });
  } catch (error) {
    handleError(res, error);
  }
});

// PATCH /api/events/:eventId/mobilization/assignments/:assignmentId/voted
router.patch(
  '/assignments/:assignmentId/voted',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const eventId = req.params.eventId as string;
      const assignmentId = req.params.assignmentId as string;
      const { voted } = req.body as { voted?: boolean };

      if (typeof voted !== 'boolean') {
        res.status(400).json({ message: 'voted (boolean) is required' });
        return;
      }

      const event = await getEventOrThrow(eventId);
      await assertMobilizerAccess(req.user!, event);

      const role = await getMobilizationRole(req.user!.id, eventId);
      const isAdmin = isMobilizationAdmin(req.user!, event);
      const mobilizerOnly = role === EventMobilizationRoleType.MOBILIZER && !isAdmin;
      const allowOnBehalf =
        !mobilizerOnly &&
        (role === EventMobilizationRoleType.COORDINATOR || isAdmin);

      const row = await MobilizationAssignmentService.setVoted(
        eventId,
        assignmentId,
        voted,
        req.user!.id,
        { mobilizerOnly, allowOnBehalf, isAdmin }
      );

      res.json({
        assignment: {
          id: row.id,
          voted: row.votedAt != null,
          votedAt: row.votedAt?.toISOString() ?? null,
        },
      });
    } catch (error) {
      handleError(res, error);
    }
  }
);

export default router;
