import { AppDataSource } from '../config/database';
import { In } from 'typeorm';
import { SurveyStat } from '../entities/SurveyStat';
import { SurveyAgentStat } from '../entities/SurveyAgentStat';
import { SurveyJurisdictionStat } from '../entities/SurveyJurisdictionStat';
import { SurveyDailyStat } from '../entities/SurveyDailyStat';
import { SurveyResponseOptionStat } from '../entities/SurveyResponseOptionStat';
import { SurveyResponseOption } from '../entities/SurveyResponseOption';
import { Survey, SurveyStatus } from '../entities/Survey';
import { User } from '../entities/User';
import { SurveyResponseOptionService } from './SurveyResponseOptionService';
import { AnalyticsReadService } from './AnalyticsReadService';
import { JurisdictionService } from './JurisdictionService';

export interface SurveyStatsPayload {
  survey: {
    id: string;
    name: string;
    status: string;
    eventId: string;
    startedAt: string | null;
    closedAt: string | null;
    mobilizedSnapshot: number;
    callableTotal: number;
    noPhoneCount: number;
    sourceSurveyId: string | null;
    sourceSurveyName: string | null;
    launchCohorts: string[] | null;
  };
  stats: {
    pending: number;
    completed: number;
    supporter: number;
    not_supporter: number;
    undecided: number;
    not_found: number;
    relocated: number;
    declined: number;
    withheld: number;
    progress_percent: number;
    support_rate_contacted: number | null;
    genuine_support_rate: number | null;
    response_breakdown: Array<{
      option_id: string;
      code: string;
      label: string;
      category: string;
      is_designated_supporter: boolean;
      count: number;
      percent_of_completed: number | null;
    }>;
  };
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return parseFloat(((numerator / denominator) * 100).toFixed(1));
}

export class SurveyReadService {
  static async getSurveyWithStats(surveyId: string): Promise<SurveyStatsPayload | null> {
    const surveyRepo = AppDataSource.getRepository(Survey);
    const survey = await surveyRepo.findOne({ where: { id: surveyId } });
    if (!survey) return null;

    const statRepo = AppDataSource.getRepository(SurveyStat);
    const stat = await statRepo.findOne({ where: { surveyId } });

    let sourceSurveyName: string | null = null;
    if (survey.sourceSurveyId) {
      const source = await surveyRepo.findOne({ where: { id: survey.sourceSurveyId } });
      sourceSurveyName = source?.name ?? null;
    }

    const pending = stat?.pending ?? 0;
    const completed = stat?.completed ?? 0;
    const supporter = stat?.supporter ?? 0;
    const notSupporter = stat?.notSupporter ?? 0;
    const undecided = stat?.undecided ?? 0;
    const notFound = stat?.notFound ?? 0;
    const relocated = stat?.relocated ?? 0;
    const declined = stat?.declined ?? 0;
    const withheld = stat?.withheld ?? 0;
    const callable = survey.callableTotal || pending + completed;
    const classified = supporter + notSupporter + undecided;
    const responseBreakdown = await this.getResponseBreakdown(surveyId, completed);

    return {
      survey: {
        id: survey.id,
        name: survey.name,
        status: survey.status,
        eventId: survey.eventId,
        startedAt: survey.startedAt?.toISOString() ?? null,
        closedAt: survey.closedAt?.toISOString() ?? null,
        mobilizedSnapshot: survey.mobilizedSnapshot,
        callableTotal: survey.callableTotal,
        noPhoneCount: survey.noPhoneCount,
        sourceSurveyId: survey.sourceSurveyId,
        sourceSurveyName,
        launchCohorts: survey.launchCohorts,
      },
      stats: {
        pending,
        completed,
        supporter,
        not_supporter: notSupporter,
        undecided,
        not_found: notFound,
        relocated,
        declined,
        withheld,
        progress_percent: pct(completed, callable) ?? 0,
        support_rate_contacted: pct(supporter, classified),
        genuine_support_rate: pct(supporter, survey.mobilizedSnapshot),
        response_breakdown: responseBreakdown,
      },
    };
  }

