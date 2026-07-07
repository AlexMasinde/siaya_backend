import { v4 as uuidv4 } from 'uuid';
import { In } from 'typeorm';
import { AppDataSource } from '../config/database';
import { EventMobilizationRole, EventMobilizationRoleType } from '../entities/EventMobilizationRole';
import { EventMobilizationAssignment } from '../entities/EventMobilizationAssignment';
import { User } from '../entities/User';
import {
  hasEventMembership,
  MAX_MOBILIZERS_PER_COORDINATOR,
  MobilizationAccessError,
} from './MobilizationAccessService';
import {
  MobilizerPollingCenter,
  normalizePollingCenterFields,
  pollingCenterLabel,
} from '../utils/mobilizationPollingCenter';

export interface MobilizationRoleRow {
  id: string;
  userId: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  role: EventMobilizationRoleType;
  assignedPollingCenter: string | null;
  assignedWard: string;
  assignedConstituency: string;
  pollingCenterLabel: string | null;
  addedById: string;
  createdAt: Date;
}

export interface CoordinatorMobilizerCapacity {
  mobilizersAdded: number;
  maxMobilizers: number;
  slotsRemaining: number;
}

export interface EligibleEventUser {
  id: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  onRoster: boolean;
  rosterRole: EventMobilizationRoleType | null;
}

export interface EventPollingCenterOption {
  pollingCenter: string;
  ward: string;
  constituency: string;
  label: string;
  registeredVoters: number;
}

function mapRoleRow(row: EventMobilizationRole, user: User): MobilizationRoleRow {
  const pc =
    row.role === EventMobilizationRoleType.MOBILIZER && row.assignedPollingCenter
      ? normalizePollingCenterFields(
          row.assignedPollingCenter,
          row.assignedWard,
          row.assignedConstituency
        )
      : null;
  return {
    id: row.id,
    userId: row.userId,
    name: user.name,
    email: user.email,
    phoneNumber: user.phoneNumber,
    role: row.role,
    assignedPollingCenter: row.assignedPollingCenter,
    assignedWard: row.assignedWard,
    assignedConstituency: row.assignedConstituency,
    pollingCenterLabel: pc ? pollingCenterLabel(pc) : null,
    addedById: row.addedById,
    createdAt: row.createdAt,
  };
}

export class MobilizationRosterService {
  static async listEventPollingCenters(eventId: string): Promise<EventPollingCenterOption[]> {
    const rows = (await AppDataSource.query(
      `SELECT
         pollingCenter,
         ward,
         constituency,
         COUNT(*) AS registeredVoters
       FROM participants
       WHERE eventId = ?
         AND isRegisteredVoter = 1
         AND pollingCenter IS NOT NULL
         AND pollingCenter != ''
       GROUP BY pollingCenter, ward, constituency
       ORDER BY constituency ASC, ward ASC, pollingCenter ASC`,
      [eventId]
    )) as Array<{
      pollingCenter: string;
      ward: string | null;
      constituency: string | null;
      registeredVoters: string;
    }>;

    return rows.map((row) => {
      const pc = normalizePollingCenterFields(
        row.pollingCenter,
        row.ward,
        row.constituency
      );
      return {
        ...pc,
        label: pollingCenterLabel(pc),
        registeredVoters: Number(row.registeredVoters) || 0,
      };
    });
  }

  static async assertPollingCenterExists(
    eventId: string,
    pollingCenter: MobilizerPollingCenter
  ): Promise<void> {
    const centers = await this.listEventPollingCenters(eventId);
    const exists = centers.some(
      (c) =>
        c.pollingCenter === pollingCenter.pollingCenter &&
        c.ward === pollingCenter.ward &&
        c.constituency === pollingCenter.constituency
    );
    if (!exists) {
      throw new MobilizationAccessError('Polling center not found on this campaign', 400);
    }
  }

  static async listRoles(eventId: string): Promise<MobilizationRoleRow[]> {
    const rows = await AppDataSource.getRepository(EventMobilizationRole)
      .createQueryBuilder('r')
      .innerJoinAndSelect('r.user', 'user')
      .where('r.eventId = :eventId', { eventId })
      .orderBy('r.role', 'ASC')
      .addOrderBy('user.name', 'ASC')
      .getMany();

    return rows.map((row) => mapRoleRow(row, row.user));
  }

