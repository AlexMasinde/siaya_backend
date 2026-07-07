import { AppDataSource } from '../config/database';
import { Participant } from '../entities/Participant';
import { EventMobilizationAssignment } from '../entities/EventMobilizationAssignment';
import { MAX_MOBILIZER_ASSIGNMENTS } from './MobilizationAccessService';
import { MobilizationRosterService } from './MobilizationRosterService';
import { pollingCenterLabel, normalizePollingCenterFields } from '../utils/mobilizationPollingCenter';

export interface MobilizationParticipantFilters {
  search?: string;
  ward?: string;
  pollingCenter?: string;
  assignmentStatus?: 'all' | 'assigned' | 'unassigned';
  mobilizerUserId?: string;
  voted?: 'all' | 'voted' | 'not_voted';
  page?: number;
  limit?: number;
}

export interface MobilizationParticipantRow {
  id: string;
  name: string | null;
  idNumber: string | null;
  phoneNumber: string | null;
  ward: string | null;
  constituency: string | null;
  pollingCenter: string | null;
  assignmentId: string | null;
  mobilizerUserId: string | null;
  mobilizerName: string | null;
  voted: boolean;
}

export interface MobilizationMonitorRow {
  mobilizerUserId: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  pollingCenterLabel: string | null;
  assigned: number;
  voted: number;
  outstanding: number;
  slotsRemaining: number;
}

export interface MobilizationPoolRow {
  id: string;
  name: string | null;
  idNumber: string | null;
  phoneNumber: string | null;
  ward: string | null;
  constituency: string | null;
  pollingCenter: string | null;
}

export interface MobilizationMyAssignmentRow {
  id: string;
  participantId: string;
  participantName: string | null;
  phoneNumber: string | null;
  ward: string;
  constituency: string;
  pollingCenter: string;
  voted: boolean;
  votedAt: string | null;
}

