import { EntityManager } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { SurveyResponseCategory } from '../entities/SurveyResponseOption';
import { SurveyResponseOptionService } from './SurveyResponseOptionService';
import { jurisdictionGrainKey } from '../utils/analyticsGrainKey';

function statDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface SurveyIncrementContext {
  surveyId: string;
  agentId: string;
  optionId: string;
  category: SurveyResponseCategory;
  isDesignatedSupporter: boolean;
  grainKey: string;
  county: string;
  constituency: string;
  ward: string;
  pollingCenter: string;
  recordedAt: Date;
}

async function upsertSurveyStatOnAssign(
  manager: EntityManager,
  surveyId: string,
  count: number
): Promise<void> {
  await manager.query(
    `INSERT INTO survey_stats (id, surveyId, pending, completed, supporter, notSupporter, undecided, notFound, relocated, declined, withheld)
     VALUES (?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0)
     ON DUPLICATE KEY UPDATE pending = pending + ?`,
    [uuidv4(), surveyId, count, count]
  );
}

async function upsertAgentStatOnAssign(
  manager: EntityManager,
  surveyId: string,
  agentId: string,
  count: number
): Promise<void> {
  await manager.query(
    `INSERT INTO survey_agent_stats (
       id, surveyId, agentId, assigned, pending, completed,
       supporter, notSupporter, undecided, notFound, relocated, declined, withheld
     )
     VALUES (?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0)
     ON DUPLICATE KEY UPDATE
       assigned = assigned + ?,
       pending = pending + ?`,
    [uuidv4(), surveyId, agentId, count, count, count, count]
  );
}

async function upsertJurisdictionStatOnAssign(
  manager: EntityManager,
  surveyId: string,
  ctx: {
    grainKey: string;
    county: string;
    constituency: string;
    ward: string;
    pollingCenter: string;
  },
  count: number
): Promise<void> {
  await manager.query(
    `INSERT INTO survey_jurisdiction_stats (
       id, surveyId, grainKey, county, constituency, ward, pollingCenter,
       pending, completed, supporter, notSupporter, undecided, notFound, relocated, declined, withheld
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0, 0, 0, 0)
     ON DUPLICATE KEY UPDATE pending = pending + ?`,
    [
      uuidv4(),
      surveyId,
      ctx.grainKey,
      ctx.county,
      ctx.constituency,
      ctx.ward,
      ctx.pollingCenter,
      count,
      count,
    ]
  );
}

/** Seed summary counters when assignments are bulk-inserted at survey launch. */
export async function seedSurveyStatsOnAssignments(
  manager: EntityManager,
  surveyId: string,
  agentCounts: Map<string, number>,
  jurisdictionCounts: Map<
    string,
    { count: number; county: string; constituency: string; ward: string; pollingCenter: string }
  >
): Promise<void> {
  const total = [...agentCounts.values()].reduce((sum, n) => sum + n, 0);
  if (total > 0) {
    await upsertSurveyStatOnAssign(manager, surveyId, total);
  }

  for (const [agentId, count] of agentCounts) {
    if (count > 0) {
      await upsertAgentStatOnAssign(manager, surveyId, agentId, count);
    }
  }

  for (const [grainKey, meta] of jurisdictionCounts) {
    if (meta.count > 0) {
      await upsertJurisdictionStatOnAssign(manager, surveyId, { grainKey, ...meta }, meta.count);
    }
  }
}

export async function incrementSurveyOnResponse(
  manager: EntityManager,
  ctx: SurveyIncrementContext
): Promise<void> {
  const col = SurveyResponseOptionService.legacyColumnForOption(
    ctx.isDesignatedSupporter,
    ctx.category
  );
  const statDate = statDateOnly(ctx.recordedAt);
  const isSupporter = ctx.isDesignatedSupporter ? 1 : 0;

  await manager.query(
    `UPDATE survey_stats
     SET pending = GREATEST(pending - 1, 0),
         completed = completed + 1,
         ${col} = ${col} + 1
     WHERE surveyId = ?`,
    [ctx.surveyId]
  );

  await manager.query(
    `UPDATE survey_agent_stats
     SET pending = GREATEST(pending - 1, 0),
         completed = completed + 1,
         ${col} = ${col} + 1
     WHERE surveyId = ? AND agentId = ?`,
    [ctx.surveyId, ctx.agentId]
  );

  if (ctx.grainKey) {
    await manager.query(
      `UPDATE survey_jurisdiction_stats
       SET pending = GREATEST(pending - 1, 0),
           completed = completed + 1,
           ${col} = ${col} + 1
       WHERE surveyId = ? AND grainKey = ?`,
      [ctx.surveyId, ctx.grainKey]
    );
  }

  await manager.query(
    `INSERT INTO survey_response_option_stats (id, surveyId, optionId, count)
     VALUES (?, ?, ?, 1)
     ON DUPLICATE KEY UPDATE count = count + 1`,
    [uuidv4(), ctx.surveyId, ctx.optionId]
  );

  await manager.query(
    `INSERT INTO survey_daily_stats (id, surveyId, statDate, responsesRecorded, supportersRecorded)
     VALUES (?, ?, ?, 1, ?)
     ON DUPLICATE KEY UPDATE
       responsesRecorded = responsesRecorded + 1,
       supportersRecorded = supportersRecorded + ?`,
    [uuidv4(), ctx.surveyId, statDate, isSupporter, isSupporter]
  );
}

export function buildAssignmentGrain(
  pollingCenter: string,
  ward: string,
  constituency: string,
  county: string
): { grainKey: string; county: string; constituency: string; ward: string; pollingCenter: string } {
  const pc = pollingCenter?.trim() ?? '';
  const w = ward?.trim() ?? '';
  const c = constituency?.trim() ?? '';
  const countyNorm = county?.trim() ?? '';
  const grainKey = pc ? jurisdictionGrainKey(pc, w, c) : '';
  return {
    grainKey,
    county: countyNorm,
    constituency: c,
    ward: w,
    pollingCenter: pc,
  };
}
