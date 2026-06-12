import type { CampaignPace } from './campaignPace';
import { computeCampaignPace } from './campaignPace';

const EAT_OFFSET_MS = 3 * 60 * 60 * 1000;

export interface TrendPoint {
  date: string;
  count: number;
}

export interface WeeklyTrendPoint {
  week_start: string;
  count: number;
}

export interface HeatmapCell {
  day_of_week: number;
  hour: number;
  count: number;
}

/** Below this fraction of the area's baseline daily average counts as a "quiet" day. */
export const COOLING_QUIET_FRACTION = 0.3;

/** Consecutive quiet days required to flag cooling off. */
export const COOLING_CONSECUTIVE_DAYS = 3;

/** Calendar days before the evaluation window used to compute each area's daily average. */
export const COOLING_BASELINE_DAYS = 14;

/** Minimum mobilizations in the baseline window before an area can be evaluated. */
export const COOLING_MIN_BASELINE_TOTAL = 3;

export interface CoolingOffDay {
  date: string;
  count: number;
}

export interface CoolingOffItem {
  name: string;
  daily_average: number;
  recent_daily_total: number;
  percent_of_average: number;
  recent_days: CoolingOffDay[];
  mobilized_total: number;
}

export interface MomentumAnalytics {
  unique_checked_in: number;
  registered_voters_in_scope: number | null;
  scope_label: string | null;
  campaign_pace: CampaignPace;
  trend: {
    daily: TrendPoint[];
    weekly: WeeklyTrendPoint[];
    seven_day_average: number | null;
  };
  activity_heatmap: {
    cells: HeatmapCell[];
    max_count: number;
  };
  cooling_off: {
    level: 'ward' | 'constituency' | 'polling_center';
    label: string;
    rule: {
      threshold_percent: number;
      consecutive_days: number;
      baseline_days: number;
      description: string;
    };
    items: CoolingOffItem[];
  };
}

interface MobilizationRow {
  checkedInAt: Date | string;
  ward: string | null;
  constituency: string | null;
  pollingCenter: string | null;
}

function toEatDate(value: Date | string): Date {
  const d = value instanceof Date ? value : new Date(value);
  return new Date(d.getTime() + EAT_OFFSET_MS);
}

