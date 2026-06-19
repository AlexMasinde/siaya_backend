import { EntityManager } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Participant } from '../entities/Participant';
import { jurisdictionGrainKey } from '../utils/analyticsGrainKey';
import logger from '../config/logger';

export interface CheckInAnalyticsContext {
  eventId: string;
  participant: Participant;
  checkInDate: Date;
  checkedInAt: Date;
  checkedInById: string | null;
}

function hasPollingCenterGrain(participant: Participant): boolean {
  return !!(participant.pollingCenter && participant.pollingCenter.trim());
}

async function isFirstMobilizationAtJurisdictionGrain(
  manager: EntityManager,
  ctx: CheckInAnalyticsContext
): Promise<boolean> {
  const { eventId, participant } = ctx;
  const pollingCenter = participant.pollingCenter ?? '';
  const ward = participant.ward ?? '';
  const constituency = participant.constituency ?? '';

  const result = await manager.query(
    `SELECT COUNT(l.id) AS cnt
     FROM check_in_logs l
     INNER JOIN participants p ON p.id = l.participantId
     WHERE l.eventId = ?
       AND l.participantId = ?
       AND COALESCE(p.pollingCenter, '') = ?
       AND COALESCE(p.ward, '') = ?
       AND COALESCE(p.constituency, '') = ?`,
    [eventId, participant.id, pollingCenter, ward, constituency]
  );

  // Called after the new log is inserted — exactly one row means first mobilization at this grain.
  return Number(result[0]?.cnt ?? 0) === 1;
}

async function upsertDailyStat(manager: EntityManager, ctx: CheckInAnalyticsContext): Promise<void> {
  const { eventId, checkInDate } = ctx;

  await manager.query(
    `INSERT INTO event_daily_stats (id, eventId, statDate, checkInCount, uniqueMobilized)
     VALUES (?, ?, ?, 1, 1)
     ON DUPLICATE KEY UPDATE
       checkInCount = checkInCount + 1,
       uniqueMobilized = uniqueMobilized + 1`,
    [uuidv4(), eventId, checkInDate]
  );
}

async function upsertJurisdictionStat(
  manager: EntityManager,
  ctx: CheckInAnalyticsContext,
  uniqueDelta: number
): Promise<void> {
  const { eventId, participant, checkedInAt } = ctx;
  const pollingCenter = participant.pollingCenter ?? '';
  const ward = participant.ward ?? '';
  const constituency = participant.constituency ?? '';
  const county = participant.county ?? '';
  const grainKey = jurisdictionGrainKey(pollingCenter, ward, constituency);

  await manager.query(
    `INSERT INTO event_jurisdiction_stats (
       id, eventId, grainKey, county, constituency, ward, pollingCenter,
       uniqueMobilized, checkInCount, lastMobilizedAt
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       county = VALUES(county),
       constituency = VALUES(constituency),
       ward = VALUES(ward),
       pollingCenter = VALUES(pollingCenter),
       uniqueMobilized = uniqueMobilized + ?,
       checkInCount = checkInCount + 1,
       lastMobilizedAt = GREATEST(COALESCE(lastMobilizedAt, '1970-01-01'), VALUES(lastMobilizedAt))`,
    [
      uuidv4(),
      eventId,
      grainKey,
      county,
      constituency,
      ward,
      pollingCenter,
      uniqueDelta,
      checkedInAt,
      uniqueDelta,
    ]
  );
}

async function upsertAgentStat(
  manager: EntityManager,
  ctx: CheckInAnalyticsContext,
  uniqueDelta: number
): Promise<void> {
  const { eventId, participant, checkedInAt, checkedInById } = ctx;
  if (!checkedInById) return;

  const pollingCenter = participant.pollingCenter ?? '';
  const ward = participant.ward ?? '';
  const constituency = participant.constituency ?? '';
  const grainKey = jurisdictionGrainKey(pollingCenter, ward, constituency);

  await manager.query(
    `INSERT INTO event_agent_stats (
       id, eventId, userId, grainKey, pollingCenter, ward, constituency,
       uniqueMobilized, checkInCount, lastMobilizedAt
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       pollingCenter = VALUES(pollingCenter),
       ward = VALUES(ward),
       constituency = VALUES(constituency),
       uniqueMobilized = uniqueMobilized + ?,
       checkInCount = checkInCount + 1,
       lastMobilizedAt = GREATEST(COALESCE(lastMobilizedAt, '1970-01-01'), VALUES(lastMobilizedAt))`,
    [
      uuidv4(),
      eventId,
      checkedInById,
      grainKey,
      pollingCenter,
      ward,
      constituency,
      uniqueDelta,
      checkedInAt,
      uniqueDelta,
    ]
  );
}

/**
 * Increment pre-aggregated analytics after a new check-in log is saved.
 * Call inside the same transaction as the check-in insert.
 */
export async function incrementAnalyticsOnCheckIn(
  manager: EntityManager,
  ctx: CheckInAnalyticsContext
): Promise<void> {
  const isFirstAtGrain = hasPollingCenterGrain(ctx.participant)
    ? await isFirstMobilizationAtJurisdictionGrain(manager, ctx)
    : false;
  const uniqueDelta = isFirstAtGrain ? 1 : 0;

  await upsertDailyStat(manager, ctx);

  if (hasPollingCenterGrain(ctx.participant)) {
    await upsertJurisdictionStat(manager, ctx, uniqueDelta);
    await upsertAgentStat(manager, ctx, uniqueDelta);
  }
}

/**
 * Safe wrapper: logs errors but does not fail check-in if summary update fails.
 * Prefer calling incrementAnalyticsOnCheckIn inside the check-in transaction when possible.
 */
export async function incrementAnalyticsOnCheckInSafe(
  manager: EntityManager,
  ctx: CheckInAnalyticsContext
): Promise<void> {
  try {
    await incrementAnalyticsOnCheckIn(manager, ctx);
  } catch (error) {
    logger.error('Analytics increment failed (check-in succeeded):', {
      error: error instanceof Error ? error.message : String(error),
      eventId: ctx.eventId,
      participantId: ctx.participant.id,
    });
  }
}
