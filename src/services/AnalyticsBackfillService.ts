import { AppDataSource } from '../config/database';
import { EventJurisdictionStat } from '../entities/EventJurisdictionStat';
import { EventDailyStat } from '../entities/EventDailyStat';
import { EventAgentStat } from '../entities/EventAgentStat';
import { jurisdictionGrainKey } from '../utils/analyticsGrainKey';
import logger from '../config/logger';

export interface BackfillResult {
  jurisdictionRows: number;
  dailyRows: number;
  agentRows: number;
}

export interface VerifyMismatch {
  kind: 'daily' | 'jurisdiction' | 'agent' | 'event_totals';
  eventId: string;
  detail: string;
}

export interface VerifyResult {
  ok: boolean;
  mismatches: VerifyMismatch[];
}

function eventFilterSql(eventId: string | undefined, alias: string): string {
  return eventId ? ` AND ${alias}.eventId = ? ` : '';
}

export async function clearAnalyticsSummaries(eventId?: string): Promise<void> {
  const jurisdictionRepo = AppDataSource.getRepository(EventJurisdictionStat);
  const dailyRepo = AppDataSource.getRepository(EventDailyStat);
  const agentRepo = AppDataSource.getRepository(EventAgentStat);

  if (eventId) {
    await jurisdictionRepo.delete({ eventId });
    await dailyRepo.delete({ eventId });
    await agentRepo.delete({ eventId });
  } else {
    await agentRepo.clear();
    await dailyRepo.clear();
    await jurisdictionRepo.clear();
  }
}

export async function backfillAnalyticsSummaries(eventId?: string): Promise<BackfillResult> {
  await clearAnalyticsSummaries(eventId);

  const params: string[] = [];
  if (eventId) params.push(eventId);
  const eventFilterLogs = eventFilterSql(eventId, 'l');

  const jurisdictionInsert = `
    INSERT INTO event_jurisdiction_stats (
      id, eventId, grainKey, county, constituency, ward, pollingCenter,
      uniqueMobilized, checkInCount, lastMobilizedAt
    )
    SELECT
      UUID(),
      l.eventId,
      SHA2(CONCAT(
        UPPER(TRIM(COALESCE(p.pollingCenter, ''))), '|',
        UPPER(TRIM(COALESCE(p.ward, ''))), '|',
        UPPER(TRIM(COALESCE(p.constituency, '')))
      ), 256),
      COALESCE(p.county, ''),
      COALESCE(p.constituency, ''),
      COALESCE(p.ward, ''),
      COALESCE(p.pollingCenter, ''),
      COUNT(DISTINCT l.participantId),
      COUNT(l.id),
      MAX(l.checkedInAt)
    FROM check_in_logs l
    INNER JOIN participants p ON p.id = l.participantId
    WHERE p.pollingCenter IS NOT NULL AND p.pollingCenter != ''
    ${eventFilterLogs}
    GROUP BY l.eventId, p.pollingCenter, p.ward, p.constituency, p.county
  `;

  const dailyInsert = `
    INSERT INTO event_daily_stats (
      id, eventId, statDate, checkInCount, uniqueMobilized
    )
    SELECT
      UUID(),
      l.eventId,
      l.checkInDate,
      COUNT(l.id),
      COUNT(DISTINCT l.participantId)
    FROM check_in_logs l
    WHERE 1=1
    ${eventFilterLogs}
    GROUP BY l.eventId, l.checkInDate
  `;

  const agentInsert = `
    INSERT INTO event_agent_stats (
      id, eventId, userId, grainKey, pollingCenter, ward, constituency,
      uniqueMobilized, checkInCount, lastMobilizedAt
    )
    SELECT
      UUID(),
      l.eventId,
      l.checkedInById,
      SHA2(CONCAT(
        UPPER(TRIM(COALESCE(p.pollingCenter, ''))), '|',
        UPPER(TRIM(COALESCE(p.ward, ''))), '|',
        UPPER(TRIM(COALESCE(p.constituency, '')))
      ), 256),
      COALESCE(p.pollingCenter, ''),
      COALESCE(p.ward, ''),
      COALESCE(p.constituency, ''),
      COUNT(DISTINCT l.participantId),
      COUNT(l.id),
      MAX(l.checkedInAt)
    FROM check_in_logs l
    INNER JOIN participants p ON p.id = l.participantId
    WHERE l.checkedInById IS NOT NULL
      AND p.pollingCenter IS NOT NULL AND p.pollingCenter != ''
    ${eventFilterLogs}
    GROUP BY l.eventId, l.checkedInById, p.pollingCenter, p.ward, p.constituency
  `;

  await AppDataSource.query(jurisdictionInsert, eventId ? [eventId] : []);
  await AppDataSource.query(dailyInsert, eventId ? [eventId] : []);
  await AppDataSource.query(agentInsert, eventId ? [eventId] : []);

  const jurisdictionRepo = AppDataSource.getRepository(EventJurisdictionStat);
  const dailyRepo = AppDataSource.getRepository(EventDailyStat);
  const agentRepo = AppDataSource.getRepository(EventAgentStat);

  const jurisdictionRows = eventId
    ? await jurisdictionRepo.count({ where: { eventId } })
    : await jurisdictionRepo.count();
  const dailyRows = eventId
    ? await dailyRepo.count({ where: { eventId } })
    : await dailyRepo.count();
  const agentRows = eventId
    ? await agentRepo.count({ where: { eventId } })
    : await agentRepo.count();

  return { jurisdictionRows, dailyRows, agentRows };
}