  static async getResponseBreakdown(surveyId: string, completedTotal: number) {
    const rows = await AppDataSource.getRepository(SurveyResponseOption)
      .createQueryBuilder('o')
      .leftJoin(
        SurveyResponseOptionStat,
        's',
        's.optionId = o.id AND s.surveyId = o.surveyId'
      )
      .select('o.id', 'optionId')
      .addSelect('o.code', 'code')
      .addSelect('o.label', 'label')
      .addSelect('o.category', 'category')
      .addSelect('o.isDesignatedSupporter', 'isDesignatedSupporter')
      .addSelect('o.sortOrder', 'sortOrder')
      .addSelect('COALESCE(s.count, 0)', 'count')
      .where('o.surveyId = :surveyId', { surveyId })
      .orderBy('o.sortOrder', 'ASC')
      .addOrderBy('o.label', 'ASC')
      .getRawMany<{
        optionId: string;
        code: string;
        label: string;
        category: string;
        sortOrder: string;
        count: string;
        isDesignatedSupporter: number;
      }>();

    return rows.map((row) => {
      const count = Number(row.count) || 0;
      return {
        option_id: row.optionId,
        code: row.code,
        label: row.label,
        category: row.category,
        is_designated_supporter: !!row.isDesignatedSupporter,
        count,
        percent_of_completed: pct(count, completedTotal),
      };
    });
  }

  static async listEventSurveys(eventId: string) {
    const surveyRepo = AppDataSource.getRepository(Survey);
    const surveys = await surveyRepo.find({
      where: { eventId },
      order: { createdAt: 'DESC' },
    });

    const results = [];
    for (const survey of surveys) {
      const payload = await this.getSurveyWithStats(survey.id);
      if (payload) results.push(payload);
    }
    return results;
  }

  static async getAgentStats(surveyId: string) {
    const rows = await AppDataSource.getRepository(SurveyAgentStat)
      .createQueryBuilder('s')
      .innerJoin(User, 'u', 'u.id = s.agentId')
      .select('s.agentId', 'agentId')
      .addSelect('u.name', 'name')
      .addSelect('u.email', 'email')
      .addSelect('s.assigned', 'assigned')
      .addSelect('s.pending', 'pending')
      .addSelect('s.completed', 'completed')
      .addSelect('s.supporter', 'supporter')
      .addSelect('s.notSupporter', 'not_supporter')
      .addSelect('s.undecided', 'undecided')
      .addSelect('s.notFound', 'not_found')
      .addSelect('s.relocated', 'relocated')
      .addSelect('s.declined', 'declined')
      .addSelect('s.withheld', 'withheld')
      .where('s.surveyId = :surveyId', { surveyId })
      .orderBy('s.completed', 'DESC')
      .addOrderBy('u.name', 'ASC')
      .getRawMany();

    return rows.map((row) => ({
      agentId: row.agentId,
      name: row.name,
      email: row.email,
      assigned: Number(row.assigned) || 0,
      pending: Number(row.pending) || 0,
      completed: Number(row.completed) || 0,
      supporter: Number(row.supporter) || 0,
      not_supporter: Number(row.not_supporter) || 0,
      undecided: Number(row.undecided) || 0,
      not_found: Number(row.not_found) || 0,
      relocated: Number(row.relocated) || 0,
      declined: Number(row.declined) || 0,
      withheld: Number(row.withheld) || 0,
    }));
  }

  static async getJurisdictionStats(surveyId: string, ward?: string) {
    const qb = AppDataSource.getRepository(SurveyJurisdictionStat)
      .createQueryBuilder('s')
      .where('s.surveyId = :surveyId', { surveyId });

    if (ward) {
      qb.andWhere('s.ward = :ward', { ward });
    }

    const rows = await qb
      .orderBy('s.completed', 'DESC')
      .addOrderBy('s.ward', 'ASC')
      .getMany();

    return rows.map((row) => ({
      ward: row.ward,
      constituency: row.constituency,
      polling_center: row.pollingCenter,
      pending: row.pending,
      completed: row.completed,
      supporter: row.supporter,
      not_supporter: row.notSupporter,
      undecided: row.undecided,
      not_found: row.notFound,
      relocated: row.relocated,
      declined: row.declined,
      withheld: row.withheld,
      support_rate: pct(row.supporter, row.supporter + row.notSupporter + row.undecided),
    }));
  }

  static async getDailyStats(surveyId: string) {
    const rows = await AppDataSource.getRepository(SurveyDailyStat).find({
      where: { surveyId },
      order: { statDate: 'ASC' },
    });

    return rows.map((row) => ({
      date: row.statDate,
      responses_recorded: row.responsesRecorded,
      supporters_recorded: row.supportersRecorded,
    }));
  }

  static async getSupporterJurisdictionBreakdown(eventId: string, surveyId: string) {
    const mobilizedRows = await AnalyticsReadService.getJurisdictionRows(eventId);
    const surveyRows = await AppDataSource.getRepository(SurveyJurisdictionStat).find({
      where: { surveyId },
    });

    const stat = await AppDataSource.getRepository(SurveyStat).findOne({ where: { surveyId } });
    const totalSupporters = stat?.supporter ?? 0;
    const totalMobilized = await AnalyticsReadService.getUniqueMobilizedInScope(eventId);

    return this.buildSupporterBreakdownFromMaps(
      eventId,
      mobilizedRows,
      this.supportersFromJurisdictionStats(surveyRows),
      totalSupporters,
      totalMobilized,
      1
    );
  }

