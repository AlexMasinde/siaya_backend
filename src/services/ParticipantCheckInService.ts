import { EntityManager } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AppDataSource } from '../config/database';
import { Participant } from '../entities/Participant';
import { CheckInLog } from '../entities/CheckInLog';
import { incrementAnalyticsOnCheckIn } from './AnalyticsIncrementService';
import { resolveKenyanMobileForCheckIn } from '../utils/kenyanPhone';
import { MobilizationAccessError } from './MobilizationAccessService';

export interface ParticipantCheckInInput {
  eventId: string;
  idNumber: string;
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
  checkedInById: string | null;
}

export interface ParticipantCheckInResult {
  participant: Participant;
  checkIn: CheckInLog;
  createdCheckIn: boolean;
}

function todayDateOnly(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

export class ParticipantCheckInService {
  static async checkInToday(
    input: ParticipantCheckInInput,
    manager?: EntityManager
  ): Promise<ParticipantCheckInResult> {
    const run = async (em: EntityManager): Promise<ParticipantCheckInResult> => {
      const { eventId, idNumber, checkedInById } = input;

      if (!eventId || !idNumber?.trim()) {
        throw new MobilizationAccessError('Event ID and ID number are required', 400);
      }

      let participant = await em.findOne(Participant, {
        where: { eventId, idNumber: idNumber.trim() },
      });

      const phoneResult = resolveKenyanMobileForCheckIn(
        input.phoneNumber,
        participant?.phoneNumber
      );

      if (!phoneResult.ok) {
        throw new MobilizationAccessError(phoneResult.error, 400);
      }

      const normalizedPhone = phoneResult.local;

      if (!participant) {
        if (!input.name || !input.dateOfBirth || !input.sex) {
          throw new MobilizationAccessError(
            'Participant details (name, date of birth, sex) are required for a new entry',
            400
          );
        }

        participant = em.create(Participant, {
          id: uuidv4(),
          eventId,
          idNumber: idNumber.trim(),
          name: input.name,
          dateOfBirth: new Date(input.dateOfBirth),
          sex: input.sex,
          county: input.county || null,
          constituency: input.constituency || null,
          ward: input.ward || null,
          pollingCenter: input.pollingCenter || null,
          phoneNumber: normalizedPhone,
          isRegisteredVoter: input.isRegisteredVoter ?? false,
          isInvited: input.isInvited ?? false,
        });
        await em.save(Participant, participant);
      } else {
        if (participant.phoneNumber !== normalizedPhone) {
          participant.phoneNumber = normalizedPhone;
        }
        if (input.isRegisteredVoter !== undefined) {
          participant.isRegisteredVoter = input.isRegisteredVoter;
        }
        if (input.isInvited !== undefined && !participant.isInvited) {
          participant.isInvited = input.isInvited;
        }
        await em.save(Participant, participant);
      }

      const today = todayDateOnly();
      const existingCheckIn = await em.findOne(CheckInLog, {
        where: {
          participantId: participant.id,
          eventId,
          checkInDate: today,
        },
      });

      if (existingCheckIn) {
        return {
          participant,
          checkIn: existingCheckIn,
          createdCheckIn: false,
        };
      }

      const checkIn = em.create(CheckInLog, {
        participantId: participant.id,
        eventId,
        checkedInById,
        checkInDate: today,
        checkedInAt: new Date(),
      });
      await em.save(CheckInLog, checkIn);
      await incrementAnalyticsOnCheckIn(em, {
        eventId,
        participant,
        checkInDate: today,
        checkedInAt: checkIn.checkedInAt,
        checkedInById: checkIn.checkedInById,
      });

      return { participant, checkIn, createdCheckIn: true };
    };

    if (manager) {
      return run(manager);
    }

    return AppDataSource.transaction(run);
  }
}
