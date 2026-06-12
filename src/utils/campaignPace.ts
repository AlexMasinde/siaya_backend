export const DEFAULT_TARGET_COVERAGE_PERCENT = 55;

export type CampaignPaceStatus =
  | 'on_track'
  | 'behind'
  | 'ahead'
  | 'target_met'
  | 'past_due'
  | 'unavailable';

export interface CampaignPace {
  target_coverage_percent: number;
  target_date: string | null;
  days_remaining: number | null;
  target_mobilized: number | null;
  gap_to_target: number | null;
  daily_pace_required: number | null;
  status: CampaignPaceStatus;
}

function toDateOnly(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
  }
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function formatDateOnly(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function calendarDaysBetween(from: Date, to: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((to.getTime() - from.getTime()) / msPerDay);
}

export function computeCampaignPace(params: {
  targetDate: Date | string | null;
  targetCoveragePercent?: number;
  registeredVoters: number | null;
  mobilized: number;
}): CampaignPace {
  const targetCoverage = params.targetCoveragePercent ?? DEFAULT_TARGET_COVERAGE_PERCENT;
  const registered = params.registeredVoters;
  const mobilized = params.mobilized;
  const endDate = toDateOnly(params.targetDate);

  if (!endDate || registered == null || registered <= 0) {
    return {
      target_coverage_percent: targetCoverage,
      target_date: endDate ? formatDateOnly(endDate) : null,
      days_remaining: null,
      target_mobilized: null,
      gap_to_target: null,
      daily_pace_required: null,
      status: 'unavailable',
    };
  }

  const today = toDateOnly(new Date())!;
  const daysRemaining = calendarDaysBetween(today, endDate);
  const targetMobilized = Math.ceil((registered * targetCoverage) / 100);
  const gapToTarget = Math.max(0, targetMobilized - mobilized);
  const targetDateStr = formatDateOnly(endDate);

  if (gapToTarget === 0) {
    return {
      target_coverage_percent: targetCoverage,
      target_date: targetDateStr,
      days_remaining: Math.max(0, daysRemaining),
      target_mobilized: targetMobilized,
      gap_to_target: 0,
      daily_pace_required: 0,
      status: mobilized > targetMobilized ? 'ahead' : 'target_met',
    };
  }

  if (daysRemaining < 0) {
    return {
      target_coverage_percent: targetCoverage,
      target_date: targetDateStr,
      days_remaining: 0,
      target_mobilized: targetMobilized,
      gap_to_target: gapToTarget,
      daily_pace_required: gapToTarget,
      status: 'past_due',
    };
  }

  const currentCoverage = (mobilized / registered) * 100;
  const daysForPace = Math.max(1, daysRemaining);
  const dailyPace = Math.ceil(gapToTarget / daysForPace);

  let status: CampaignPaceStatus = 'behind';
  if (currentCoverage >= targetCoverage) {
    status = 'ahead';
  } else if (daysRemaining === 0) {
    status = 'past_due';
  } else {
    status = 'behind';
  }

  return {
    target_coverage_percent: targetCoverage,
    target_date: targetDateStr,
    days_remaining: daysRemaining,
    target_mobilized: targetMobilized,
    gap_to_target: gapToTarget,
    daily_pace_required: dailyPace,
    status,
  };
}