  static async getEventSupporterJurisdictionBreakdown(eventId: string) {
    const mobilizedRows = await AnalyticsReadService.getJurisdictionRows(eventId);
    const supporters = await this.fetchDistinctEventSupporters(eventId);
    const totalMobilized = await AnalyticsReadService.getUniqueMobilizedInScope(eventId);

    const surveyCount = await AppDataSource.getRepository(Survey).count({
      where: {
        eventId,
        status: In([SurveyStatus.ACTIVE, SurveyStatus.CLOSED]),
      },
    });

    const mobilizers = await this.fetchEventMobilizerSupporterStats(eventId);

    const breakdown = this.buildSupporterBreakdownFromMaps(
      eventId,
      mobilizedRows,
      supporters,
      supporters.length,
      totalMobilized,
      surveyCount
    );

    return { ...breakdown, mobilizers };
  }

  private static async fetchEventMobilizerSupporterStats(eventId: string) {
    const rows = await AppDataSource.query(
      `SELECT
         pm.userId,
         u.name,
         u.email,
         COUNT(DISTINCT pm.participantId) AS mobilized,
         COUNT(DISTINCT CASE WHEN sup.participantId IS NOT NULL THEN pm.participantId END) AS supporters
       FROM (
         SELECT l.participantId, l.checkedInById AS userId
         FROM check_in_logs l
         INNER JOIN (
           SELECT l2.participantId, MIN(l2.id) AS firstLogId
           FROM check_in_logs l2
           INNER JOIN (
             SELECT participantId, MIN(checkedInAt) AS firstAt
             FROM check_in_logs
             WHERE eventId = ?
             GROUP BY participantId
           ) f ON f.participantId = l2.participantId AND l2.checkedInAt = f.firstAt
           WHERE l2.eventId = ?
           GROUP BY l2.participantId
         ) pick ON pick.firstLogId = l.id
         WHERE l.eventId = ?
           AND l.checkedInById IS NOT NULL
       ) pm
       INNER JOIN users u ON u.id = pm.userId
       LEFT JOIN (
         SELECT DISTINCT a.participantId
         FROM survey_assignments a
         INNER JOIN surveys s ON s.id = a.surveyId
         LEFT JOIN survey_response_options o ON o.id = a.responseOptionId
         WHERE s.eventId = ?
           AND s.status IN ('active', 'closed')
           AND a.status = 'completed'
           AND (o.isDesignatedSupporter = 1 OR a.response = 'supporter')
       ) sup ON sup.participantId = pm.participantId
       GROUP BY pm.userId, u.name, u.email
       ORDER BY supporters DESC, mobilized DESC, u.name ASC`,
      [eventId, eventId, eventId, eventId]
    ) as Array<{
      userId: string;
      name: string;
      email: string;
      mobilized: string;
      supporters: string;
    }>;

    return rows.map((row) => {
      const mobilized = Number(row.mobilized) || 0;
      const supporters = Number(row.supporters) || 0;
      return {
        userId: row.userId,
        name: row.name,
        email: row.email,
        mobilized,
        supporters,
        support_rate: pct(supporters, mobilized),
      };
    });
  }

  private static async fetchDistinctEventSupporters(eventId: string) {
    const rows = await AppDataSource.query(
      `SELECT
         a.participantId,
         a.ward,
         a.constituency,
         a.county,
         a.pollingCenter,
         a.recordedAt
       FROM survey_assignments a
       INNER JOIN surveys s ON s.id = a.surveyId
       LEFT JOIN survey_response_options o ON o.id = a.responseOptionId
       WHERE s.eventId = ?
         AND s.status IN ('active', 'closed')
         AND a.status = 'completed'
         AND (o.isDesignatedSupporter = 1 OR a.response = 'supporter')
       ORDER BY a.recordedAt DESC`,
      [eventId]
    ) as Array<{
      participantId: string;
      ward: string | null;
      constituency: string | null;
      county: string | null;
      pollingCenter: string | null;
      recordedAt: Date | string | null;
    }>;

    const byParticipant = new Map<
      string,
      { ward: string; constituency: string; county: string; pollingCenter: string }
    >();

    for (const row of rows) {
      if (byParticipant.has(row.participantId)) continue;
      byParticipant.set(row.participantId, {
        ward: row.ward?.trim() ?? '',
        constituency: row.constituency?.trim() ?? '',
        county: row.county?.trim() ?? '',
        pollingCenter: row.pollingCenter?.trim() ?? '',
      });
    }

    return [...byParticipant.values()];
  }

