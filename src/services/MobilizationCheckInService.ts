import { v4 as uuidv4 } from 'uuid';
import { AppDataSource } from '../config/database';
import { Participant } from '../entities/Participant';
import { EventMobilizationAssignment } from '../entities/EventMobilizationAssignment';
import { EventMobilizationRoleType } from '../entities/EventMobilizationRole';
import {
  MAX_MOBILIZER_ASSIGNMENTS,
  MobilizationAccessError,
  getMobilizationRole,
} from './MobilizationAccessService';
import { MobilizationRosterService } from './MobilizationRosterService';
import { MobilizationAssignmentService } from './MobilizationAssignmentService';
import {
  ParticipantCheckInService,
  ParticipantCheckInInput,
} from './ParticipantCheckInService';

export interface MobilizationCheckInInput extends Omit<ParticipantCheckInInput, 'eventId' | 'checkedInById'> {}

export interface MobilizationCheckInResult {
  message: string;
  checkIn: {
    id: string;
    participantId: string;
    eventId: string;
    checkInDate: Date;
    checkedInAt: Date;
  };
  assignment: {
    id: string;
    participantId: string;
    mobilizerUserId: string;
    voted: boolean;
  };
  participant: {
    id: string;
    idNumber: string | null;
    name: string | null;
    pollingCenter: string | null;
    ward: string | null;
    constituency: string | null;
  };
}

export class MobilizationCheckInService {
  /**
   * Check in a brand-new voter (ID not yet on this campaign) and assign them to the mobilizer.
   * Existing campaign participants must be picked from GET /mobilization/pool instead.
   */
  static async checkInAndAssign(
    eventId: string,
    mobilizerUserId: string,
    input: MobilizationCheckInInput,
    actorId: string
  ): Promise<MobilizationCheckInResult> {
    if (mobilizerUserId !== actorId) {
      throw new MobilizationAccessError('Mobilizers can only check in voters for themselves', 403);
    }

    const role = await getMobilizationRole(mobilizerUserId, eventId);
    if (role !== EventMobilizationRoleType.MOBILIZER) {
      throw new MobilizationAccessError('Only mobilizers can check in voters for mobilization', 403);
    }

    const idNumber = input.idNumber?.trim();
    if (!idNumber) {
      throw new MobilizationAccessError('ID number is required', 400);
    }

    const existing = await AppDataSource.getRepository(Participant).findOne({
      where: { eventId, idNumber },
    });
    if (existing) {
      throw new MobilizationAccessError(
        'This ID number is already on the campaign. Pick them from your checked-in voter list instead.',
        400
      );
    }

    if (!input.name?.trim() || !input.dateOfBirth || !input.sex?.trim()) {
      throw new MobilizationAccessError(
        'Name, date of birth, and sex are required for a new voter',
        400
      );
    }

    const assignedPc = await MobilizationRosterService.getMobilizerPollingCenterOrThrow(
      eventId,
      mobilizerUserId
    );

    const currentAssignments = await MobilizationAssignmentService.countForMobilizer(
      eventId,
      mobilizerUserId
    );
    if (currentAssignments >= MAX_MOBILIZER_ASSIGNMENTS) {
      throw new MobilizationAccessError(
        `You cannot exceed ${MAX_MOBILIZER_ASSIGNMENTS} voters on your mobilization list`,
        400
      );
    }

    const name = input.name!.trim();
    const sex = input.sex!.trim();

    return AppDataSource.transaction(async (manager) => {
      const checkInResult = await ParticipantCheckInService.checkInToday(
        {
          eventId,
          checkedInById: actorId,
          idNumber,
          phoneNumber: input.phoneNumber,
          name,
          dateOfBirth: input.dateOfBirth!,
          sex,
          county: input.county,
          constituency: assignedPc.constituency,
          ward: assignedPc.ward,
          pollingCenter: assignedPc.pollingCenter,
          isRegisteredVoter: input.isRegisteredVoter ?? true,
          isInvited: input.isInvited ?? false,
        },
        manager
      );

      const { participant, checkIn } = checkInResult;

      const now = new Date();
      const assignment = manager.create(EventMobilizationAssignment, {
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
      await manager.save(EventMobilizationAssignment, assignment);

      return {
        message: 'New voter checked in and added to your mobilization list',
        checkIn: {
          id: checkIn.id,
          participantId: participant.id,
          eventId,
          checkInDate: checkIn.checkInDate,
          checkedInAt: checkIn.checkedInAt,
        },
        assignment: {
          id: assignment.id,
          participantId: participant.id,
          mobilizerUserId,
          voted: false,
        },
        participant: {
          id: participant.id,
          idNumber: participant.idNumber,
          name: participant.name,
          pollingCenter: participant.pollingCenter,
          ward: participant.ward,
          constituency: participant.constituency,
        },
      };
    });
  }
}
