import { Router, Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Event } from '../entities/Event';
import { Participant } from '../entities/Participant';
import { CheckInLog } from '../entities/CheckInLog';
import { User, UserRole } from '../entities/User';
import { authenticate } from '../middleware/auth';
import { lookupVoter } from '../services/voterLookup';
import logger from '../config/logger';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Helper function to check event access
async function checkEventAccess(
  event: Event,
  user: User
): Promise<boolean> {
  const userRole = user.role as string;
  if (userRole === UserRole.SUPER_ADMIN || userRole === 'super_admin') {
    // Super admins can access all events
    return true;
  } else if (userRole === UserRole.ADMIN || userRole === 'admin') {
    return event.createdById === user.id;
  } else {
    return user.adminId !== null && event.createdById === user.adminId;
  }
}

// Search participant (from local database)
router.post(
  '/search',
  async (req: any, res: Response): Promise<void> => {
    try {
      const { eventId, idNumber } = req.body;

      if (!eventId || !idNumber) {
        res.status(400).json({
          message: 'Event ID and ID number are required',
        });
        return;
      }

      const participantRepository = AppDataSource.getRepository(Participant);
      
      // Search directly in participants table
      const participants = await participantRepository.find({
        where: { idNumber, eventId },
        relations: ['checkInLogs'],
      });

      if (participants.length === 0) {
        res.status(404).json({ message: 'Participant not found' });
        return;
      }

      res.json({
        message: 'Participant found',
        participant: participants[0], // Return first match if multiples exist
        allMatches: participants,
      });
    } catch (error) {
      logger.error('Search participant error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Check-in participant
router.post(
  '/checkin',
  authenticate,
  async (req: any, res: Response): Promise<void> => {
    try {
      const {
        eventId,
        idNumber,
      } = req.body;

      if (!eventId || !idNumber) {
        res.status(400).json({
          message:
            'Event ID and ID number are required',
        });
        return;
      }

      // Verify event exists
      const eventRepository = AppDataSource.getRepository(Event);
      const event = await eventRepository.findOne({
        where: { eventId },
      });

      if (!event) {
        res.status(404).json({ message: 'Event not found' });
        return;
      }

      const participantRepository = AppDataSource.getRepository(Participant);
      const checkInLogRepository = AppDataSource.getRepository(CheckInLog);

      // Find participant
      const participant = await participantRepository.findOne({
        where: {
          eventId,
          idNumber,
        },
      });

      if (!participant) {
        res.status(404).json({ message: 'Participant not found. Please register first.' });
        return;
      }

      // Check if already checked in today
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const existingCheckIn = await checkInLogRepository.findOne({
        where: {
          participantId: participant.id,
          eventId,
          checkInDate: today,
        },
      });

      if (existingCheckIn) {
        res.status(400).json({
          message: 'Participant already checked in today',
        });
        return;
      }

      // Create check-in log
      const checkInLog = checkInLogRepository.create({
        participantId: participant.id,
        eventId,
        checkedInById: req.user ? req.user.id : null,
        checkInDate: today,
        checkedInAt: new Date(),
      });

      await checkInLogRepository.save(checkInLog);

      res.status(201).json({
        message: 'Participant checked in successfully',
        checkIn: {
          id: checkInLog.id,
          participantId: participant.id,
          eventId,
          checkInDate: checkInLog.checkInDate,
          checkedInAt: checkInLog.checkedInAt,
        },
        participant: {
          id: participant.id,
          idNumber: participant.idNumber,
          name: participant.name,
        },
      });
    } catch (error) {
      logger.error('Check-in participant error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Add participant
router.post(
  '/add',
  async (req: any, res: Response): Promise<void> => {
    try {
      const participantRepository = AppDataSource.getRepository(Participant);
      const participantData = req.body;
      
      // Use provided ID or generate a new UUID
      if (!participantData.id) {
        participantData.id = uuidv4();
      }

      const participant = participantRepository.create(participantData);
      await participantRepository.save(participant);
      res.status(201).json({ message: 'Participant added successfully', participant });
    } catch (error) {
      res.status(500).json({ message: 'Error adding participant' });
    }
  }
);

// Edit participant
router.patch(
  '/:id/edit',
  async (req: any, res: Response): Promise<void> => {
    try {
      const { id } = req.params;
      const participantRepository = AppDataSource.getRepository(Participant);
      await participantRepository.update(id, req.body);
      const updated = await participantRepository.findOne({ where: { id } });
      res.json({ message: 'Participant updated successfully', participant: updated });
    } catch (error) {
      res.status(500).json({ message: 'Error updating participant' });
    }
  }
);

// Get participants for an event with advanced filtering
router.get(
  '/event/:eventId',
  async (req: any, res: Response): Promise<void> => {
    try {
      const { eventId } = req.params;
      const { 
        noId, 
        duplicates, 
        county, 
        constituency, 
        ward, 
        noPhone,
        search,
        page,
        limit
      } = req.query;

      const participantRepository = AppDataSource.getRepository(Participant);
      let query = participantRepository.createQueryBuilder('p')
        .leftJoinAndSelect('p.checkInLogs', 'logs')
        .leftJoinAndSelect('logs.checkedInBy', 'user')
        .where('p.eventId = :eventId', { eventId });

      if (noId === 'true') {
        query = query.andWhere('(p.idNumber IS NULL OR p.idNumber = \'\')');
      }

      if (noPhone === 'true') {
        query = query.andWhere('(p.phoneNumber IS NULL OR p.phoneNumber = \'\')');
      }

      if (county) {
        query = query.andWhere('p.county = :county', { county });
      }

      if (constituency) {
        query = query.andWhere('p.constituency = :constituency', { constituency });
      }

      if (ward) {
        query = query.andWhere('p.ward = :ward', { ward });
      }

      if (search) {
        query = query.andWhere('(p.name ILIKE :search OR p.idNumber ILIKE :search)', { search: `%${search}%` });
      }

      if (duplicates === 'true') {
        // Filter for participants whose ID number appears more than once in this event
        query = query.andWhere((qb) => {
            const subQuery = qb.subQuery()
                .select('dup.idNumber')
                .from(Participant, 'dup')
                .where('dup.eventId = :eventId', { eventId })
                .andWhere('dup.idNumber IS NOT NULL')
                .andWhere('dup.idNumber != \'\'')
                .groupBy('dup.idNumber')
                .having('COUNT(dup.idNumber) > 1')
                .getQuery();
            return `p.idNumber IN ${subQuery}`;
        });
      }

      // Pagination
      const pageNum = parseInt(page as string) || 1;
      const limitNum = parseInt(limit as string) || 10;
      const skip = (pageNum - 1) * limitNum;

      // Get count and data
      const [participants, total] = await query
        .orderBy('p.createdAt', 'DESC')
        .skip(skip)
        .take(limitNum)
        .getManyAndCount();

      // No post-processing needed for duplicates now
      const finalParticipants = participants;
      // Compute statistics (server-side for accuracy with pagination)
      const statsQueryInfo = await participantRepository.createQueryBuilder('p')
          .select('COUNT(*)', 'totalParticipants')
          .addSelect('COUNT(CASE WHEN p.idNumber IS NULL OR p.idNumber = \'\' THEN 1 END)', 'missingIds')
          .addSelect('COUNT(CASE WHEN p.phoneNumber IS NULL OR p.phoneNumber = \'\' THEN 1 END)', 'missingPhones')
          .where('p.eventId = :eventId', { eventId })
          .getRawOne();

      // Count duplicates (IDs that appear more than once)
      const duplicateStats = await participantRepository.createQueryBuilder('p')
          .select('COUNT(*)', 'count')
          .where('p.eventId = :eventId', { eventId })
          .andWhere('p.idNumber IS NOT NULL')
          .andWhere('p.idNumber != \'\'')
          .groupBy('p.idNumber')
          .having('COUNT(*) > 1')
          .getRawMany();
      
      const duplicateCount = duplicateStats.length; // Number of groups having duplicates (distinct IDs that are duplicated)
      // Alternatively, if we want total duplicate records: sum of (count - 1) or just count of records involved.
      // Usually "Duplicate IDs" card implies "How many IDs are duplicated?" or "How many records are duplicates?".
      // Let's stick to "Number of IDs that have duplicates" or "Number of records that are duplicates".
      // Based on UI "Duplicate IDs" likely means number of records that are duplicates.
      // E.g. if ID "123" appears 3 times, is it 1 duplicate (the ID) or 3 records?
      // The frontend logic was: `participants.filter((p, i, a) => p.idNumber && a.filter(x => x.idNumber === p.idNumber).length > 1).length`
      // This counts ALL records that are part of a duplicate set.
      
      const totalDuplicateRecords = duplicateStats.reduce((acc, curr) => acc + parseInt(curr.count), 0);

      res.json({
        message: 'Participants retrieved successfully',
        participants: finalParticipants,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          totalPages: Math.ceil(total / limitNum)
        },
        stats: {
            totalParticipants: parseInt(statsQueryInfo.totalParticipants || '0'), 
            missingIds: parseInt(statsQueryInfo.missingIds || '0'),
            missingPhones: parseInt(statsQueryInfo.missingPhones || '0'),
            duplicates: totalDuplicateRecords
        }
      });
    } catch (error) {
      logger.error('Get participants error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Get participants checked in on a specific date
router.get(
  '/event/:eventId/date/:date',
  authenticate,
  async (req: any, res: Response): Promise<void> => {
    try {
      const { eventId, date } = req.params;

      // Verify event exists
      const eventRepository = AppDataSource.getRepository(Event);
      const event = await eventRepository.findOne({
        where: { eventId },
      });

      if (!event) {
        res.status(404).json({ message: 'Event not found' });
        return;
      }

      // Check event access
      // if (!(await checkEventAccess(event, req.user!))) {
      //   res.status(403).json({ message: 'Access denied to this event' });
      //   return;
      // }

      // Parse date (format: YYYY-MM-DD)
      const targetDate = new Date(date);
      if (isNaN(targetDate.getTime())) {
        res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD' });
        return;
      }
      targetDate.setHours(0, 0, 0, 0);

      const checkInLogRepository = AppDataSource.getRepository(CheckInLog);
      const checkInLogs = await checkInLogRepository.find({
        where: {
          eventId,
          checkInDate: targetDate,
        },
        relations: ['participant', 'checkedInBy'],
        order: { checkedInAt: 'DESC' },
      });

      res.json({
        message: 'Participants retrieved successfully',
        date: date,
        count: checkInLogs.length,
        participants: checkInLogs.map((log) => ({
          checkInId: log.id,
          checkInDate: log.checkInDate,
          checkedInAt: log.checkedInAt,
          participant: {
            id: log.participant.id,
            idNumber: log.participant.idNumber,
            name: log.participant.name,
            dateOfBirth: log.participant.dateOfBirth,
            sex: log.participant.sex,
            county: log.participant.county,
            constituency: log.participant.constituency,
            ward: log.participant.ward,
          },
            checkedInBy: log.checkedInBy ? {
              id: log.checkedInBy.id,
              name: log.checkedInBy.name,
              email: log.checkedInBy.email,
            } : null,
        })),
      });
    } catch (error) {
      logger.error('Get participants by date error:', {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

export default router;