  static async listEligibleUsers(eventId: string): Promise<EligibleEventUser[]> {
    const users = await AppDataSource.getRepository(User)
      .createQueryBuilder('user')
      .innerJoin('user.assignedEvents', 'event', 'event.eventId = :eventId', { eventId })
      .orderBy('user.name', 'ASC')
      .getMany();

    const roster = await AppDataSource.getRepository(EventMobilizationRole).find({
      where: { eventId },
    });
    const rosterByUser = new Map(roster.map((r) => [r.userId, r.role]));

    return users.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      phoneNumber: user.phoneNumber,
      onRoster: rosterByUser.has(user.id),
      rosterRole: rosterByUser.get(user.id) ?? null,
    }));
  }

  static async countMobilizersAddedBy(eventId: string, coordinatorId: string): Promise<number> {
    return AppDataSource.getRepository(EventMobilizationRole).count({
      where: {
        eventId,
        role: EventMobilizationRoleType.MOBILIZER,
        addedById: coordinatorId,
      },
    });
  }

  static getCoordinatorMobilizerCapacity(mobilizersAdded: number): CoordinatorMobilizerCapacity {
    return {
      mobilizersAdded,
      maxMobilizers: MAX_MOBILIZERS_PER_COORDINATOR,
      slotsRemaining: Math.max(0, MAX_MOBILIZERS_PER_COORDINATOR - mobilizersAdded),
    };
  }

  static async getCoordinatorMobilizerCapacityForUser(
    eventId: string,
    coordinatorId: string
  ): Promise<CoordinatorMobilizerCapacity> {
    const mobilizersAdded = await this.countMobilizersAddedBy(eventId, coordinatorId);
    return this.getCoordinatorMobilizerCapacity(mobilizersAdded);
  }

  static async assertCoordinatorMobilizerCapacity(
    eventId: string,
    coordinatorId: string
  ): Promise<void> {
    const { mobilizersAdded } = await this.getCoordinatorMobilizerCapacityForUser(
      eventId,
      coordinatorId
    );
    if (mobilizersAdded >= MAX_MOBILIZERS_PER_COORDINATOR) {
      throw new MobilizationAccessError(
        `You cannot add more than ${MAX_MOBILIZERS_PER_COORDINATOR} mobilizers (currently ${mobilizersAdded})`,
        400
      );
    }
  }

  static async addRole(
    eventId: string,
    userId: string,
    role: EventMobilizationRoleType,
    addedById: string,
    pollingCenter?: MobilizerPollingCenter | null,
    options?: { enforceCoordinatorCapacity?: boolean }
  ): Promise<MobilizationRoleRow> {
    if (!Object.values(EventMobilizationRoleType).includes(role)) {
      throw new MobilizationAccessError('Invalid role', 400);
    }

    if (role === EventMobilizationRoleType.MOBILIZER) {
      if (!pollingCenter?.pollingCenter) {
        throw new MobilizationAccessError('Polling center is required for mobilizers', 400);
      }
      await this.assertPollingCenterExists(eventId, pollingCenter);
      if (options?.enforceCoordinatorCapacity) {
        await this.assertCoordinatorMobilizerCapacity(eventId, addedById);
      }
    }

    const onEvent = await hasEventMembership(userId, eventId);
    if (!onEvent) {
      throw new MobilizationAccessError('User must be assigned to this event first', 400);
    }

    const repo = AppDataSource.getRepository(EventMobilizationRole);
    const existing = await repo.findOne({ where: { eventId, userId } });
    if (existing) {
      throw new MobilizationAccessError('User already has a mobilization role on this event', 400);
    }

    const user = await AppDataSource.getRepository(User).findOne({ where: { id: userId } });
    if (!user) {
      throw new MobilizationAccessError('User not found', 404);
    }

    const normalizedPc =
      role === EventMobilizationRoleType.MOBILIZER && pollingCenter
        ? normalizePollingCenterFields(
            pollingCenter.pollingCenter,
            pollingCenter.ward,
            pollingCenter.constituency
          )
        : null;

    const row = repo.create({
      id: uuidv4(),
      eventId,
      userId,
      role,
      assignedPollingCenter: normalizedPc?.pollingCenter ?? null,
      assignedWard: normalizedPc?.ward ?? '',
      assignedConstituency: normalizedPc?.constituency ?? '',
      addedById,
    });
    await repo.save(row);

    return mapRoleRow(row, user);
  }

  static async findRole(eventId: string, userId: string): Promise<EventMobilizationRole | null> {
    return AppDataSource.getRepository(EventMobilizationRole).findOne({
      where: { eventId, userId },
    });
  }

  static async getMobilizerPollingCenterOrThrow(
    eventId: string,
    userId: string
  ): Promise<MobilizerPollingCenter> {
    const row = await this.findRole(eventId, userId);
    if (!row || row.role !== EventMobilizationRoleType.MOBILIZER) {
      throw new MobilizationAccessError('Mobilizer role not found', 404);
    }
    if (!row.assignedPollingCenter) {
      throw new MobilizationAccessError('Mobilizer has no polling center assigned', 400);
    }
    return normalizePollingCenterFields(
      row.assignedPollingCenter,
      row.assignedWard,
      row.assignedConstituency
    );
  }

  static async removeRole(eventId: string, userId: string): Promise<void> {
    const repo = AppDataSource.getRepository(EventMobilizationRole);
    const existing = await repo.findOne({ where: { eventId, userId } });
    if (!existing) {
      throw new MobilizationAccessError('Role not found', 404);
    }
    await AppDataSource.getRepository(EventMobilizationAssignment).delete({
      eventId,
      mobilizerUserId: userId,
    });
    await repo.remove(existing);
  }

  static async listMyMobilizerEvents(userId: string): Promise<
    Array<{
      eventId: string;
      eventName: string;
      eventDate: string | null;
      role: EventMobilizationRoleType;
      assigned: number;
      voted: number;
      outstanding: number;
      pollingCenterLabel: string | null;
    }>
  > {
    const rows = (await AppDataSource.query(
      `SELECT
         e.eventId,
         e.eventName,
         e.date AS eventDate,
         r.role,
         r.assignedPollingCenter,
         r.assignedWard,
         r.assignedConstituency,
         COUNT(a.id) AS assigned,
         SUM(CASE WHEN a.votedAt IS NOT NULL THEN 1 ELSE 0 END) AS voted
       FROM event_mobilization_roles r
       INNER JOIN events e ON e.eventId = r.eventId
       LEFT JOIN event_mobilization_assignments a
         ON a.eventId = r.eventId AND a.mobilizerUserId = r.userId AND r.role = 'mobilizer'
       WHERE r.userId = ?
       GROUP BY e.eventId, e.eventName, e.date, r.role,
                r.assignedPollingCenter, r.assignedWard, r.assignedConstituency
       ORDER BY e.date DESC, e.eventName ASC`,
      [userId]
    )) as Array<{
      eventId: string;
      eventName: string;
      eventDate: Date | string | null;
      role: EventMobilizationRoleType;
      assignedPollingCenter: string | null;
      assignedWard: string;
      assignedConstituency: string;
      assigned: string;
      voted: string;
    }>;

    return rows.map((row) => {
      const assigned = Number(row.assigned) || 0;
      const voted = Number(row.voted) || 0;
      const pc =
        row.role === EventMobilizationRoleType.MOBILIZER && row.assignedPollingCenter
          ? normalizePollingCenterFields(
              row.assignedPollingCenter,
              row.assignedWard,
              row.assignedConstituency
            )
          : null;
      return {
        eventId: row.eventId,
        eventName: row.eventName,
        eventDate: row.eventDate
          ? row.eventDate instanceof Date
            ? row.eventDate.toISOString().slice(0, 10)
            : String(row.eventDate).slice(0, 10)
          : null,
        role: row.role,
        assigned,
        voted,
        outstanding: Math.max(0, assigned - voted),
        pollingCenterLabel: pc ? pollingCenterLabel(pc) : null,
      };
    });
  }

  static async getMobilizerUserIds(eventId: string): Promise<string[]> {
    const rows = await AppDataSource.getRepository(EventMobilizationRole).find({
      where: { eventId, role: EventMobilizationRoleType.MOBILIZER },
    });
    return rows.map((r) => r.userId);
  }

  static async assertMobilizersOnEvent(eventId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) {
      return;
    }
    const unique = [...new Set(userIds)];
    const rows = await AppDataSource.getRepository(EventMobilizationRole).find({
      where: {
        eventId,
        role: EventMobilizationRoleType.MOBILIZER,
        userId: In(unique),
      },
    });
    if (rows.length !== unique.length) {
      throw new MobilizationAccessError('One or more users are not mobilizers on this event', 400);
    }
  }
}
