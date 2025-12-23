import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { Participant } from '../entities/Participant';

export class AnalyticsController {
  static async getEventHierarchyStats(req: Request, res: Response) {
      const { eventId } = req.params;
      const { level, parentName } = req.query;

      if (!eventId || !level) {
        return res.status(400).json({ message: 'Event ID and level are required' });
      }

      const participantRepo = AppDataSource.getRepository(Participant);
      let groupByField = '';
      let parentFilterField = '';

      // Determine grouping based on level
      switch (level) {
        case 'county':
          groupByField = 'participant.county';
          break;
        case 'constituency':
          groupByField = 'participant.constituency';
          parentFilterField = 'participant.county';
          break;
        case 'ward':
          groupByField = 'participant.ward';
          parentFilterField = 'participant.constituency';
          break;
        case 'group':
          groupByField = 'participant.group';
          // group usually doesn't have a parent filter in this hierarchy context, but if needed we can add checks
          break;
        default:
          return res.status(400).json({ message: 'Invalid level' });
      }

      // Check-ins from Participant table joined with CheckInLogs
      const query = participantRepo
        .createQueryBuilder('participant')
        .innerJoin('participant.checkInLogs', 'log') // Inner join ensures only checked-in participants are counted
        .select(`${groupByField}`, 'name')
        .addSelect('COUNT(DISTINCT participant.id)', 'totalCheckedIn') // Count distinct participants
        .where('participant.eventId = :eventId', { eventId })
        .andWhere(`${groupByField} IS NOT NULL`)
        .andWhere(`${groupByField} != ''`);

      if (parentName && parentFilterField) {
        query.andWhere(`${parentFilterField} = :parentName`, { parentName });
      }

      const stats = await query
        .groupBy(groupByField)
        .orderBy('totalCheckedIn', 'DESC') // Sort by count desc
        .getRawMany();

      // Format response to match expected frontend structure (lightweight)
      const formattedStats = stats.map(stat => ({
        name: stat.name,
        totalCheckedIn: parseInt(stat.totalCheckedIn) || 0,
        // Legacy fields for compatibility if frontend expects them, or just 0s
        totalRegistered: 0,
        performancePercentage: 0,
        status: 'neutral'
      }));

      return res.json(formattedStats);
  }
}
