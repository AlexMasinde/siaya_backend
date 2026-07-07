import { SelectQueryBuilder } from 'typeorm';
import { AppDataSource } from '../config/database';
import { EventDailyStat } from '../entities/EventDailyStat';
import { EventJurisdictionStat } from '../entities/EventJurisdictionStat';
import { EventAgentStat } from '../entities/EventAgentStat';
import { Participant } from '../entities/Participant';
import { DrillDownFilter, JurisdictionService } from '../services/JurisdictionService';

export interface JurisdictionStatRow {
  county: string;
  constituency: string;
  ward: string;
  pollingCenter: string;
  uniqueMobilized: number;
  checkInCount: number;
}

export interface AgentStatRow {
  pollingCenter: string;
  ward: string;
  constituency: string;
  uniqueMobilized: number;
  checkInCount: number;
}

export interface DailyStatRow {
  statDate: Date;
  checkInCount: number;
  uniqueMobilized: number;
}

function applyDrillDownToJurisdictionQb(
  qb: SelectQueryBuilder<EventJurisdictionStat>,
  drillDown: DrillDownFilter,
  alias = 'stats'
): void {
  if (drillDown.county) {
    qb.andWhere(`${alias}.county = :ddCounty`, { ddCounty: drillDown.county });
  }
  if (drillDown.constituency) {
    qb.andWhere(`${alias}.constituency = :ddConstituency`, {
      ddConstituency: drillDown.constituency,
    });
  }
  if (drillDown.ward) {
    qb.andWhere(`${alias}.ward = :ddWard`, { ddWard: drillDown.ward });
  }
  if (drillDown.pollingCenter) {
    qb.andWhere(`${alias}.pollingCenter = :ddPc`, { ddPc: drillDown.pollingCenter });
  }
}

function toAreaMap(rows: JurisdictionStatRow[], field: 'ward' | 'constituency' | 'county'): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const name = row[field]?.trim();
    if (!name) continue;
    const key = name.toUpperCase();
    map.set(key, (map.get(key) ?? 0) + row.uniqueMobilized);
  }
  return map;
}

function toCenterMap(rows: JurisdictionStatRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = JurisdictionService.compositeKey(
      row.pollingCenter || '',
      row.ward || '',
      row.constituency || ''
    );
    map.set(key, (map.get(key) ?? 0) + row.uniqueMobilized);
  }
  return map;
}

export class AnalyticsReadService {
  static async getJurisdictionRows(
    eventId: string,
    drillDown: DrillDownFilter = {}
  ): Promise<JurisdictionStatRow[]> {
    const repo = AppDataSource.getRepository(EventJurisdictionStat);
    const qb = repo.createQueryBuilder('stats').where('stats.eventId = :eventId', { eventId });
    applyDrillDownToJurisdictionQb(qb, drillDown);
    const rows = await qb.getMany();
    return rows.map((r) => ({
      county: r.county,
      constituency: r.constituency,
      ward: r.ward,
      pollingCenter: r.pollingCenter,
      uniqueMobilized: r.uniqueMobilized,
      checkInCount: r.checkInCount,
    }));
  }

  static async getTotalCheckIns(eventId: string): Promise<number> {
    const result = await AppDataSource.getRepository(EventDailyStat)
      .createQueryBuilder('daily')
      .select('COALESCE(SUM(daily.checkInCount), 0)', 'total')
      .where('daily.eventId = :eventId', { eventId })
      .getRawOne<{ total: string }>();
    return Number(result?.total ?? 0);
  }

  static async getTotalCheckInsInScope(
    eventId: string,
    drillDown: DrillDownFilter = {}
  ): Promise<number> {
    const rows = await this.getJurisdictionRows(eventId, drillDown);
    return rows.reduce((sum, r) => sum + r.checkInCount, 0);
  }

