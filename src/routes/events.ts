import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Event } from '../entities/Event';
import { User, UserRole } from '../entities/User';
import { CheckInLog } from '../entities/CheckInLog';

import { Participant } from '../entities/Participant';
import { EventAgentStat } from '../entities/EventAgentStat';
import { In } from 'typeorm';
import { authenticate, AuthRequest, requireAdmin, requireSuperAdmin } from '../middleware/auth';
import logger from '../config/logger';
import { PdfService } from '../services/PdfService';
import { formatEventResponse } from '../utils/eventResponse';
import { applyEventScope } from '../utils/eventScope';
import { JurisdictionService } from '../services/JurisdictionService';
import { aggregateDemographics } from '../utils/demographics';
import { buildMomentumAnalytics } from '../utils/momentumAnalytics';
import { buildFieldImpact } from '../utils/fieldImpact';
import {
  applyMyCheckInsFilters,
  applyMyCheckInsSort,
  parseMyCheckInsQuery,
} from '../utils/myCheckInsQuery';
import { AnalyticsReadService } from '../services/AnalyticsReadService';
import { Survey, SurveyStatus } from '../entities/Survey';
import { SurveyReadService } from '../services/SurveyReadService';

const router = Router();

// Create event (Admin only)
router.post(
  '/',
  authenticate,
  requireSuperAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { eventName, location, date, scopeType, county, constituency, ward, pollingCenterId } = req.body;

      if (!eventName) {
        res.status(400).json({
          message: 'Event name is required',
        });
        return;
      }

      const eventRepository = AppDataSource.getRepository(Event);

      const event = eventRepository.create({
        eventName,
        location: location || null,
        date: date ? new Date(date) : null,
        createdById: req.user!.id,
      });

      const scopeResult = await applyEventScope(event, {
        scopeType,
        county,
        constituency,
        ward,
        pollingCenterId,
      });
      if (scopeResult.error) {
        res.status(400).json({ message: scopeResult.error });
        return;
      }

      await eventRepository.save(event);

      const saved = await eventRepository.findOne({
        where: { eventId: event.eventId },
        relations: ['createdBy', 'pollingCenter'],
      });

      res.status(201).json({
        message: 'Event created successfully',
        event: saved ? await formatEventResponse(saved) : event,
      });
    } catch (error) {
      logger.error('Create event error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Assign users to event (Super Admin only)
router.post(
  '/:eventId/assign',
  authenticate,
  requireSuperAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { eventId } = req.params;
      const { userIds } = req.body;

      if (!userIds || !Array.isArray(userIds)) {
        res.status(400).json({
          message: 'userIds array is required',
        });
        return;
      }

      const eventRepository = AppDataSource.getRepository(Event);
      const userRepository = AppDataSource.getRepository(User);

      const event = await eventRepository.findOne({
        where: { eventId },
        relations: ['assignedUsers'],
      });

      if (!event) {
        res.status(404).json({ message: 'Event not found' });
        return;
      }

      // Fetch users to assign
      const usersToAssign = await userRepository.findBy({
        id: In(userIds),
      });

      // Update assigned users
      event.assignedUsers = usersToAssign;
      await eventRepository.save(event);

      res.json({
        message: 'Users assigned to event successfully',
        assignedCount: usersToAssign.length,
      });
    } catch (error) {
      logger.error('Assign users to event error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Get all events
router.get(
  '/',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const eventRepository = AppDataSource.getRepository(Event);
      
      // Parse pagination parameters
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 10;
      const skip = (page - 1) * limit;

      // Build query based on user role
      let queryBuilder = eventRepository.createQueryBuilder('event')
        .leftJoinAndSelect('event.createdBy', 'createdBy')
        .orderBy('event.createdAt', 'DESC');

      const userRole = req.user!.role as string;
      if (userRole === UserRole.SUPER_ADMIN || userRole === 'super_admin') {
        // Super admins see all events - no additional where clause
      } else {
        // Admins and Users see only events they are assigned to
        queryBuilder = queryBuilder
          .innerJoin('event.assignedUsers', 'assignedUser')
          .where('assignedUser.id = :userId', { userId: req.user!.id });
      }

      // Get total count
      const total = await queryBuilder.getCount();

      // Get paginated results
      const events = await queryBuilder
        .skip(skip)
        .take(limit)
        .getMany();

      const totalPages = Math.ceil(total / limit);

      res.json({
        message: 'Events retrieved successfully',
        events: events.map((event) => ({
          eventId: event.eventId,
          eventName: event.eventName,
          location: event.location,
          date: event.date,
          county: event.county,
          constituency: event.constituency,
          ward: event.ward,
          scopeType: event.scopeType,
          pollingCenterId: event.pollingCenterId,
          createdBy: {
            id: event.createdBy.id,
            name: event.createdBy.name,
            email: event.createdBy.email,
          },
          createdAt: event.createdAt,
          updatedAt: event.updatedAt,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      });
    } catch (error) {
      logger.error('Get events error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Get single event by ID
router.get(
  '/:eventId',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { eventId } = req.params;

      const eventRepository = AppDataSource.getRepository(Event);

      const event = await eventRepository.findOne({
        where: { eventId },
        relations: ['createdBy', 'assignedUsers', 'pollingCenter'],
      });

      if (!event) {
        res.status(404).json({ message: 'Event not found' });
        return;
      }

      // Check access permissions
      const userRole = req.user!.role as string;
      if (userRole === UserRole.SUPER_ADMIN || userRole === 'super_admin') {
        // Super admins can access all events
      } else {
        // Check if user is assigned to this event
        const isAssigned = await eventRepository
          .createQueryBuilder('event')
          .innerJoin('event.assignedUsers', 'assignedUser')
          .where('event.eventId = :eventId', { eventId })
          .andWhere('assignedUser.id = :userId', { userId: req.user!.id })
          .getCount();

        if (!isAssigned) {
          res.status(403).json({ message: 'Access denied' });
          return;
        }
      }

      res.json({
        message: 'Event retrieved successfully',
        event: await formatEventResponse(event),
      });
    } catch (error) {
      logger.error('Get event error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Update event (Super Admin or event creator)
router.patch(
  '/:eventId',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { eventId } = req.params;
      const { eventName, location, date, scopeType, county, constituency, ward, pollingCenterId } = req.body;

      const eventRepository = AppDataSource.getRepository(Event);
      const event = await eventRepository.findOne({
        where: { eventId },
        relations: ['createdBy', 'assignedUsers', 'pollingCenter'],
      });

      if (!event) {
        res.status(404).json({ message: 'Event not found' });
        return;
      }

      const userRole = req.user!.role as string;
      if (userRole !== UserRole.SUPER_ADMIN && userRole !== 'super_admin' && event.createdById !== req.user!.id) {
        res.status(403).json({ message: 'Access denied. You can only edit events you created.' });
        return;
      }

      if (eventName !== undefined) event.eventName = eventName;
      if (location !== undefined) event.location = location || null;
      if (date !== undefined) event.date = date ? new Date(date) : null;

      if (scopeType !== undefined) {
        const scopeResult = await applyEventScope(event, {
          scopeType,
          county,
          constituency,
          ward,
          pollingCenterId,
        });
        if (scopeResult.error) {
          res.status(400).json({ message: scopeResult.error });
          return;
        }
      }

      await eventRepository.save(event);

      const updated = await eventRepository.findOne({
        where: { eventId },
        relations: ['createdBy', 'assignedUsers', 'pollingCenter'],
      });

      res.json({
        message: 'Event updated successfully',
        event: updated ? await formatEventResponse(updated) : event,
      });
    } catch (error) {
      logger.error('Update event error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Delete event (Admin only)
router.delete(
  '/:eventId',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { eventId } = req.params;

      const eventRepository = AppDataSource.getRepository(Event);
      const participantRepository = AppDataSource.getRepository(Participant);
      const checkInLogRepository = AppDataSource.getRepository(CheckInLog);

      const event = await eventRepository.findOne({
        where: { eventId },
      });

      if (!event) {
        res.status(404).json({ message: 'Event not found' });
        return;
      }

      // Allow super admin to delete any event, regular admin can only delete their own events
      const userRole = req.user!.role as string;
      if (userRole !== UserRole.SUPER_ADMIN && userRole !== 'super_admin' && event.createdById !== req.user!.id) {
        res.status(403).json({ message: 'Access denied. You can only delete events you created.' });
        return;
      }

      // 1. Delete related CheckInLogs
      // We do this first to satisfy FK constraints if they exist and aren't set to cascade
      await checkInLogRepository.delete({ eventId });
      
      // 2. Delete related Participants
      await participantRepository.delete({ eventId });

      // 3. Delete the Event
      await eventRepository.remove(event);

      logger.info('Event deleted successfully', {
        eventId,
        deletedBy: req.user!.id,
      });

      res.json({
        message: 'Event deleted successfully',
      });
    } catch (error) {
      logger.error('Delete event error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Get event statistics (Simplified)
router.get(
  '/:eventId/statistics',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { eventId } = req.params;
      const eventRepository = AppDataSource.getRepository(Event);
      const participantRepository = AppDataSource.getRepository(Participant);
      const checkInLogRepository = AppDataSource.getRepository(CheckInLog);

      const event = await eventRepository.findOne({
        where: { eventId },
        relations: ['assignedUsers', 'pollingCenter'],
      });

      if (!event) {
        res.status(404).json({ message: 'Event not found' });
        return;
      }

      // Check access permissions
      const userRole = req.user!.role as string;
      if (userRole !== UserRole.SUPER_ADMIN && userRole !== 'super_admin') {
        const isAssigned = event.assignedUsers.some(u => u.id === req.user!.id);
        if (!isAssigned) {
          res.status(403).json({ message: 'Access denied' });
          return;
        }
      }

      const drillDown = JurisdictionService.parseDrillDownFilter(
        req.query as Record<string, unknown>
      );

      let registeredVotersInScope = await JurisdictionService.getRegisteredVotersInScope(event);

      const centersInScope = await JurisdictionService.getPollingCentersInEventScope(event);
      const activeCenters = JurisdictionService.filterCentersByDrillDown(
        centersInScope,
        drillDown
      );

      if (JurisdictionService.hasDrillDownFilter(drillDown) && activeCenters.length > 0) {
        registeredVotersInScope = JurisdictionService.getRegisteredVotersFromCenters(activeCenters);
      }

      const [totalCheckIns, uniqueCheckedIn, collectionMaps] = await Promise.all([
        AnalyticsReadService.getTotalCheckIns(eventId),
        AnalyticsReadService.getUniqueMobilizedInScope(eventId, drillDown),
        AnalyticsReadService.getCollectionMaps(eventId, drillDown),
      ]);

      const collectionByCenter = collectionMaps.byCenter;
      const collectionByWard = collectionMaps.byWard;
      const collectionByConstituency = collectionMaps.byConstituency;
      const collectionByCounty = collectionMaps.byCounty;

      const totalParticipants = await participantRepository.count({ where: { eventId } });

      // Category breakdowns still require live joins (not stored in summary tables).
      // Invited: isInvited = true
      const invitedCheckIns = await checkInLogRepository
        .createQueryBuilder('log')
        .leftJoin('log.participant', 'participant')
        .where('log.eventId = :eventId', { eventId })
        .andWhere('participant.isInvited = :isInvited', { isInvited: true })
        .getCount();

      // Registered Walk-in: isInvited != true (Regardless of voter status)
      const registeredWalkIns = await checkInLogRepository
        .createQueryBuilder('log')
        .leftJoin('log.participant', 'participant')
        .where('log.eventId = :eventId', { eventId })
        .andWhere('(participant.isInvited = :isInvitedFalse OR participant.isInvited IS NULL)', { isInvitedFalse: false })
        .getCount();

      // Adult Population: isInvited != true AND isRegisteredVoter != true
      const adultPopulationCheckIns = await checkInLogRepository
        .createQueryBuilder('log')
        .leftJoin('log.participant', 'participant')
        .where('log.eventId = :eventId', { eventId })
        .andWhere('(participant.isInvited = :isInvitedFalse OR participant.isInvited IS NULL)', { isInvitedFalse: false })
        .andWhere('(participant.isRegisteredVoter = :isRegisteredVoterFalse OR participant.isRegisteredVoter IS NULL)', { isRegisteredVoterFalse: false })
        .getCount();

      // NEW STATS: Breakdown by Registration Status
      
      // Invited & Registered
      const invitedRegisteredCheckIns = await checkInLogRepository
        .createQueryBuilder('log')
        .leftJoin('log.participant', 'participant')
        .where('log.eventId = :eventId', { eventId })
        .andWhere('participant.isInvited = :isInvited', { isInvited: true })
        .andWhere('participant.isRegisteredVoter = :isRegisteredVoter', { isRegisteredVoter: true })
        .getCount();

      // Invited & NOT Registered
      const invitedNotRegisteredCheckIns = await checkInLogRepository
        .createQueryBuilder('log')
        .leftJoin('log.participant', 'participant')
        .where('log.eventId = :eventId', { eventId })
        .andWhere('participant.isInvited = :isInvited', { isInvited: true })
        .andWhere('(participant.isRegisteredVoter = :isRegisteredVoterFalse OR participant.isRegisteredVoter IS NULL)', { isRegisteredVoterFalse: false })
        .getCount();

      // Total Registered (All check-ins)
      const totalRegisteredCheckIns = await checkInLogRepository
        .createQueryBuilder('log')
        .leftJoin('log.participant', 'participant')
        .where('log.eventId = :eventId', { eventId })
        .andWhere('participant.isRegisteredVoter = :isRegisteredVoter', { isRegisteredVoter: true })
        .getCount();

      // Total NOT Registered (All check-ins)
      const totalNotRegisteredCheckIns = await checkInLogRepository
        .createQueryBuilder('log')
        .leftJoin('log.participant', 'participant')
        .where('log.eventId = :eventId', { eventId })
        .andWhere('(participant.isRegisteredVoter = :isRegisteredVoterFalse OR participant.isRegisteredVoter IS NULL)', { isRegisteredVoterFalse: false })
        .getCount();

      const scopeLabel = JurisdictionService.hasDrillDownFilter(drillDown)
        ? JurisdictionService.drillDownFilterLabel(drillDown)
        : JurisdictionService.getScopeLabel(event);

      const missingPhonesQb = participantRepository
        .createQueryBuilder('p')
        .innerJoin('p.checkInLogs', 'l')
        .where('p.eventId = :eventId', { eventId })
        .andWhere('l.eventId = :eventId', { eventId })
        .andWhere("(p.phoneNumber IS NULL OR p.phoneNumber = '')");
      JurisdictionService.applyDrillDownToParticipantQuery(missingPhonesQb, drillDown);
      const missingPhones = await missingPhonesQb.getCount();

      const mobilizedParticipantsQb = participantRepository
        .createQueryBuilder('p')
        .innerJoin('p.checkInLogs', 'l')
        .select(['p.id', 'p.sex', 'p.dateOfBirth'])
        .where('p.eventId = :eventId', { eventId })
        .andWhere('l.eventId = :eventId', { eventId });
      JurisdictionService.applyDrillDownToParticipantQuery(mobilizedParticipantsQb, drillDown);
      const mobilizedParticipants = await mobilizedParticipantsQb.getMany();

      const demographics = aggregateDemographics(mobilizedParticipants);

      const childLevel = JurisdictionService.getAnalysisLevelForDrillDown(
        drillDown,
        event.scopeType
      );
      let jurisdictionRankings: Array<Record<string, unknown>> = [];
      let priorityPush: Array<Record<string, unknown>> = [];

      if (activeCenters.length > 0 && childLevel) {
        if (childLevel.field) {
          jurisdictionRankings = JurisdictionService.buildRankedAreaBreakdown(
            activeCenters,
            childLevel.field,
            childLevel.level === 'constituency'
              ? collectionByConstituency
              : childLevel.level === 'ward'
                ? collectionByWard
                : collectionByCounty
          );
        } else {
          jurisdictionRankings = JurisdictionService.buildRankedPollingCenterBreakdown(
            activeCenters,
            collectionByCenter
          );
        }

        priorityPush = jurisdictionRankings
          .filter(
            (r) =>
              r.status === 'not_started' ||
              r.status === 'critical' ||
              r.status === 'low'
          )
          .slice(0, 20);
      }

      const coveragePercent = registeredVotersInScope
        ? parseFloat(((uniqueCheckedIn / registeredVotersInScope) * 100).toFixed(1))
        : null;

      res.json({
        total_check_ins: totalCheckIns,
        total_participants: totalParticipants,
        unique_checked_in: uniqueCheckedIn,
        registered_voters_in_scope: registeredVotersInScope,
        collection_progress: registeredVotersInScope
          ? `${uniqueCheckedIn} / ${registeredVotersInScope}`
          : null,
        coverage_percent: coveragePercent,
        scope_label: scopeLabel,
        missing_phones: missingPhones,
        invited_check_ins: invitedCheckIns,
        registered_walk_ins: registeredWalkIns,
        adult_population_check_ins: adultPopulationCheckIns,
        invited_registered_check_ins: invitedRegisteredCheckIns,
        invited_not_registered_check_ins: invitedNotRegisteredCheckIns,
        total_registered_check_ins: totalRegisteredCheckIns,
        total_not_registered_check_ins: totalNotRegisteredCheckIns,
        scope_type: event.scopeType ?? null,
        drill_down: {
          ...drillDown,
          filter_label: JurisdictionService.drillDownFilterLabel(drillDown),
          view_level: childLevel?.level ?? null,
        },
        scope_defaults: JurisdictionService.drillDownDefaultsFromEvent(event),
        demographics,
        jurisdiction_analysis: childLevel
          ? {
              level: childLevel.level,
              label: childLevel.label,
              rankings: jurisdictionRankings,
              priority_push: priorityPush,
            }
          : null,
      });

    } catch (error) {
       logger.error('Get event statistics error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

async function assertEventAccessForFieldUser(
  event: Event,
  user: { id: string; role: string }
): Promise<boolean> {
  const userRole = user.role as string;
  if (userRole === UserRole.SUPER_ADMIN || userRole === 'super_admin') {
    return true;
  }
  return event.assignedUsers.some((u) => u.id === user.id);
}

router.get(
  '/:eventId/my-checkins/filter-options',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { eventId } = req.params;
      const eventRepository = AppDataSource.getRepository(Event);
      const checkInLogRepository = AppDataSource.getRepository(CheckInLog);

      const event = await eventRepository.findOne({
        where: { eventId },
        relations: ['assignedUsers'],
      });

      if (!event) {
        res.status(404).json({ message: 'Event not found' });
        return;
      }

      if (!(await assertEventAccessForFieldUser(event, req.user!))) {
        res.status(403).json({ message: 'Access denied' });
        return;
      }

      const rows = await checkInLogRepository
        .createQueryBuilder('log')
        .innerJoin('log.participant', 'participant')
        .select('participant.county', 'county')
        .addSelect('participant.constituency', 'constituency')
        .addSelect('participant.ward', 'ward')
        .addSelect('participant.pollingCenter', 'pollingCenter')
        .where('log.eventId = :eventId', { eventId })
        .andWhere('log.checkedInById = :userId', { userId: req.user!.id })
        .distinct(true)
        .getRawMany<{
          county: string | null;
          constituency: string | null;
          ward: string | null;
          pollingCenter: string | null;
        }>();

      const sortUnique = (values: (string | null | undefined)[]) =>
        [...new Set(values.filter((v): v is string => !!v && v.trim() !== ''))].sort((a, b) =>
          a.localeCompare(b)
        );

      const pollingCentersByWard: Record<string, string[]> = {};
      for (const row of rows) {
        const ward = row.ward?.trim();
        const pc = row.pollingCenter?.trim();
        if (!ward || !pc) continue;
        if (!pollingCentersByWard[ward]) pollingCentersByWard[ward] = [];
        if (!pollingCentersByWard[ward].includes(pc)) {
          pollingCentersByWard[ward].push(pc);
        }
      }
      for (const ward of Object.keys(pollingCentersByWard)) {
        pollingCentersByWard[ward].sort((a, b) => a.localeCompare(b));
      }

      res.json({
        message: 'Filter options retrieved successfully',
        wards: sortUnique(rows.map((r) => r.ward)),
        pollingCenters: sortUnique(rows.map((r) => r.pollingCenter)),
        pollingCentersByWard,
      });
    } catch (error) {
      logger.error('Get my check-ins filter options error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

router.get(
  '/:eventId/my-checkins',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { eventId } = req.params;
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
      const skip = (page - 1) * limit;

      const eventRepository = AppDataSource.getRepository(Event);
      const checkInLogRepository = AppDataSource.getRepository(CheckInLog);

      const event = await eventRepository.findOne({
        where: { eventId },
        relations: ['assignedUsers'],
      });

      if (!event) {
        res.status(404).json({ message: 'Event not found' });
        return;
      }

      if (!(await assertEventAccessForFieldUser(event, req.user!))) {
        res.status(403).json({ message: 'Access denied' });
        return;
      }

      const filters = parseMyCheckInsQuery(eventId, req.user!.id, req.query);

      const countQb = checkInLogRepository.createQueryBuilder('log');
      applyMyCheckInsFilters(countQb, filters);
      const total = await countQb.getCount();

      const dataQb = checkInLogRepository
        .createQueryBuilder('log')
        .innerJoinAndSelect('log.participant', 'participant');
      applyMyCheckInsFilters(dataQb, filters, { participantJoined: true });
      applyMyCheckInsSort(dataQb, filters.sort);

      const checkIns = await dataQb.skip(skip).take(limit).getMany();

      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

      res.json({
        message: 'Your check-ins retrieved successfully',
        checkIns: checkIns.map((log) => ({
          id: log.id,
          checkInDate: log.checkInDate,
          checkedInAt: log.checkedInAt,
          participant: {
            id: log.participant.id,
            idNumber: log.participant.idNumber,
            name: log.participant.name,
            sex: log.participant.sex,
            phoneNumber: log.participant.phoneNumber,
            county: log.participant.county,
            constituency: log.participant.constituency,
            ward: log.participant.ward,
            pollingCenter: log.participant.pollingCenter,
            isRegisteredVoter: log.participant.isRegisteredVoter,
            isInvited: log.participant.isInvited,
          },
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
        filters: {
          search: filters.search ?? null,
          county: filters.county ?? null,
          constituency: filters.constituency ?? null,
          ward: filters.ward ?? null,
          pollingCenter: filters.pollingCenter ?? null,
          dateFrom: filters.dateFrom ?? null,
          dateTo: filters.dateTo ?? null,
          today: filters.today ?? false,
          isRegisteredVoter: filters.isRegisteredVoter ?? null,
          isInvited: filters.isInvited ?? null,
          sex: filters.sex ?? null,
          sort: filters.sort ?? 'checkedInAt_desc',
        },
      });
    } catch (error) {
      logger.error('Get my check-ins error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

router.get(
  '/:eventId/my-impact',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { eventId } = req.params;
      const eventRepository = AppDataSource.getRepository(Event);

      const event = await eventRepository.findOne({
        where: { eventId },
        relations: ['assignedUsers', 'pollingCenter'],
      });

      if (!event) {
        res.status(404).json({ message: 'Event not found' });
        return;
      }

      if (!(await assertEventAccessForFieldUser(event, req.user!))) {
        res.status(403).json({ message: 'Access denied' });
        return;
      }

      const impact = await buildFieldImpact(event, req.user!.id);

      res.json({
        message: 'Field impact retrieved successfully',
        ...impact,
      });
    } catch (error) {
      logger.error('Get field impact error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

router.get(
  '/:eventId/momentum',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { eventId } = req.params;
      const eventRepository = AppDataSource.getRepository(Event);
      const checkInLogRepository = AppDataSource.getRepository(CheckInLog);

      const event = await eventRepository.findOne({
        where: { eventId },
        relations: ['assignedUsers', 'pollingCenter'],
      });

      if (!event) {
        res.status(404).json({ message: 'Event not found' });
        return;
      }

      const userRole = req.user!.role as string;
      if (userRole !== UserRole.SUPER_ADMIN && userRole !== 'super_admin') {
        const isAssigned = event.assignedUsers.some((u) => u.id === req.user!.id);
        if (!isAssigned) {
          res.status(403).json({ message: 'Access denied' });
          return;
        }
      }

      const drillDown = JurisdictionService.parseDrillDownFilter(
        req.query as Record<string, unknown>
      );

      let registeredVotersInScope = await JurisdictionService.getRegisteredVotersInScope(event);
      const centersInScope = await JurisdictionService.getPollingCentersInEventScope(event);
      const activeCenters = JurisdictionService.filterCentersByDrillDown(centersInScope, drillDown);

      if (JurisdictionService.hasDrillDownFilter(drillDown) && activeCenters.length > 0) {
        registeredVotersInScope = JurisdictionService.getRegisteredVotersFromCenters(activeCenters);
      }

      const scopeLabel = JurisdictionService.hasDrillDownFilter(drillDown)
        ? JurisdictionService.drillDownFilterLabel(drillDown)
        : JurisdictionService.getScopeLabel(event);

      const hasDrillDown = JurisdictionService.hasDrillDownFilter(drillDown);

      const rowsQb = checkInLogRepository
        .createQueryBuilder('l')
        .innerJoin('l.participant', 'p')
        .select('l.checkedInAt', 'checkedInAt')
        .addSelect('p.ward', 'ward')
        .addSelect('p.constituency', 'constituency')
        .addSelect('p.pollingCenter', 'pollingCenter')
        .where('l.eventId = :eventId', { eventId });
      if (drillDown.county) {
        rowsQb.andWhere('p.county = :momCounty', { momCounty: drillDown.county });
      }
      if (drillDown.constituency) {
        rowsQb.andWhere('p.constituency = :momConstituency', {
          momConstituency: drillDown.constituency,
        });
      }
      if (drillDown.ward) {
        rowsQb.andWhere('p.ward = :momWard', { momWard: drillDown.ward });
      }
      if (drillDown.pollingCenter) {
        rowsQb.andWhere('p.pollingCenter = :momPc', { momPc: drillDown.pollingCenter });
      }

      const [rows, checkInTotal, dailyTrend] = await Promise.all([
        rowsQb.getRawMany(),
        hasDrillDown
          ? AnalyticsReadService.getTotalCheckInsInScope(eventId, drillDown)
          : AnalyticsReadService.getTotalCheckIns(eventId),
        hasDrillDown ? Promise.resolve(undefined) : AnalyticsReadService.getDailyTrendAsPoints(eventId),
      ]);

      const momentum = buildMomentumAnalytics({
        rows,
        registeredVoters: registeredVotersInScope,
        targetDate: event.date,
        scopeLabel,
        drillDown,
        checkInTotal,
        dailyTrend,
      });

      res.json({
        ...momentum,
        drill_down: {
          ...drillDown,
          filter_label: JurisdictionService.drillDownFilterLabel(drillDown),
        },
        scope_defaults: JurisdictionService.drillDownDefaultsFromEvent(event),
      });
    } catch (error) {
      logger.error('Get event momentum error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Get Event Analytics (For Report Preview)
router.get(
  '/:eventId/analytics',
  // authenticate, // Unprotected to allow PDF generation without token issues
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { eventId } = req.params;
      const pdfService = PdfService.getInstance();
      
      const analytics = await pdfService.getEventAnalytics(eventId);
      res.json(analytics);
    } catch (error) {
       logger.error('Get event analytics error:', error);
       res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Get field agent mobilization leaderboard (from summary tables)
router.get(
  '/:eventId/field-agents',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { eventId } = req.params;
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
      const skip = (page - 1) * limit;
      const search =
        typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const fetchAll = req.query.all === 'true';

      const eventRepository = AppDataSource.getRepository(Event);
      const event = await eventRepository.findOne({
        where: { eventId },
        relations: ['assignedUsers'],
      });

      if (!event) {
        res.status(404).json({ message: 'Event not found' });
        return;
      }

      if (!(await assertEventAccessForFieldUser(event, req.user!))) {
        res.status(403).json({ message: 'Access denied' });
        return;
      }

      const agentStatRepository = AppDataSource.getRepository(EventAgentStat);
      const baseQb = agentStatRepository
        .createQueryBuilder('s')
        .innerJoin(User, 'u', 'u.id = s.userId')
        .where('s.eventId = :eventId', { eventId });

      if (search) {
        baseQb.andWhere('u.name LIKE :search', { search: `%${search}%` });
      }

      const countResult = await baseQb
        .clone()
        .select('COUNT(DISTINCT s.userId)', 'total')
        .getRawOne<{ total: string }>();
      const total = Number(countResult?.total ?? 0);
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

      const agentsQuery = baseQb
        .select('s.userId', 'userId')
        .addSelect('u.name', 'name')
        .addSelect('u.email', 'email')
        .addSelect('SUM(s.uniqueMobilized)', 'mobilized')
        .addSelect('SUM(s.checkInCount)', 'checkIns')
        .groupBy('s.userId')
        .addGroupBy('u.name')
        .addGroupBy('u.email')
        .orderBy('mobilized', 'DESC')
        .addOrderBy('u.name', 'ASC');

      if (!fetchAll) {
        agentsQuery.offset(skip).limit(limit);
      }

      const rows = await agentsQuery.getRawMany<{
        userId: string;
        name: string;
        email: string;
        mobilized: string;
        checkIns: string;
      }>();

      const agents = rows.map((row) => ({
        userId: row.userId,
        name: row.name,
        email: row.email,
        mobilized: Number(row.mobilized) || 0,
        checkIns: Number(row.checkIns) || 0,
      }));

      if (fetchAll) {
        res.json({
          message: 'Field agents retrieved successfully',
          agents,
        });
        return;
      }

      res.json({
        message: 'Field agents retrieved successfully',
        agents,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      });
    } catch (error) {
      logger.error('Get field agents error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Get check-ins for an Event (paginated)
router.get(
  '/:eventId/checkins',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { eventId } = req.params;
      const { county, constituency, ward, pollingCenter } = req.query;
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
      const skip = (page - 1) * limit;
      const checkInLogRepository = AppDataSource.getRepository(CheckInLog);

      const eventRepository = AppDataSource.getRepository(Event);
      const event = await eventRepository.findOne({
        where: { eventId },
        relations: ['assignedUsers'],
      });
      if (!event) {
        res.status(404).json({ message: 'Event not found' });
        return;
      }

      if (!(await assertEventAccessForFieldUser(event, req.user!))) {
        res.status(403).json({ message: 'Access denied' });
        return;
      }

      const applyJurisdictionFilters = (
        qb: ReturnType<typeof checkInLogRepository.createQueryBuilder>
      ) => {
        if (county && typeof county === 'string') {
          qb.andWhere('participant.county = :county', { county });
        }
        if (constituency && typeof constituency === 'string') {
          qb.andWhere('participant.constituency = :constituency', { constituency });
        }
        if (ward && typeof ward === 'string') {
          qb.andWhere('participant.ward = :ward', { ward });
        }
        if (pollingCenter && typeof pollingCenter === 'string') {
          qb.andWhere('participant.pollingCenter = :pollingCenter', { pollingCenter });
        }
        return qb;
      };

      const countQb = checkInLogRepository
        .createQueryBuilder('log')
        .innerJoin('log.participant', 'participant')
        .where('log.eventId = :eventId', { eventId });
      applyJurisdictionFilters(countQb);
      const total = await countQb.getCount();
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

      let dataQb = checkInLogRepository
        .createQueryBuilder('log')
        .leftJoinAndSelect('log.participant', 'participant')
        .leftJoinAndSelect('log.checkedInBy', 'checkedInBy')
        .where('log.eventId = :eventId', { eventId })
        .orderBy('log.checkedInAt', 'DESC');
      applyJurisdictionFilters(dataQb);

      const checkIns = await dataQb.skip(skip).take(limit).getMany();

      res.json({
        message: 'Check-ins retrieved successfully',
        checkIns: checkIns.map(log => ({
          id: log.id,
          checkInDate: log.checkInDate,
          checkedInAt: log.checkedInAt,
          participant: {
            id: log.participant.id,
            idNumber: log.participant.idNumber,
            name: log.participant.name,
            sex: log.participant.sex,
            phoneNumber: log.participant.phoneNumber,
            county: log.participant.county,
            constituency: log.participant.constituency,
            ward: log.participant.ward,
            pollingCenter: log.participant.pollingCenter,
            isRegisteredVoter: log.participant.isRegisteredVoter,
            isInvited: log.participant.isInvited
          },
          checkedInBy: log.checkedInBy ? {
            id: log.checkedInBy.id,
            name: log.checkedInBy.name,
            email: log.checkedInBy.email
          } : null
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      });

    } catch (error) {
      logger.error('Get check-ins error:', {
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Generate Event Report PDF
router.get(
  '/:eventId/report',
  // authenticate, // REMOVED AUTH
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { eventId } = req.params;
      const pdfService = PdfService.getInstance();
      
      const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
      const buffer = await pdfService.generateEventReport(eventId, token);

      const eventRepository = AppDataSource.getRepository(Event);
      const event = await eventRepository.findOne({ where: { eventId } });
      const eventName = event?.eventName || 'event';
      const sanitizedName = eventName.replace(/[^a-z0-9]/gi, '_').toLowerCase();

      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${sanitizedName}-report.pdf"`,
        'Content-Length': String(buffer.length),
      });

      res.send(buffer);
    } catch (error) {
      logger.error('Generate event report error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error during report generation' });
    }
  }
);

// --- GLOBAL REPORT ENDPOINTS ---

// Download Global PDF Report
router.get(
  '/reports/global/download',
  // authenticate, // REMOVED AUTH
  // requireSuperAdmin, // REMOVED AUTH
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const pdfService = PdfService.getInstance();
      
      // Token for puppeteer authentication
      const token = req.cookies.token || req.headers.authorization?.split(' ')[1];

      const pdfBuffer = await pdfService.generateGlobalReport(token);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=UDA_Sensitization_Phase_3.pdf');
      res.send(pdfBuffer);

    } catch (error) {
      logger.error('Generate global report error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Failed to generate global report' });
    }
  }
);

// Get Global Analytics JSON (For Frontend Page)
router.get(
    '/analytics/global',
    // authenticate, // REMOVED AUTH
    // requireSuperAdmin, // REMOVED AUTH
    async (req: AuthRequest, res: Response): Promise<void> => {
      try {
        const pdfService = PdfService.getInstance();
        const { stats } = await pdfService.getGlobalAnalytics();
  
        res.status(200).json({
            stats
        });
  
      } catch (error) {
        logger.error('Get global analytics error:', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        res.status(500).json({ message: 'Failed to get global analytics' });
      }
    }
  );

// --- STAFF PERFORMANCE REPORT ENDPOINTS ---

// Get Staff Analytics
router.get(
  '/analytics/staff',
  // authenticate, // REMOVED AUTH
  // requireSuperAdmin, // REMOVED AUTH
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const pdfService = PdfService.getInstance();
      const analytics = await pdfService.getStaffAnalytics();
      res.json(analytics);
    } catch (error) {
       logger.error('Get staff analytics error:', error);
       res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Download Staff PDF Report
router.get(
  '/reports/staff/download',
  // authenticate, // REMOVED AUTH
  // requireSuperAdmin, // REMOVED AUTH
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const pdfService = PdfService.getInstance();
      
      const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
      const buffer = await pdfService.generateStaffReport(token);

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename=Staff_Performance_Report.pdf');
      res.send(buffer);

    } catch (error) {
      logger.error('Generate staff report error:', error);
      res.status(500).json({ message: 'Internal server error during staff report generation' });
    }
  }
);

// List surveys for an event (admin)
router.get(
  '/:eventId/surveys',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { eventId } = req.params;
      const eventRepository = AppDataSource.getRepository(Event);
      const event = await eventRepository.findOne({ where: { eventId } });
      if (!event) {
        res.status(404).json({ message: 'Event not found' });
        return;
      }

      const surveys = await SurveyReadService.listEventSurveys(eventId);
      res.json({ message: 'Surveys retrieved successfully', surveys });
    } catch (error) {
      logger.error('List event surveys error:', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Create draft survey for an event (admin)
router.post(
  '/:eventId/surveys',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { eventId } = req.params;
      const { name } = req.body;

      if (!name || typeof name !== 'string' || !name.trim()) {
        res.status(400).json({ message: 'Survey name is required' });
        return;
      }

      const eventRepository = AppDataSource.getRepository(Event);
      const event = await eventRepository.findOne({ where: { eventId } });
      if (!event) {
        res.status(404).json({ message: 'Event not found' });
        return;
      }

      const activeSurvey = await AppDataSource.getRepository(Survey).findOne({
        where: { eventId, status: SurveyStatus.ACTIVE },
      });
      if (activeSurvey) {
        res.status(400).json({ message: 'Close the active survey before creating another' });
        return;
      }

      const surveyRepo = AppDataSource.getRepository(Survey);
      const survey = surveyRepo.create({
        eventId,
        name: name.trim(),
        createdById: req.user!.id,
        status: SurveyStatus.DRAFT,
      });
      await surveyRepo.save(survey);

      const payload = await SurveyReadService.getSurveyWithStats(survey.id);
      res.status(201).json({
        message: 'Survey created successfully',
        survey: payload,
      });
    } catch (error) {
      logger.error('Create event survey error:', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Aggregated supporters across all surveys for an event (admin)
router.get(
  '/:eventId/supporter-breakdown',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { eventId } = req.params;
      const eventRepository = AppDataSource.getRepository(Event);
      const event = await eventRepository.findOne({ where: { eventId } });
      if (!event) {
        res.status(404).json({ message: 'Event not found' });
        return;
      }

      const breakdown = await SurveyReadService.getEventSupporterJurisdictionBreakdown(eventId);
      res.json({
        message: 'Event supporter breakdown retrieved successfully',
        breakdown,
      });
    } catch (error) {
      logger.error('Event supporter breakdown error:', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

export default router;

