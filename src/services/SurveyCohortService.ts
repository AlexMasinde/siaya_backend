import { AppDataSource } from '../config/database';
import { Survey, SurveyStatus } from '../entities/Survey';
import { SurveyAssignmentStatus } from '../entities/SurveyAssignment';
import { SurveyResponseCategory } from '../entities/SurveyResponseOption';

export const SURVEY_LAUNCH_COHORTS = [
  'new_since_previous',
  'pending_previous',
  'supporters',
  'non_supporters',
  'undecided',
  'unreachable',
  'relocated',
  'declined',
  'withheld',
] as const;

export type SurveyLaunchCohort = (typeof SURVEY_LAUNCH_COHORTS)[number];

export const SURVEY_LAUNCH_COHORT_LABELS: Record<SurveyLaunchCohort, string> = {
  new_since_previous: 'New mobilizations (not in previous survey)',
  pending_previous: 'Not yet contacted (previous survey)',
  supporters: 'Supporters (previous survey)',
  non_supporters: 'Non-supporters (previous survey)',
  undecided: 'Undecided (previous survey)',
  unreachable: 'Unreachable / not found (previous survey)',
  relocated: 'Relocated (previous survey)',
  declined: 'Declined / not interested (previous survey)',
  withheld: 'Withheld / will not disclose (previous survey)',
};

export interface MobilizedRow {
  participantId: string;
  name: string | null;
  phoneNumber: string | null;
  county: string | null;
  constituency: string | null;
  ward: string | null;
  pollingCenter: string | null;
}

interface PreviousAssignmentRow {
  participantId: string;
  status: string;
  response: string | null;
  category: string | null;
  isDesignatedSupporter: number | boolean;
}

export function hasCallablePhone(phone: string | null): boolean {
  if (!phone) return false;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 9;
}

export function isValidLaunchCohort(value: string): value is SurveyLaunchCohort {
  return (SURVEY_LAUNCH_COHORTS as readonly string[]).includes(value);
}

export function parseLaunchCohorts(raw: unknown): SurveyLaunchCohort[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item): item is SurveyLaunchCohort => typeof item === 'string' && isValidLaunchCohort(item));
}

function isDesignatedSupporterFlag(value: number | boolean | string | null | undefined): boolean {
  return Number(value) === 1;
}

/** Align with SurveyResponseOptionService.legacyColumnForOption / survey stats. */
function cohortForPreviousAssignment(row: PreviousAssignmentRow): SurveyLaunchCohort | null {
  if (row.status !== SurveyAssignmentStatus.COMPLETED) {
    return 'pending_previous';
  }

  if (isDesignatedSupporterFlag(row.isDesignatedSupporter)) {
    return 'supporters';
  }

  const category = row.category;
  if (category === SurveyResponseCategory.SUPPORTER) {
    return 'supporters';
  }
  if (category === SurveyResponseCategory.OPPOSITION) {
    return 'non_supporters';
  }
  if (category === SurveyResponseCategory.NEUTRAL) {
    return 'undecided';
  }
  if (category === SurveyResponseCategory.UNREACHABLE) {
    return 'unreachable';
  }
  if (category === SurveyResponseCategory.RELOCATED) {
    return 'relocated';
  }
  if (category === SurveyResponseCategory.DECLINED) {
    return 'declined';
  }
  if (category === SurveyResponseCategory.WITHHELD) {
    return 'withheld';
  }

  // Legacy assignments recorded before custom response options.
  if (row.response === 'supporter') {
    return 'supporters';
  }
  if (row.response === 'not_supporter') {
    return 'non_supporters';
  }
  if (row.response === 'undecided') {
    return 'undecided';
  }
  if (row.response === 'not_found') {
    return 'unreachable';
  }

  return 'undecided';
}

function buildCohortSets(
  callable: MobilizedRow[],
  previous: PreviousAssignmentRow[]
): Record<SurveyLaunchCohort, Set<string>> {
  const previousIds = new Set(previous.map((row) => row.participantId));
  const mobilizedById = new Map(callable.map((row) => [row.participantId, row]));

  const cohortSets = Object.fromEntries(
    SURVEY_LAUNCH_COHORTS.map((key) => [key, new Set<string>()])
  ) as Record<SurveyLaunchCohort, Set<string>>;

  for (const row of callable) {
    if (!previousIds.has(row.participantId)) {
      cohortSets.new_since_previous.add(row.participantId);
    }
  }

  for (const row of previous) {
    const cohort = cohortForPreviousAssignment(row);
    if (!cohort || !mobilizedById.has(row.participantId)) continue;
    cohortSets[cohort].add(row.participantId);
  }

  return cohortSets;
}

function unionSelectedParticipantIds(
  cohortSets: Record<SurveyLaunchCohort, Set<string>>,
  cohorts: SurveyLaunchCohort[]
): Set<string> {
  const selectedIds = new Set<string>();
  for (const cohort of cohorts) {
    for (const participantId of cohortSets[cohort]) {
      selectedIds.add(participantId);
    }
  }
  return selectedIds;
}

