import { v4 as uuidv4 } from 'uuid';
import { AppDataSource } from '../config/database';
import { Participant } from '../entities/Participant';
import { EventMobilizationAssignment } from '../entities/EventMobilizationAssignment';
import {
  MAX_MOBILIZER_ASSIGNMENTS,
  MobilizationAccessError,
} from './MobilizationAccessService';
import { MobilizationRosterService } from './MobilizationRosterService';
import { participantInPollingCenter } from '../utils/mobilizationPollingCenter';

export class MobilizationAssignmentService {
  static async countForMobilizer(eventId: string, mobilizerUserId: string): Promise<number> {
    return AppDataSource.getRepository(EventMobilizationAssignment).count({
      where: { eventId, mobilizerUserId },
    });
  }

  /**
   * Assign registered voters from a mobilizer's polling center (max 20).
   * Mobilizers claim for themselves; coordinators can assign on behalf of mobilizers they added.
   */
  static async claimBatch(
    eventId: string,
    mobilizerUserId: string,
    participantIds: string[],
    actorId: string,
    options: { allowOnBehalf?: boolean; isAdmin?: boolean } = {}
  ): Promise<{ created: number; assignmentIds: string[] }> {
    const onBehalf = mobilizerUserId !== actorId;
    if (onBehalf && !options.allowOnBehalf) {
      throw new MobilizationAccessError('Mobilizers can only claim voters for themselves', 403);
    }

    if (onBehalf) {
      await MobilizationRosterService.assertCanManageMobilizer(
        eventId,
        mobilizerUserId,
        actorId,
        { isAdmin: options.isAdmin }
      );
    }

    const uniqueIds = [...new Set(participantIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
      throw new MobilizationAccessError('participantIds array is required', 400);
    }

    const assignedPc = await MobilizationRosterService.getMobilizerPollingCenterOrThrow(
      eventId,
      mobilizerUserId
    );

    const current = await this.countForMobilizer(eventId, mobilizerUserId);
    if (current >= MAX_MOBILIZER_ASSIGNMENTS) {
      throw new MobilizationAccessError(
        `Limit reached: this mobilizer already has ${MAX_MOBILIZER_ASSIGNMENTS} voters`,
        400
      );
    }
    if (current + uniqueIds.length > MAX_MOBILIZER_ASSIGNMENTS) {
      const remaining = MAX_MOBILIZER_ASSIGNMENTS - current;
      throw new MobilizationAccessError(
        `Limit reached: this mobilizer can only take ${remaining} more voter${remaining === 1 ? '' : 's'} (max ${MAX_MOBILIZER_ASSIGNMENTS})`,
        400
      );
    }

    const participants = await AppDataSource.getRepository(Participant).find({
      where: uniqueIds.map((id) => ({ id, eventId })),
    });

    if (participants.length !== uniqueIds.length) {
      throw new MobilizationAccessError('One or more voters were not found on this campaign', 400);
    }

    for (const participant of participants) {
      if (!participant.isRegisteredVoter) {
        throw new MobilizationAccessError(
          `${participant.name ?? participant.id} is not a registered voter`,
          400
        );
      }
      if (!participantInPollingCenter(participant, assignedPc)) {
        throw new MobilizationAccessError(
          `${participant.name ?? participant.id} is not in the mobilizer's assigned polling center`,
          400
        );
      }
    }

    const assignmentIds: string[] = [];
    const now = new Date();

    await AppDataSource.transaction(async (manager) => {
      for (const participant of participants) {
        const existing = await manager.findOne(EventMobilizationAssignment, {
          where: { eventId, participantId: participant.id },
        });
        if (existing) {
          throw new MobilizationAccessError(
            `${participant.name ?? participant.id} has already been picked by another mobilizer`,
            400
          );
        }

        const row = manager.create(EventMobilizationAssignment, {
          id: uuidv4(),
          eventId,
          participantId: participant.id,
          mobilizerUserId,
          participantName: participant.name,
          phoneNumber: participant.phoneNumber,
          ward: participant.ward ?? '',
          constituency: participant.constituency ?? '',
          pollingCenter: participant.pollingCenter ?? '',
          assignedById: actorId,
          assignedAt: now,
          votedAt: null,
          markedById: null,
        });
        await manager.save(row);
        assignmentIds.push(row.id);
      }
    });

    return { created: assignmentIds.length, assignmentIds };
  }

  static async releaseClaim(
    eventId: string,
    assignmentId: string,
    actorId: string,
    options: { coordinatorOverride?: boolean } = {}
  ): Promise<void> {
    const repo = AppDataSource.getRepository(EventMobilizationAssignment);
    const row = await repo.findOne({ where: { id: assignmentId, eventId } });
    if (!row) {
      throw new MobilizationAccessError('Assignment not found', 404);
    }
    if (!options.coordinatorOverride && row.mobilizerUserId !== actorId) {
      throw new MobilizationAccessError('Access denied', 403);
    }
    if (row.votedAt) {
      throw new MobilizationAccessError('Cannot remove a voter who has already voted', 400);
    }
    await repo.remove(row);
  }

  static async setVoted(
    eventId: string,
    assignmentId: string,
    voted: boolean,
    actorId: string,
    options: {
      mobilizerOnly?: boolean;
      /** When set, actor may mark voted for any assignment belonging to this mobilizer. */
      allowOnBehalf?: boolean;
      isAdmin?: boolean;
    } = {}
  ): Promise<EventMobilizationAssignment> {
    const repo = AppDataSource.getRepository(EventMobilizationAssignment);
    const row = await repo.findOne({ where: { id: assignmentId, eventId } });
    if (!row) {
      throw new MobilizationAccessError('Assignment not found', 404);
    }

    if (options.mobilizerOnly && row.mobilizerUserId !== actorId) {
      throw new MobilizationAccessError('Access denied');
    }

    if (
      options.allowOnBehalf &&
      row.mobilizerUserId !== actorId &&
      !options.mobilizerOnly
    ) {
      await MobilizationRosterService.assertCanManageMobilizer(
        eventId,
        row.mobilizerUserId,
        actorId,
        { isAdmin: options.isAdmin }
      );
    }

    row.votedAt = voted ? new Date() : null;
    row.markedById = voted ? actorId : null;
    await repo.save(row);
    return row;
  }
}
