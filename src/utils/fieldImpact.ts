import { AppDataSource } from '../config/database';
import { CheckInLog } from '../entities/CheckInLog';
import { Event } from '../entities/Event';
import { PollingCenter } from '../entities/PollingCenter';
import { JurisdictionService } from '../services/JurisdictionService';
import { AnalyticsReadService } from '../services/AnalyticsReadService';
import {
  computeCampaignPace,
  DEFAULT_TARGET_COVERAGE_PERCENT,
} from './campaignPace';

export interface FieldPollingCenterImpact {
  polling_center: string;
  ward: string;
  constituency: string;
  code: string | null;
  my_mobilized: number;
  campaign_mobilized: number;
  registered_voters: number;
  coverage_percent: number | null;
  target_mobilized: number;
  gap_to_target: number;
  progress_percent: number | null;
  ratio: string;
}

export interface FieldImpactSummary {
  event: {
    eventId: string;
    eventName: string;
    scope_label: string | null;
    target_coverage_percent: number;
    target_date: string | null;
  };
  my_stats: {
    total_mobilized: number;
    mobilized_today: number;
    total_check_ins: number;
    polling_centers_influenced: number;
    registered_voters_in_influenced_centers: number;
    target_mobilized: number;
    gap_to_target: number;
    progress_percent: number | null;
  };
  campaign_pace: ReturnType<typeof computeCampaignPace>;
  polling_centers: FieldPollingCenterImpact[];
}

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function resolveRegisteredVoters(
  pcMap: Map<string, PollingCenter>,
  pollingCenter: string,
  ward: string,
  constituency: string
): number {
  const key = JurisdictionService.compositeKey(pollingCenter, ward, constituency);
  const master = pcMap.get(key);
  if (master) return master.registeredVoters;

  for (const pc of pcMap.values()) {
    if (pc.name === pollingCenter) return pc.registeredVoters;
  }

  return 0;
}

export async function buildFieldImpact(
  event: Event,
  userId: string
): Promise<FieldImpactSummary> {
  const eventId = event.eventId;
  const today = startOfToday();
  const targetCoverage = DEFAULT_TARGET_COVERAGE_PERCENT;

  const centersInScope = await JurisdictionService.getPollingCentersInEventScope(event);
  const pcMap = new Map<string, PollingCenter>();
  for (const pc of centersInScope) {
    pcMap.set(JurisdictionService.compositeKey(pc.name, pc.wardName, pc.constituencyName), pc);
  }

  const [myAgentRows, campaignByKey, agentTotals] = await Promise.all([
    AnalyticsReadService.getAgentRows(eventId, userId),
    AnalyticsReadService.getCampaignMobilizedByCenter(eventId),
    AnalyticsReadService.getAgentTotals(eventId, userId),
  ]);

  const polling_centers: FieldPollingCenterImpact[] = myAgentRows.map((row) => {
    const pollingCenter = row.pollingCenter || '';
    const ward = row.ward || '';
    const constituency = row.constituency || '';
    const key = JurisdictionService.compositeKey(pollingCenter, ward, constituency);
    const my_mobilized = row.uniqueMobilized;
    const campaign_mobilized = campaignByKey.get(key) ?? my_mobilized;
    const registered_voters = resolveRegisteredVoters(pcMap, pollingCenter, ward, constituency);
    const target_mobilized =
      registered_voters > 0 ? Math.ceil((registered_voters * targetCoverage) / 100) : 0;
    const gap_to_target = Math.max(0, target_mobilized - my_mobilized);
    const progress_percent =
      target_mobilized > 0
        ? parseFloat(((my_mobilized / target_mobilized) * 100).toFixed(1))
        : null;
    const coverage_percent =
      registered_voters > 0
        ? parseFloat(((campaign_mobilized / registered_voters) * 100).toFixed(1))
        : null;
    const master = pcMap.get(key);

    return {
      polling_center: pollingCenter,
      ward,
      constituency,
      code: master?.code ?? null,
      my_mobilized,
      campaign_mobilized,
      registered_voters,
      coverage_percent,
      target_mobilized,
      gap_to_target,
      progress_percent,
      ratio:
        registered_voters > 0
          ? `${my_mobilized} / ${target_mobilized}`
          : `${my_mobilized}`,
    };
  });

  const mobilizedTodayRaw = await AppDataSource.getRepository(CheckInLog)
    .createQueryBuilder('l')
    .where('l.eventId = :eventId', { eventId })
    .andWhere('l.checkedInById = :userId', { userId })
    .andWhere('l.checkInDate = :today', { today })
    .select('COUNT(DISTINCT l.participantId)', 'count')
    .getRawOne<{ count: string }>();

  const myTotal = agentTotals.total_mobilized;
  const myToday = parseInt(mobilizedTodayRaw?.count ?? '0', 10) || 0;
  const registered_voters_in_influenced_centers = polling_centers.reduce(
    (sum, pc) => sum + pc.registered_voters,
    0
  );
  const target_mobilized =
    registered_voters_in_influenced_centers > 0
      ? Math.ceil((registered_voters_in_influenced_centers * targetCoverage) / 100)
      : 0;
  const gap_to_target = Math.max(0, target_mobilized - myTotal);
  const progress_percent =
    target_mobilized > 0
      ? parseFloat(((myTotal / target_mobilized) * 100).toFixed(1))
      : null;

  const scopeLabel = JurisdictionService.getScopeLabel(event);

  let targetDate: string | null = null;
  if (event.date) {
    const d = event.date instanceof Date ? event.date : new Date(event.date);
    if (!isNaN(d.getTime())) {
      targetDate = d.toISOString().slice(0, 10);
    }
  }

  return {
    event: {
      eventId: event.eventId,
      eventName: event.eventName,
      scope_label: scopeLabel,
      target_coverage_percent: targetCoverage,
      target_date: targetDate,
    },
    my_stats: {
      total_mobilized: myTotal,
      mobilized_today: myToday,
      total_check_ins: agentTotals.total_check_ins,
      polling_centers_influenced: agentTotals.polling_centers_influenced,
      registered_voters_in_influenced_centers,
      target_mobilized,
      gap_to_target,
      progress_percent,
    },
    campaign_pace: computeCampaignPace({
      targetDate: event.date,
      targetCoveragePercent: targetCoverage,
      registeredVoters:
        registered_voters_in_influenced_centers > 0
          ? registered_voters_in_influenced_centers
          : null,
      mobilized: myTotal,
    }),
    polling_centers,
  };
}