function formatDateOnly(d: Date): string {
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function daysBetween(from: string, to: string): number {
  const a = parseDateOnly(from).getTime();
  const b = parseDateOnly(to).getTime();
  return Math.round((b - a) / (24 * 60 * 60 * 1000));
}

function mondayBasedDow(eatDate: Date): number {
  const jsDow = eatDate.getUTCDay();
  return jsDow === 0 ? 6 : jsDow - 1;
}

function weekStartMonday(dateStr: string): string {
  const d = parseDateOnly(dateStr);
  const dow = mondayBasedDow(d);
  d.setUTCDate(d.getUTCDate() - dow);
  return formatDateOnly(d);
}

function coolingLevelForDrillDown(filter: {
  ward?: string;
  constituency?: string;
  pollingCenter?: string;
}): { level: 'ward' | 'constituency' | 'polling_center'; field: keyof MobilizationRow } {
  if (filter.pollingCenter || filter.ward) {
    return { level: 'polling_center', field: 'pollingCenter' };
  }
  if (filter.constituency) {
    return { level: 'ward', field: 'ward' };
  }
  return { level: 'constituency', field: 'constituency' };
}

function areaKey(row: MobilizationRow, field: keyof MobilizationRow): string | null {
  const value = row[field];
  if (!value || typeof value !== 'string' || !value.trim()) return null;
  return value.trim();
}

function dateAtOffset(todayStr: string, dayOffset: number): string {
  const d = parseDateOnly(todayStr);
  d.setUTCDate(d.getUTCDate() - dayOffset);
  return formatDateOnly(d);
}

function evaluateCoolingOff(
  byDay: Map<string, number>,
  todayStr: string
): Omit<CoolingOffItem, 'name' | 'mobilized_total'> | null {
  const recentDays: CoolingOffDay[] = Array.from(
    { length: COOLING_CONSECUTIVE_DAYS },
    (_, i) => {
      const date = dateAtOffset(todayStr, i);
      return { date, count: byDay.get(date) ?? 0 };
    }
  );

  const baselineDates = Array.from({ length: COOLING_BASELINE_DAYS }, (_, i) =>
    dateAtOffset(todayStr, COOLING_CONSECUTIVE_DAYS + i)
  );
  const baselineCounts = baselineDates.map((d) => byDay.get(d) ?? 0);
  const baselineTotal = baselineCounts.reduce((sum, c) => sum + c, 0);

  if (baselineTotal < COOLING_MIN_BASELINE_TOTAL) {
    return null;
  }

  const dailyAverage = baselineTotal / COOLING_BASELINE_DAYS;
  if (dailyAverage <= 0) {
    return null;
  }

  const quietThreshold = COOLING_QUIET_FRACTION * dailyAverage;
  const allQuiet = recentDays.every((d) => d.count < quietThreshold);
  if (!allQuiet) {
    return null;
  }

  const recentDailyTotal = recentDays.reduce((sum, d) => sum + d.count, 0);
  const recentDailyMean = recentDailyTotal / COOLING_CONSECUTIVE_DAYS;
  const percentOfAverage = parseFloat(((recentDailyMean / dailyAverage) * 100).toFixed(1));

  return {
    daily_average: parseFloat(dailyAverage.toFixed(1)),
    recent_daily_total: recentDailyTotal,
    percent_of_average: percentOfAverage,
    recent_days: [...recentDays].reverse(),
  };
}

export function buildMomentumAnalytics(params: {
  rows: MobilizationRow[];
  registeredVoters: number | null;
  targetDate: Date | string | null;
  scopeLabel: string | null;
  drillDown: { ward?: string; constituency?: string; pollingCenter?: string };
}): MomentumAnalytics {
  const todayEat = toEatDate(new Date());
  const todayStr = formatDateOnly(todayEat);

  const dailyMap = new Map<string, number>();
  const weeklyMap = new Map<string, number>();
  const heatmapMap = new Map<string, number>();
  const areaDaily = new Map<string, Map<string, number>>();
  const areaTotals = new Map<string, number>();

  const { level, field } = coolingLevelForDrillDown(params.drillDown);
  const levelLabel =
    level === 'polling_center' ? 'Polling center' : level === 'ward' ? 'Ward' : 'Constituency';

  for (const row of params.rows) {
    const eat = toEatDate(row.checkedInAt);
    const dayStr = formatDateOnly(eat);
    const weekStr = weekStartMonday(dayStr);
    const dow = mondayBasedDow(eat);
    const hour = eat.getUTCHours();

    dailyMap.set(dayStr, (dailyMap.get(dayStr) ?? 0) + 1);
    weeklyMap.set(weekStr, (weeklyMap.get(weekStr) ?? 0) + 1);

    const heatKey = `${dow}-${hour}`;
    heatmapMap.set(heatKey, (heatmapMap.get(heatKey) ?? 0) + 1);

    const area = areaKey(row, field);
    if (area) {
      areaTotals.set(area, (areaTotals.get(area) ?? 0) + 1);
      if (!areaDaily.has(area)) areaDaily.set(area, new Map());
      const byDay = areaDaily.get(area)!;
      byDay.set(dayStr, (byDay.get(dayStr) ?? 0) + 1);
    }
  }

  const daily = [...dailyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const weekly = [...weeklyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([week_start, count]) => ({ week_start, count }));

  const last7 = daily.filter((p) => daysBetween(p.date, todayStr) >= 0 && daysBetween(p.date, todayStr) < 7);
  const sevenDayAverage =
    last7.length > 0
      ? parseFloat((last7.reduce((s, p) => s + p.count, 0) / last7.length).toFixed(1))
      : null;

  let maxHeat = 0;
  const cells: HeatmapCell[] = [];
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const count = heatmapMap.get(`${dow}-${hour}`) ?? 0;
      maxHeat = Math.max(maxHeat, count);
      cells.push({ day_of_week: dow, hour, count });
    }
  }

  const coolingItems: CoolingOffItem[] = [];
  for (const [name, byDay] of areaDaily) {
    const evaluation = evaluateCoolingOff(byDay, todayStr);
    if (!evaluation) continue;

    coolingItems.push({
      name,
      ...evaluation,
      mobilized_total: areaTotals.get(name) ?? 0,
    });
  }

  coolingItems.sort(
    (a, b) => a.percent_of_average - b.percent_of_average || a.name.localeCompare(b.name)
  );

  const mobilized = params.rows.length;

  return {
    unique_checked_in: mobilized,
    registered_voters_in_scope: params.registeredVoters,
    scope_label: params.scopeLabel,
    campaign_pace: computeCampaignPace({
      targetDate: params.targetDate,
      registeredVoters: params.registeredVoters,
      mobilized,
    }),
    trend: {
      daily,
      weekly,
      seven_day_average: sevenDayAverage,
    },
    activity_heatmap: {
      cells,
      max_count: maxHeat,
    },
    cooling_off: {
      level,
      label: levelLabel,
      rule: {
        threshold_percent: COOLING_QUIET_FRACTION * 100,
        consecutive_days: COOLING_CONSECUTIVE_DAYS,
        baseline_days: COOLING_BASELINE_DAYS,
        description:
          'Flagged when each of the last 3 days is below 30% of the prior 14-day daily average (minimum 3 mobilizations in that baseline).',
      },
      items: coolingItems.slice(0, 25),
    },
  };
}