export async function verifyAnalyticsSummaries(eventId?: string): Promise<VerifyResult> {
  const mismatches: VerifyMismatch[] = [];
  const params: string[] = eventId ? [eventId] : [];

  const eventIdsRaw: { eventId: string }[] = await AppDataSource.query(
    eventId
      ? `SELECT DISTINCT eventId FROM check_in_logs WHERE eventId = ?`
      : `SELECT DISTINCT eventId FROM check_in_logs`,
    params
  );

  for (const { eventId: eid } of eventIdsRaw) {
    const [logTotals] = await AppDataSource.query(
      `SELECT
        COUNT(id) AS checkInCount,
        COUNT(DISTINCT participantId) AS uniqueMobilized
      FROM check_in_logs
      WHERE eventId = ?`,
      [eid]
    );

    const [dailyTotals] = await AppDataSource.query(
      `SELECT
        COALESCE(SUM(checkInCount), 0) AS checkInCount,
        COALESCE(SUM(uniqueMobilized), 0) AS uniqueMobilized
      FROM event_daily_stats
      WHERE eventId = ?`,
      [eid]
    );

    if (Number(logTotals.checkInCount) !== Number(dailyTotals.checkInCount)) {
      mismatches.push({
        kind: 'event_totals',
        eventId: eid,
        detail: `Daily checkInCount sum ${dailyTotals.checkInCount} != logs ${logTotals.checkInCount}`,
      });
    }

    const dailyLive: {
      statDate: string;
      checkInCount: string;
      uniqueMobilized: string;
    }[] = await AppDataSource.query(
      `SELECT
        checkInDate AS statDate,
        COUNT(id) AS checkInCount,
        COUNT(DISTINCT participantId) AS uniqueMobilized
      FROM check_in_logs
      WHERE eventId = ?
      GROUP BY checkInDate`,
      [eid]
    );

    const dailyStored: {
      statDate: string;
      checkInCount: number;
      uniqueMobilized: number;
    }[] = await AppDataSource.query(
      `SELECT statDate, checkInCount, uniqueMobilized
       FROM event_daily_stats
       WHERE eventId = ?`,
      [eid]
    );

    const storedDailyMap = new Map(
      dailyStored.map((row) => [
        String(row.statDate).slice(0, 10),
        row,
      ])
    );

    for (const live of dailyLive) {
      const key = String(live.statDate).slice(0, 10);
      const stored = storedDailyMap.get(key);
      if (
        !stored ||
        Number(stored.checkInCount) !== Number(live.checkInCount) ||
        Number(stored.uniqueMobilized) !== Number(live.uniqueMobilized)
      ) {
        mismatches.push({
          kind: 'daily',
          eventId: eid,
          detail: `Date ${key}: stored=${stored ? `${stored.checkInCount}/${stored.uniqueMobilized}` : 'missing'} live=${live.checkInCount}/${live.uniqueMobilized}`,
        });
      }
    }

    const jurisdictionLive: {
      pollingCenter: string;
      ward: string;
      constituency: string;
      uniqueMobilized: string;
      checkInCount: string;
    }[] = await AppDataSource.query(
      `SELECT
        p.pollingCenter,
        p.ward,
        p.constituency,
        COUNT(DISTINCT l.participantId) AS uniqueMobilized,
        COUNT(l.id) AS checkInCount
      FROM check_in_logs l
      INNER JOIN participants p ON p.id = l.participantId
      WHERE l.eventId = ?
        AND p.pollingCenter IS NOT NULL AND p.pollingCenter != ''
      GROUP BY p.pollingCenter, p.ward, p.constituency`,
      [eid]
    );

    const jurisdictionStored: EventJurisdictionStat[] = await AppDataSource.getRepository(
      EventJurisdictionStat
    ).find({ where: { eventId: eid } });

    const storedJurisdictionMap = new Map(
      jurisdictionStored.map((row) => [row.grainKey, row])
    );

    for (const live of jurisdictionLive) {
      const grainKey = jurisdictionGrainKey(
        live.pollingCenter || '',
        live.ward || '',
        live.constituency || ''
      );
      const stored = storedJurisdictionMap.get(grainKey);
      if (
        !stored ||
        stored.uniqueMobilized !== Number(live.uniqueMobilized) ||
        stored.checkInCount !== Number(live.checkInCount)
      ) {
        mismatches.push({
          kind: 'jurisdiction',
          eventId: eid,
          detail: `${live.pollingCenter} (${live.ward}): stored=${stored ? `${stored.uniqueMobilized}/${stored.checkInCount}` : 'missing'} live=${live.uniqueMobilized}/${live.checkInCount}`,
        });
      }
    }

    const agentLive: {
      userId: string;
      pollingCenter: string;
      ward: string;
      constituency: string;
      uniqueMobilized: string;
      checkInCount: string;
    }[] = await AppDataSource.query(
      `SELECT
        l.checkedInById AS userId,
        p.pollingCenter,
        p.ward,
        p.constituency,
        COUNT(DISTINCT l.participantId) AS uniqueMobilized,
        COUNT(l.id) AS checkInCount
      FROM check_in_logs l
      INNER JOIN participants p ON p.id = l.participantId
      WHERE l.eventId = ?
        AND l.checkedInById IS NOT NULL
        AND p.pollingCenter IS NOT NULL AND p.pollingCenter != ''
      GROUP BY l.checkedInById, p.pollingCenter, p.ward, p.constituency`,
      [eid]
    );

    const agentStored: EventAgentStat[] = await AppDataSource.getRepository(EventAgentStat).find({
      where: { eventId: eid },
    });

    const storedAgentMap = new Map(
      agentStored.map((row) => [`${row.userId}:${row.grainKey}`, row])
    );

    for (const live of agentLive) {
      const grainKey = jurisdictionGrainKey(
        live.pollingCenter || '',
        live.ward || '',
        live.constituency || ''
      );
      const stored = storedAgentMap.get(`${live.userId}:${grainKey}`);
      if (
        !stored ||
        stored.uniqueMobilized !== Number(live.uniqueMobilized) ||
        stored.checkInCount !== Number(live.checkInCount)
      ) {
        mismatches.push({
          kind: 'agent',
          eventId: eid,
          detail: `Agent ${live.userId} @ ${live.pollingCenter}: stored=${stored ? `${stored.uniqueMobilized}/${stored.checkInCount}` : 'missing'} live=${live.uniqueMobilized}/${live.checkInCount}`,
        });
      }
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

export async function runAnalyticsBackfill(options: {
  eventId?: string;
  verifyOnly?: boolean;
}): Promise<void> {
  if (options.verifyOnly) {
    const verify = await verifyAnalyticsSummaries(options.eventId);
    if (verify.ok) {
      logger.info('Analytics summary verification passed', {
        eventId: options.eventId ?? 'all',
      });
    } else {
      logger.error('Analytics summary verification failed', {
        eventId: options.eventId ?? 'all',
        mismatchCount: verify.mismatches.length,
        mismatches: verify.mismatches.slice(0, 20),
      });
      throw new Error(`${verify.mismatches.length} verification mismatch(es)`);
    }
    return;
  }

  logger.info('Starting analytics backfill', { eventId: options.eventId ?? 'all' });
  const result = await backfillAnalyticsSummaries(options.eventId);
  logger.info('Analytics backfill complete', result);

  const verify = await verifyAnalyticsSummaries(options.eventId);
  if (verify.ok) {
    logger.info('Post-backfill verification passed');
  } else {
    logger.error('Post-backfill verification failed', {
      mismatchCount: verify.mismatches.length,
      mismatches: verify.mismatches.slice(0, 20),
    });
    throw new Error(`${verify.mismatches.length} verification mismatch(es) after backfill`);
  }
}