export async function fetchMobilizedParticipants(eventId: string): Promise<MobilizedRow[]> {
  const rows = await AppDataSource.query(
    `SELECT
       p.id AS participantId,
       p.name,
       p.phoneNumber,
       p.county,
       p.constituency,
       p.ward,
       p.pollingCenter
     FROM (
       SELECT DISTINCT l.participantId
       FROM check_in_logs l
       WHERE l.eventId = ?
     ) mobilized
     INNER JOIN participants p ON p.id = mobilized.participantId
     ORDER BY p.id ASC`,
    [eventId]
  );
  return rows as MobilizedRow[];
}

async function fetchPreviousAssignments(sourceSurveyId: string): Promise<PreviousAssignmentRow[]> {
  const rows = await AppDataSource.query(
    `SELECT
       a.participantId,
       a.status,
       a.response,
       o.category,
       COALESCE(o.isDesignatedSupporter, 0) AS isDesignatedSupporter
     FROM survey_assignments a
     LEFT JOIN survey_response_options o ON o.id = a.responseOptionId
     WHERE a.surveyId = ?`,
    [sourceSurveyId]
  );
  return rows as PreviousAssignmentRow[];
}

export async function assertSourceSurvey(
  eventId: string,
  surveyId: string,
  sourceSurveyId: string
): Promise<Survey> {
  if (sourceSurveyId === surveyId) {
    throw new Error('Source survey must be a different survey');
  }

  const source = await AppDataSource.getRepository(Survey).findOne({
    where: { id: sourceSurveyId },
  });

  if (!source) {
    throw new Error('Source survey not found');
  }

  if (source.eventId !== eventId) {
    throw new Error('Source survey must belong to the same event');
  }

  if (source.status !== SurveyStatus.ACTIVE && source.status !== SurveyStatus.CLOSED) {
    throw new Error('Source survey must be active or closed');
  }

  return source;
}

export interface CohortPreviewResult {
  mobilizedTotal: number;
  callableTotal: number;
  noPhoneCount: number;
  cohortCounts: Record<SurveyLaunchCohort, number>;
  selectedTotal: number;
  mode: 'full' | 'cohort';
}

export async function previewLaunchCohorts(
  eventId: string,
  surveyId: string,
  sourceSurveyId: string | null,
  cohorts: SurveyLaunchCohort[]
): Promise<CohortPreviewResult> {
  const mobilized = await fetchMobilizedParticipants(eventId);
  const callable = mobilized.filter((row) => hasCallablePhone(row.phoneNumber));
  const noPhoneCount = mobilized.length - callable.length;

  const emptyCounts = Object.fromEntries(
    SURVEY_LAUNCH_COHORTS.map((key) => [key, 0])
  ) as Record<SurveyLaunchCohort, number>;

  if (!sourceSurveyId) {
    return {
      mobilizedTotal: mobilized.length,
      callableTotal: callable.length,
      noPhoneCount,
      cohortCounts: emptyCounts,
      selectedTotal: callable.length,
      mode: 'full',
    };
  }

  await assertSourceSurvey(eventId, surveyId, sourceSurveyId);

  const previous = await fetchPreviousAssignments(sourceSurveyId);
  const cohortSets = buildCohortSets(callable, previous);
  const selectedIds = unionSelectedParticipantIds(cohortSets, cohorts);

  const cohortCounts = Object.fromEntries(
    SURVEY_LAUNCH_COHORTS.map((key) => [key, cohortSets[key].size])
  ) as Record<SurveyLaunchCohort, number>;

  return {
    mobilizedTotal: mobilized.length,
    callableTotal: callable.length,
    noPhoneCount,
    cohortCounts,
    selectedTotal: cohorts.length > 0 ? selectedIds.size : 0,
    mode: 'cohort',
  };
}

export async function resolveLaunchCallable(
  eventId: string,
  surveyId: string,
  sourceSurveyId: string | null,
  cohorts: SurveyLaunchCohort[]
): Promise<{ mobilized: MobilizedRow[]; callable: MobilizedRow[]; noPhoneCount: number }> {
  const mobilized = await fetchMobilizedParticipants(eventId);
  const allCallable = mobilized.filter((row) => hasCallablePhone(row.phoneNumber));
  const noPhoneCount = mobilized.length - allCallable.length;

  if (!sourceSurveyId || cohorts.length === 0) {
    return { mobilized, callable: allCallable, noPhoneCount };
  }

  await assertSourceSurvey(eventId, surveyId, sourceSurveyId);

  const previous = await fetchPreviousAssignments(sourceSurveyId);
  const cohortSets = buildCohortSets(allCallable, previous);
  const selectedIds = unionSelectedParticipantIds(cohortSets, cohorts);

  if (selectedIds.size === 0) {
    return { mobilized, callable: [], noPhoneCount };
  }

  const callable = allCallable.filter((row) => selectedIds.has(row.participantId));
  return { mobilized, callable, noPhoneCount };
}