  static async getUniqueMobilizedInScope(
    eventId: string,
    drillDown: DrillDownFilter = {}
  ): Promise<number> {
    const rows = await this.getJurisdictionRows(eventId, drillDown);
    const fromJurisdiction = rows.reduce((sum, r) => sum + r.uniqueMobilized, 0);

    if (JurisdictionService.hasDrillDownFilter(drillDown)) {
      return fromJurisdiction;
    }

    const noPcCount = await AppDataSource.getRepository(Participant)
      .createQueryBuilder('p')
      .innerJoin('p.checkInLogs', 'l')
      .where('p.eventId = :eventId', { eventId })
      .andWhere('l.eventId = :eventId', { eventId })
      .andWhere("(p.pollingCenter IS NULL OR p.pollingCenter = '')")
      .getCount();

    return fromJurisdiction + noPcCount;
  }

  /** Live count of unique checked-in voters — includes mobilization after any survey launched. */
  static async countDistinctMobilizedParticipants(
    eventId: string,
    drillDown: DrillDownFilter = {}
  ): Promise<number> {
    const conditions = ['l.eventId = ?', 'p.eventId = ?'];
    const params: unknown[] = [eventId, eventId];

    if (drillDown.county) {
      conditions.push('p.county = ?');
      params.push(drillDown.county);
    }
    if (drillDown.constituency) {
      conditions.push('p.constituency = ?');
      params.push(drillDown.constituency);
    }
    if (drillDown.ward) {
      conditions.push('p.ward = ?');
      params.push(drillDown.ward);
    }
    if (drillDown.pollingCenter) {
      conditions.push('p.pollingCenter = ?');
      params.push(drillDown.pollingCenter);
    }

    const rows = (await AppDataSource.query(
      `SELECT COUNT(DISTINCT l.participantId) AS cnt
       FROM check_in_logs l
       INNER JOIN participants p ON p.id = l.participantId
       WHERE ${conditions.join(' AND ')}`,
      params
    )) as Array<{ cnt: string }>;

    return Number(rows[0]?.cnt ?? 0);
  }

  static async getCollectionMaps(eventId: string, drillDown: DrillDownFilter = {}) {
    const rows = await this.getJurisdictionRows(eventId, drillDown);
    return {
      byCenter: toCenterMap(rows),
      byWard: toAreaMap(rows, 'ward'),
      byConstituency: toAreaMap(rows, 'constituency'),
      byCounty: toAreaMap(rows, 'county'),
    };
  }

  static async getDailyTrend(eventId: string): Promise<DailyStatRow[]> {
    const rows = await AppDataSource.getRepository(EventDailyStat).find({
      where: { eventId },
      order: { statDate: 'ASC' },
    });
    return rows.map((r) => ({
      statDate: r.statDate,
      checkInCount: r.checkInCount,
      uniqueMobilized: r.uniqueMobilized,
    }));
  }

  static formatStatDate(statDate: Date): string {
    const year = statDate.getUTCFullYear();
    const month = String(statDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(statDate.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  static async getDailyTrendAsPoints(eventId: string): Promise<{ date: string; count: number }[]> {
    const rows = await this.getDailyTrend(eventId);
    return rows.map((r) => ({
      date: this.formatStatDate(r.statDate),
      count: r.checkInCount,
    }));
  }

  static async getAgentRows(eventId: string, userId: string): Promise<AgentStatRow[]> {
    const rows = await AppDataSource.getRepository(EventAgentStat).find({
      where: { eventId, userId },
      order: { uniqueMobilized: 'DESC' },
    });
    return rows.map((r) => ({
      pollingCenter: r.pollingCenter,
      ward: r.ward,
      constituency: r.constituency,
      uniqueMobilized: r.uniqueMobilized,
      checkInCount: r.checkInCount,
    }));
  }

  static async getCampaignMobilizedByCenter(eventId: string): Promise<Map<string, number>> {
    const rows = await this.getJurisdictionRows(eventId);
    return toCenterMap(rows);
  }

  static async getAgentTotals(eventId: string, userId: string) {
    const rows = await this.getAgentRows(eventId, userId);
    return {
      total_mobilized: rows.reduce((sum, r) => sum + r.uniqueMobilized, 0),
      total_check_ins: rows.reduce((sum, r) => sum + r.checkInCount, 0),
      polling_centers_influenced: rows.length,
    };
  }
}
