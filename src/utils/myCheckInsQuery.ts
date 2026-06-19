import { SelectQueryBuilder } from 'typeorm';
import { CheckInLog } from '../entities/CheckInLog';

export interface MyCheckInsFilters {
  eventId: string;
  userId: string;
  search?: string;
  ward?: string;
  constituency?: string;
  pollingCenter?: string;
  county?: string;
  dateFrom?: string;
  dateTo?: string;
  today?: boolean;
  isRegisteredVoter?: boolean;
  isInvited?: boolean;
  sex?: string;
  sort?: string;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function needsParticipantJoin(filters: MyCheckInsFilters): boolean {
  return !!(
    filters.search ||
    filters.ward ||
    filters.constituency ||
    filters.pollingCenter ||
    filters.county ||
    filters.isRegisteredVoter !== undefined ||
    filters.isInvited !== undefined ||
    filters.sex ||
    filters.sort?.startsWith('name_')
  );
}

export function applyMyCheckInsFilters(
  qb: SelectQueryBuilder<CheckInLog>,
  filters: MyCheckInsFilters,
  options: { participantJoined?: boolean } = {}
): SelectQueryBuilder<CheckInLog> {
  const participantJoined = options.participantJoined ?? false;
  const joinParticipant = !participantJoined && needsParticipantJoin(filters);

  qb.where('log.eventId = :eventId', { eventId: filters.eventId }).andWhere(
    'log.checkedInById = :userId',
    { userId: filters.userId }
  );

  if (joinParticipant) {
    qb.innerJoin('log.participant', 'participant');
  }

  const canFilterParticipant = participantJoined || joinParticipant;

  if (filters.search?.trim() && canFilterParticipant) {
    const term = `%${filters.search.trim()}%`;
    qb.andWhere(
      '(participant.name LIKE :search OR participant.idNumber LIKE :search)',
      { search: term }
    );
  }

  if (filters.ward && canFilterParticipant) {
    qb.andWhere('participant.ward = :ward', { ward: filters.ward });
  }

  if (filters.constituency && canFilterParticipant) {
    qb.andWhere('participant.constituency = :constituency', {
      constituency: filters.constituency,
    });
  }

  if (filters.pollingCenter && canFilterParticipant) {
    qb.andWhere('participant.pollingCenter = :pollingCenter', {
      pollingCenter: filters.pollingCenter,
    });
  }

  if (filters.county && canFilterParticipant) {
    qb.andWhere('participant.county = :county', { county: filters.county });
  }

  if (filters.today) {
    qb.andWhere('log.checkInDate = :today', { today: startOfToday() });
  } else {
    if (filters.dateFrom) {
      qb.andWhere('log.checkInDate >= :dateFrom', { dateFrom: filters.dateFrom });
    }
    if (filters.dateTo) {
      qb.andWhere('log.checkInDate <= :dateTo', { dateTo: filters.dateTo });
    }
  }

  if (filters.isRegisteredVoter !== undefined && canFilterParticipant) {
    qb.andWhere('participant.isRegisteredVoter = :isRegisteredVoter', {
      isRegisteredVoter: filters.isRegisteredVoter,
    });
  }

  if (filters.isInvited !== undefined && canFilterParticipant) {
    qb.andWhere('participant.isInvited = :isInvited', {
      isInvited: filters.isInvited,
    });
  }

  if (filters.sex && canFilterParticipant) {
    qb.andWhere('participant.sex = :sex', { sex: filters.sex });
  }

  return qb;
}

export function applyMyCheckInsSort(
  qb: SelectQueryBuilder<CheckInLog>,
  sort?: string
): SelectQueryBuilder<CheckInLog> {
  switch (sort) {
    case 'checkedInAt_asc':
      return qb.orderBy('log.checkedInAt', 'ASC');
    case 'name_asc':
      return qb.orderBy('participant.name', 'ASC').addOrderBy('log.checkedInAt', 'DESC');
    case 'name_desc':
      return qb.orderBy('participant.name', 'DESC').addOrderBy('log.checkedInAt', 'DESC');
    case 'checkedInAt_desc':
    default:
      return qb.orderBy('log.checkedInAt', 'DESC');
  }
}

export function parseMyCheckInsQuery(
  eventId: string,
  userId: string,
  query: Record<string, unknown>
): MyCheckInsFilters {
  const filters: MyCheckInsFilters = { eventId, userId };

  if (typeof query.search === 'string' && query.search.trim()) {
    filters.search = query.search.trim();
  }
  if (typeof query.ward === 'string' && query.ward) filters.ward = query.ward;
  if (typeof query.constituency === 'string' && query.constituency) {
    filters.constituency = query.constituency;
  }
  if (typeof query.pollingCenter === 'string' && query.pollingCenter) {
    filters.pollingCenter = query.pollingCenter;
  }
  if (typeof query.county === 'string' && query.county) filters.county = query.county;
  if (typeof query.dateFrom === 'string' && query.dateFrom) filters.dateFrom = query.dateFrom;
  if (typeof query.dateTo === 'string' && query.dateTo) filters.dateTo = query.dateTo;
  if (query.today === 'true' || query.today === '1') filters.today = true;
  if (query.isRegisteredVoter === 'true') filters.isRegisteredVoter = true;
  if (query.isRegisteredVoter === 'false') filters.isRegisteredVoter = false;
  if (query.isInvited === 'true') filters.isInvited = true;
  if (query.isInvited === 'false') filters.isInvited = false;
  if (typeof query.sex === 'string' && query.sex) filters.sex = query.sex;
  if (typeof query.sort === 'string' && query.sort) filters.sort = query.sort;

  return filters;
}