export class MobilizationReadService {
  static async listParticipants(
    eventId: string,
    filters: MobilizationParticipantFilters
  ): Promise<{ participants: MobilizationParticipantRow[]; total: number; page: number; limit: number }> {
    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 20));
    const skip = (page - 1) * limit;

    let qb = AppDataSource.getRepository(Participant)
      .createQueryBuilder('p')
      .leftJoin(
        EventMobilizationAssignment,
        'a',
        'a.participantId = p.id AND a.eventId = :eventId',
        { eventId }
      )
      .leftJoin('users', 'm', 'm.id = a.mobilizerUserId')
      .where('p.eventId = :eventId', { eventId });

    if (filters.search?.trim()) {
      qb = qb.andWhere('(p.name LIKE :search OR p.idNumber LIKE :search)', {
        search: `%${filters.search.trim()}%`,
      });
    }
    if (filters.ward) {
      qb = qb.andWhere('p.ward = :ward', { ward: filters.ward });
    }
    if (filters.pollingCenter) {
      qb = qb.andWhere('p.pollingCenter = :pollingCenter', {
        pollingCenter: filters.pollingCenter,
      });
    }
    if (filters.assignmentStatus === 'assigned') {
      qb = qb.andWhere('a.id IS NOT NULL');
    } else if (filters.assignmentStatus === 'unassigned') {
      qb = qb.andWhere('a.id IS NULL');
    }
    if (filters.mobilizerUserId) {
      qb = qb.andWhere('a.mobilizerUserId = :mobilizerUserId', {
        mobilizerUserId: filters.mobilizerUserId,
      });
    }
    if (filters.voted === 'voted') {
      qb = qb.andWhere('a.votedAt IS NOT NULL');
    } else if (filters.voted === 'not_voted') {
      qb = qb.andWhere('a.id IS NOT NULL AND a.votedAt IS NULL');
    }

    const total = await qb.getCount();

    const rows = await qb
      .select([
        'p.id AS id',
        'p.name AS name',
        'p.idNumber AS idNumber',
        'p.phoneNumber AS phoneNumber',
        'p.ward AS ward',
        'p.constituency AS constituency',
        'p.pollingCenter AS pollingCenter',
        'a.id AS assignmentId',
        'a.mobilizerUserId AS mobilizerUserId',
        'm.name AS mobilizerName',
        'a.votedAt AS votedAt',
      ])
      .orderBy('p.name', 'ASC')
      .offset(skip)
      .limit(limit)
      .getRawMany<{
        id: string;
        name: string | null;
        idNumber: string | null;
        phoneNumber: string | null;
        ward: string | null;
        constituency: string | null;
        pollingCenter: string | null;
        assignmentId: string | null;
        mobilizerUserId: string | null;
        mobilizerName: string | null;
        votedAt: Date | null;
      }>();

    return {
      participants: rows.map((row) => ({
        id: row.id,
        name: row.name,
        idNumber: row.idNumber,
        phoneNumber: row.phoneNumber,
        ward: row.ward,
        constituency: row.constituency,
        pollingCenter: row.pollingCenter,
        assignmentId: row.assignmentId,
        mobilizerUserId: row.mobilizerUserId,
        mobilizerName: row.mobilizerName,
        voted: row.votedAt != null,
      })),
      total,
      page,
      limit,
    };
  }

  static async listMobilizerPool(
    eventId: string,
    mobilizerUserId: string,
    filters: { search?: string; page?: number; limit?: number }
  ): Promise<{
    participants: MobilizationPoolRow[];
    total: number;
    page: number;
    limit: number;
    slotsRemaining: number;
    pollingCenterLabel: string;
  }> {
    const assignedPc = await MobilizationRosterService.getMobilizerPollingCenterOrThrow(
      eventId,
      mobilizerUserId
    );
    const current = await AppDataSource.getRepository(EventMobilizationAssignment).count({
      where: { eventId, mobilizerUserId },
    });
    const slotsRemaining = Math.max(0, MAX_MOBILIZER_ASSIGNMENTS - current);

    const page = Math.max(1, filters.page ?? 1);
    const limit = Math.min(100, Math.max(1, filters.limit ?? 50));
    const skip = (page - 1) * limit;

    let qb = AppDataSource.getRepository(Participant)
      .createQueryBuilder('p')
      .leftJoin(
        EventMobilizationAssignment,
        'a',
        'a.participantId = p.id AND a.eventId = :eventId',
        { eventId }
      )
      .where('p.eventId = :eventId', { eventId })
      .andWhere('p.isRegisteredVoter = 1')
      .andWhere('p.pollingCenter = :pollingCenter', { pollingCenter: assignedPc.pollingCenter })
      .andWhere('p.ward = :ward', { ward: assignedPc.ward })
      .andWhere('p.constituency = :constituency', { constituency: assignedPc.constituency })
      .andWhere('a.id IS NULL');

    const search = filters.search?.trim();
    if (search) {
      const digitsOnly = search.replace(/\s/g, '');
      if (/^\d{4,}$/.test(digitsOnly)) {
        qb = qb.andWhere('(p.idNumber LIKE :idPrefix OR p.name LIKE :search)', {
          idPrefix: `${digitsOnly}%`,
          search: `%${search}%`,
        });
      } else {
        qb = qb.andWhere('(p.name LIKE :search OR p.idNumber LIKE :search)', {
          search: `%${search}%`,
        });
      }
    }

    const total = await qb.getCount();

    const rows = await qb
      .select([
        'p.id AS id',
        'p.name AS name',
        'p.idNumber AS idNumber',
        'p.phoneNumber AS phoneNumber',
        'p.ward AS ward',
        'p.constituency AS constituency',
        'p.pollingCenter AS pollingCenter',
      ])
      .orderBy('p.name', 'ASC')
      .offset(skip)
      .limit(limit)
      .getRawMany<MobilizationPoolRow>();

    const { pollingCenterLabel: pcLabel } = { pollingCenterLabel: pollingCenterLabel(assignedPc) };

    return {
      participants: rows,
      total,
      page,
      limit,
      slotsRemaining,
      pollingCenterLabel: pcLabel,
    };
  }

  static async getMonitor(eventId: string): Promise<{
    totals: { assigned: number; voted: number; outstanding: number };
    mobilizers: MobilizationMonitorRow[];
  }> {
    const rows = (await AppDataSource.query(
      `SELECT
         r.userId AS mobilizerUserId,
         u.name,
         u.email,
         u.phoneNumber,
         r.assignedPollingCenter,
         r.assignedWard,
         r.assignedConstituency,
         COUNT(a.id) AS assigned,
         SUM(CASE WHEN a.votedAt IS NOT NULL THEN 1 ELSE 0 END) AS voted
       FROM event_mobilization_roles r
       INNER JOIN users u ON u.id = r.userId
       LEFT JOIN event_mobilization_assignments a
         ON a.eventId = r.eventId AND a.mobilizerUserId = r.userId
       WHERE r.eventId = ? AND r.role = 'mobilizer'
       GROUP BY r.userId, u.name, u.email, u.phoneNumber,
                r.assignedPollingCenter, r.assignedWard, r.assignedConstituency
       ORDER BY (COUNT(a.id) - SUM(CASE WHEN a.votedAt IS NOT NULL THEN 1 ELSE 0 END)) DESC,
                u.name ASC`,
      [eventId]
    )) as Array<{
      mobilizerUserId: string;
      name: string;
      email: string;
      phoneNumber: string | null;
      assignedPollingCenter: string | null;
      assignedWard: string;
      assignedConstituency: string;
      assigned: string;
      voted: string;
    }>;

    const mobilizers: MobilizationMonitorRow[] = rows.map((row) => {
      const assigned = Number(row.assigned) || 0;
      const voted = Number(row.voted) || 0;
      const pc = row.assignedPollingCenter
        ? normalizePollingCenterFields(
            row.assignedPollingCenter,
            row.assignedWard,
            row.assignedConstituency
          )
        : null;
      return {
        mobilizerUserId: row.mobilizerUserId,
        name: row.name,
        email: row.email,
        phoneNumber: row.phoneNumber,
        pollingCenterLabel: pc ? pollingCenterLabel(pc) : null,
        assigned,
        voted,
        outstanding: Math.max(0, assigned - voted),
        slotsRemaining: Math.max(0, MAX_MOBILIZER_ASSIGNMENTS - assigned),
      };
    });

    const assigned = mobilizers.reduce((s, m) => s + m.assigned, 0);
    const voted = mobilizers.reduce((s, m) => s + m.voted, 0);

    return {
      totals: {
        assigned,
        voted,
        outstanding: Math.max(0, assigned - voted),
      },
      mobilizers,
    };
  }

  static async listMyAssignments(
    eventId: string,
    mobilizerUserId: string,
    votedFilter?: 'all' | 'voted' | 'not_voted'
  ): Promise<MobilizationMyAssignmentRow[]> {
    let sql = `SELECT
         a.id,
         a.participantId,
         a.participantName,
         a.phoneNumber,
         a.ward,
         a.constituency,
         a.pollingCenter,
         a.votedAt
       FROM event_mobilization_assignments a
       WHERE a.eventId = ? AND a.mobilizerUserId = ?`;
    const params: unknown[] = [eventId, mobilizerUserId];

    if (votedFilter === 'voted') {
      sql += ' AND a.votedAt IS NOT NULL';
    } else if (votedFilter === 'not_voted') {
      sql += ' AND a.votedAt IS NULL';
    }

    sql += ' ORDER BY a.votedAt IS NULL DESC, a.participantName ASC, a.id ASC';

    const rows = (await AppDataSource.query(sql, params)) as Array<{
      id: string;
      participantId: string;
      participantName: string | null;
      phoneNumber: string | null;
      ward: string;
      constituency: string;
      pollingCenter: string;
      votedAt: Date | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      participantId: row.participantId,
      participantName: row.participantName,
      phoneNumber: row.phoneNumber,
      ward: row.ward,
      constituency: row.constituency,
      pollingCenter: row.pollingCenter,
      voted: row.votedAt != null,
      votedAt: row.votedAt ? new Date(row.votedAt).toISOString() : null,
    }));
  }

  static async getMobilizerAssignmentCounts(
    eventId: string
  ): Promise<Record<string, { assigned: number; remaining: number }>> {
    const rows = (await AppDataSource.query(
      `SELECT mobilizerUserId, COUNT(*) AS assigned
       FROM event_mobilization_assignments
       WHERE eventId = ?
       GROUP BY mobilizerUserId`,
      [eventId]
    )) as Array<{ mobilizerUserId: string; assigned: string }>;

    const out: Record<string, { assigned: number; remaining: number }> = {};
    for (const row of rows) {
      const assigned = Number(row.assigned) || 0;
      out[row.mobilizerUserId] = {
        assigned,
        remaining: Math.max(0, MAX_MOBILIZER_ASSIGNMENTS - assigned),
      };
    }
    return out;
  }
}
