import { EntityManager } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { AppDataSource } from '../config/database';
import { Survey, SurveyStatus } from '../entities/Survey';
import { SurveyAgent } from '../entities/SurveyAgent';
import {
  buildAssignmentGrain,
  seedSurveyStatsOnAssignments,
} from './SurveyIncrementService';
import { SurveyResponseOptionService } from './SurveyResponseOptionService';
import {
  MobilizedRow,
  parseLaunchCohorts,
  resolveLaunchCallable,
  SurveyLaunchCohort,
} from './SurveyCohortService';
import logger from '../config/logger';

const BATCH_SIZE = 500;

export interface SurveyLaunchOptions {
  sourceSurveyId?: string | null;
  cohorts?: SurveyLaunchCohort[];
}

async function bulkInsertAssignments(
  manager: EntityManager,
  surveyId: string,
  callable: MobilizedRow[],
  agentIds: string[]
): Promise<void> {
  const agentCounts = new Map<string, number>();
  const jurisdictionCounts = new Map<
    string,
    { count: number; county: string; constituency: string; ward: string; pollingCenter: string }
  >();

  for (const agentId of agentIds) {
    agentCounts.set(agentId, 0);
  }

  for (let i = 0; i < callable.length; i += BATCH_SIZE) {
    const chunk = callable.slice(i, i + BATCH_SIZE);
    const values: unknown[] = [];
    const placeholders: string[] = [];

    chunk.forEach((row, idx) => {
      const globalIndex = i + idx;
      const agentId = agentIds[globalIndex % agentIds.length];
      const grain = buildAssignmentGrain(
        row.pollingCenter ?? '',
        row.ward ?? '',
        row.constituency ?? '',
        row.county ?? ''
      );

      agentCounts.set(agentId, (agentCounts.get(agentId) ?? 0) + 1);

      if (grain.grainKey) {
        const existing = jurisdictionCounts.get(grain.grainKey);
        if (existing) {
          existing.count += 1;
        } else {
          jurisdictionCounts.set(grain.grainKey, { count: 1, ...grain });
        }
      }

      placeholders.push(
        `(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL)`
      );
      values.push(
        uuidv4(),
        surveyId,
        row.participantId,
        agentId,
        row.name,
        row.phoneNumber,
        grain.county,
        grain.constituency,
        grain.ward,
        grain.pollingCenter,
        grain.grainKey
      );
    });

    if (placeholders.length > 0) {
      await manager.query(
        `INSERT INTO survey_assignments (
           id, surveyId, participantId, agentId,
           participantName, phoneNumber, county, constituency, ward, pollingCenter, grainKey,
           status, response, recordedById, recordedAt
         ) VALUES ${placeholders.join(', ')}`,
        values
      );
    }
  }

  await seedSurveyStatsOnAssignments(manager, surveyId, agentCounts, jurisdictionCounts);
}

function normalizeLaunchOptions(options?: SurveyLaunchOptions): {
  sourceSurveyId: string | null;
  cohorts: SurveyLaunchCohort[];
} {
  const sourceSurveyId =
    typeof options?.sourceSurveyId === 'string' && options.sourceSurveyId.trim()
      ? options.sourceSurveyId.trim()
      : null;
  const cohorts = parseLaunchCohorts(options?.cohorts);

  if (sourceSurveyId && cohorts.length === 0) {
    throw new Error('Select at least one call group from the previous survey');
  }
  if (!sourceSurveyId && cohorts.length > 0) {
    throw new Error('Choose a previous survey when selecting call groups');
  }

  return { sourceSurveyId, cohorts };
}

export async function launchSurvey(surveyId: string, options?: SurveyLaunchOptions): Promise<Survey> {
  const surveyRepo = AppDataSource.getRepository(Survey);

  const survey = await surveyRepo.findOne({
    where: { id: surveyId },
    relations: ['agents'],
  });

  if (!survey) {
    throw new Error('Survey not found');
  }

  if (survey.status !== SurveyStatus.DRAFT) {
    throw new Error('Only draft surveys can be started');
  }

  const agentIds = survey.agents.map((a) => a.userId);
  if (agentIds.length === 0) {
    throw new Error('Add at least one survey agent before starting');
  }

  await SurveyResponseOptionService.validateSurveyCanStart(surveyId);

  const { sourceSurveyId, cohorts } = normalizeLaunchOptions(options);
  const { mobilized, callable, noPhoneCount } = await resolveLaunchCallable(
    survey.eventId,
    surveyId,
    sourceSurveyId,
    cohorts
  );

  if (callable.length === 0) {
    throw new Error('No mobilized participants match the selected call groups');
  }

  await surveyRepo.update(surveyId, { status: SurveyStatus.BUILDING });

  try {
    await AppDataSource.transaction(async (manager) => {
      await bulkInsertAssignments(manager, surveyId, callable, agentIds);

      await manager.getRepository(Survey).update(surveyId, {
        status: SurveyStatus.ACTIVE,
        startedAt: new Date(),
        mobilizedSnapshot: mobilized.length,
        callableTotal: callable.length,
        noPhoneCount,
        sourceSurveyId,
        launchCohorts: sourceSurveyId ? cohorts : null,
      });
    });
  } catch (error) {
    await surveyRepo.update(surveyId, { status: SurveyStatus.DRAFT });
    logger.error('Survey launch failed:', {
      surveyId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  const launched = await surveyRepo.findOne({ where: { id: surveyId } });
  if (!launched) {
    throw new Error('Survey not found after launch');
  }
  return launched;
}

export async function closeSurvey(surveyId: string): Promise<Survey> {
  const surveyRepo = AppDataSource.getRepository(Survey);
  const survey = await surveyRepo.findOne({ where: { id: surveyId } });

  if (!survey) {
    throw new Error('Survey not found');
  }

  if (survey.status !== SurveyStatus.ACTIVE) {
    throw new Error('Only active surveys can be closed');
  }

  survey.status = SurveyStatus.CLOSED;
  survey.closedAt = new Date();
  return surveyRepo.save(survey);
}

export async function setSurveyAgents(surveyId: string, userIds: string[]): Promise<void> {
  const surveyRepo = AppDataSource.getRepository(Survey);
  const survey = await surveyRepo.findOne({ where: { id: surveyId } });

  if (!survey) {
    throw new Error('Survey not found');
  }

  if (survey.status !== SurveyStatus.DRAFT) {
    throw new Error('Agents can only be changed on draft surveys');
  }

  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0) {
    throw new Error('At least one agent is required');
  }

  await AppDataSource.transaction(async (manager) => {
    await manager.delete(SurveyAgent, { surveyId });
    const agentRepo = manager.getRepository(SurveyAgent);
    for (const userId of uniqueIds) {
      await agentRepo.save(agentRepo.create({ surveyId, userId }));
    }
  });
}

export { previewLaunchCohorts } from './SurveyCohortService';