  private static supportersFromJurisdictionStats(
    surveyRows: SurveyJurisdictionStat[]
  ): Array<{ ward: string; constituency: string; county: string; pollingCenter: string }> {
    const supporters: Array<{
      ward: string;
      constituency: string;
      county: string;
      pollingCenter: string;
    }> = [];

    for (const row of surveyRows) {
      for (let i = 0; i < row.supporter; i += 1) {
        supporters.push({
          ward: row.ward?.trim() ?? '',
          constituency: row.constituency?.trim() ?? '',
          county: row.county?.trim() ?? '',
          pollingCenter: row.pollingCenter?.trim() ?? '',
        });
      }
    }

    return supporters;
  }

  private static buildSupporterBreakdownFromMaps(
    _eventId: string,
    mobilizedRows: Awaited<ReturnType<typeof AnalyticsReadService.getJurisdictionRows>>,
    supporterLocations: Array<{
      ward: string;
      constituency: string;
      county: string;
      pollingCenter: string;
    }>,
    totalSupporters: number,
    totalMobilized: number,
    surveysIncluded: number
  ) {
    type WardAcc = {
      ward: string;
      constituency: string;
      county: string;
      mobilized: number;
      supporters: number;
    };

    type PcAcc = {
      polling_center: string;
      ward: string;
      constituency: string;
      county: string;
      mobilized: number;
      supporters: number;
    };

    const wardMap = new Map<string, WardAcc>();
    const pcMap = new Map<string, PcAcc>();

    const wardKey = (ward: string, constituency: string) =>
      `${constituency}|${ward}`.trim().toUpperCase();

    const upsertWard = (ward: string, constituency: string, county: string): WardAcc => {
      const key = wardKey(ward, constituency);
      let entry = wardMap.get(key);
      if (!entry) {
        entry = { ward, constituency, county, mobilized: 0, supporters: 0 };
        wardMap.set(key, entry);
      }
      return entry;
    };

    const upsertPc = (
      pollingCenter: string,
      ward: string,
      constituency: string,
      county: string
    ): PcAcc => {
      const key = JurisdictionService.compositeKey(pollingCenter, ward, constituency);
      let entry = pcMap.get(key);
      if (!entry) {
        entry = {
          polling_center: pollingCenter,
          ward,
          constituency,
          county,
          mobilized: 0,
          supporters: 0,
        };
        pcMap.set(key, entry);
      }
      return entry;
    };

    for (const row of mobilizedRows) {
      const ward = row.ward?.trim() ?? '';
      const constituency = row.constituency?.trim() ?? '';
      const county = row.county?.trim() ?? '';
      if (ward) {
        upsertWard(ward, constituency, county).mobilized += row.uniqueMobilized;
      }
      const pc = row.pollingCenter?.trim() ?? '';
      if (pc) {
        upsertPc(pc, ward, constituency, county).mobilized += row.uniqueMobilized;
      }
    }

    for (const row of supporterLocations) {
      const ward = row.ward?.trim() ?? '';
      const constituency = row.constituency?.trim() ?? '';
      const county = row.county?.trim() ?? '';
      if (ward) {
        upsertWard(ward, constituency, county).supporters += 1;
      }
      const pc = row.pollingCenter?.trim() ?? '';
      if (pc) {
        upsertPc(pc, ward, constituency, county).supporters += 1;
      }
    }

    const mapWard = (entry: WardAcc) => ({
      ward: entry.ward,
      constituency: entry.constituency,
      county: entry.county,
      mobilized: entry.mobilized,
      supporters: entry.supporters,
      support_rate: pct(entry.supporters, entry.mobilized),
    });

    const mapPc = (entry: PcAcc) => ({
      polling_center: entry.polling_center,
      ward: entry.ward,
      constituency: entry.constituency,
      county: entry.county,
      mobilized: entry.mobilized,
      supporters: entry.supporters,
      support_rate: pct(entry.supporters, entry.mobilized),
    });

    const wards = [...wardMap.values()]
      .filter((w) => w.mobilized > 0 || w.supporters > 0)
      .map(mapWard)
      .sort((a, b) => b.supporters - a.supporters || b.mobilized - a.mobilized || a.ward.localeCompare(b.ward));

    const polling_centers = [...pcMap.values()]
      .filter((pc) => pc.mobilized > 0 || pc.supporters > 0)
      .map(mapPc)
      .sort(
        (a, b) =>
          a.ward.localeCompare(b.ward) ||
          b.supporters - a.supporters ||
          a.polling_center.localeCompare(b.polling_center)
      );

    return {
      totals: {
        mobilized: totalMobilized,
        supporters: totalSupporters,
        support_rate: pct(totalSupporters, totalMobilized),
      },
      surveys_included: surveysIncluded,
      wards,
      polling_centers,
    };
  }
}
