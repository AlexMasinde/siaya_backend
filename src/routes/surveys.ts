import { Router, Response } from 'express';
import { AppDataSource } from '../config/database';
import { User, UserRole } from '../entities/User';
import { Survey, SurveyStatus } from '../entities/Survey';
import { SurveyAgent } from '../entities/SurveyAgent';
import {
  SurveyAssignment,
  SurveyAssignmentStatus,
  SurveyResponseType,
} from '../entities/SurveyAssignment';
import { SurveyResponseCategory } from '../entities/SurveyResponseOption';
import { authenticate, AuthRequest, requireAdmin } from '../middleware/auth';
import { closeSurvey, launchSurvey, previewLaunchCohorts, setSurveyAgents } from '../services/SurveyLaunchService';
import {
  parseLaunchCohorts,
  SURVEY_LAUNCH_COHORT_LABELS,
  SURVEY_LAUNCH_COHORTS,
} from '../services/SurveyCohortService';
import { SurveyReadService } from '../services/SurveyReadService';
import { SurveyResponseOptionService } from '../services/SurveyResponseOptionService';
import { incrementSurveyOnResponse } from '../services/SurveyIncrementService';
import logger from '../config/logger';

const router = Router();

const VALID_CATEGORIES = new Set<string>([
  SurveyResponseCategory.OPPOSITION,
  SurveyResponseCategory.NEUTRAL,
  SurveyResponseCategory.UNREACHABLE,
  SurveyResponseCategory.RELOCATED,
  SurveyResponseCategory.DECLINED,
  SurveyResponseCategory.WITHHELD,
]);

function isAdmin(user: User): boolean {
  const role = user.role as string;
  return role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN || role === 'admin' || role === 'super_admin';
}

async function getSurveyOr404(surveyId: string): Promise<Survey | null> {
  return AppDataSource.getRepository(Survey).findOne({
    where: { id: surveyId },
    relations: ['agents', 'agents.user'],
  });
}

async function assertSurveyAgentAccess(survey: Survey, userId: string): Promise<boolean> {
  return survey.agents.some((agent) => agent.userId === userId);
}

function formatSurveyListItem(payload: Awaited<ReturnType<typeof SurveyReadService.getSurveyWithStats>>) {
  if (!payload) return null;
  return payload;
}

function formatSurveyAgent(agent: SurveyAgent) {
  return {
    id: agent.id,
    userId: agent.userId,
    name: agent.user?.name ?? '',
    email: agent.user?.email ?? '',
  };
}

function legacyResponseFromCode(code: string): SurveyResponseType | null {
  const values = Object.values(SurveyResponseType) as string[];
  return values.includes(code) ? (code as SurveyResponseType) : null;
}

async function resolveResponseOption(
  surveyId: string,
  body: { responseOptionId?: string; response?: string }
) {
  if (body.responseOptionId) {
    return SurveyResponseOptionService.getById(body.responseOptionId, surveyId);
  }
  if (body.response && typeof body.response === 'string') {
    return SurveyResponseOptionService.getByCode(body.response.trim(), surveyId);
  }
  return null;
}

// Must be registered before /:surveyId
router.get(
  '/my/active',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const rows = await AppDataSource.getRepository(SurveyAgent)
        .createQueryBuilder('sa')
        .innerJoinAndSelect('sa.survey', 'survey')
        .innerJoinAndSelect('survey.event', 'event')
        .where('sa.userId = :userId', { userId: req.user!.id })
        .andWhere('survey.status IN (:...statuses)', {
          statuses: [SurveyStatus.ACTIVE, SurveyStatus.CLOSED],
        })
        .orderBy('survey.startedAt', 'DESC')
        .getMany();

      const surveys = [];
      for (const row of rows) {
        const payload = await SurveyReadService.getSurveyWithStats(row.surveyId);
        if (payload) {
          surveys.push({
            ...payload,
            eventName: row.survey.event?.eventName ?? '',
          });
        }
      }

      res.json({ message: 'Your surveys retrieved successfully', surveys });
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Get survey detail + stats
router.get(
  '/:surveyId',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { surveyId } = req.params;
      const survey = await getSurveyOr404(surveyId);
      if (!survey) {
        res.status(404).json({ message: 'Survey not found' });
        return;
      }

      const isAgent = await assertSurveyAgentAccess(survey, req.user!.id);
      if (!isAdmin(req.user!) && !isAgent) {
        res.status(403).json({ message: 'Access denied' });
        return;
      }

      const payload = await SurveyReadService.getSurveyWithStats(surveyId);
      const responseOptions = await SurveyResponseOptionService.listForSurvey(surveyId);
      res.json({
        message: 'Survey retrieved successfully',
        survey: payload,
        agents: survey.agents.map(formatSurveyAgent),
        responseOptions: responseOptions.map(SurveyResponseOptionService.formatOption),
      });
    } catch (error) {
      logger.error('Get survey error:', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Set survey agents (draft only)
router.post(
  '/:surveyId/agents',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { surveyId } = req.params;
      const { userIds } = req.body;

      if (!Array.isArray(userIds) || userIds.length === 0) {
        res.status(400).json({ message: 'userIds array is required' });
        return;
      }

      await setSurveyAgents(surveyId, userIds);

      const survey = await getSurveyOr404(surveyId);
      res.json({
        message: 'Survey agents updated successfully',
        agents: survey?.agents.map(formatSurveyAgent) ?? [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      const status = message.includes('not found') ? 404 : message.includes('draft') ? 400 : 500;
      res.status(status).json({ message });
    }
  }
);

// Preview call list size before starting (admin)
router.get(
  '/:surveyId/launch-preview',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { surveyId } = req.params;
      const survey = await getSurveyOr404(surveyId);
      if (!survey) {
        res.status(404).json({ message: 'Survey not found' });
        return;
      }
      if (survey.status !== SurveyStatus.DRAFT) {
        res.status(400).json({ message: 'Launch preview is only available for draft surveys' });
        return;
      }

      const sourceSurveyId =
        typeof req.query.sourceSurveyId === 'string' && req.query.sourceSurveyId.trim()
          ? req.query.sourceSurveyId.trim()
          : null;
      const cohortParam = req.query.cohorts;
      const cohorts = Array.isArray(cohortParam)
        ? parseLaunchCohorts(cohortParam)
        : typeof cohortParam === 'string' && cohortParam.trim()
          ? parseLaunchCohorts(cohortParam.split(',').map((s) => s.trim()))
          : [];

      const preview = await previewLaunchCohorts(
        survey.eventId,
        surveyId,
        sourceSurveyId,
        cohorts
      );

      res.json({
        message: 'Launch preview retrieved successfully',
        preview,
        cohorts: SURVEY_LAUNCH_COHORTS.map((key) => ({
          key,
          label: SURVEY_LAUNCH_COHORT_LABELS[key],
        })),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      const status = message.includes('not found') ? 404 : 400;
      res.status(status).json({ message });
    }
  }
);

// Start survey — snapshot mobilized and distribute
router.post(
  '/:surveyId/start',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { surveyId } = req.params;
      const sourceSurveyId =
        typeof req.body?.sourceSurveyId === 'string' ? req.body.sourceSurveyId : null;
      const cohorts = parseLaunchCohorts(req.body?.cohorts);

      const survey = await launchSurvey(surveyId, { sourceSurveyId, cohorts });
      const payload = await SurveyReadService.getSurveyWithStats(survey.id);
      res.json({
        message: 'Survey started successfully',
        survey: formatSurveyListItem(payload),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      const status =
        message.includes('not found') ? 404 :
        message.includes('draft') || message.includes('agent') || message.includes('phone') ||
        message.includes('active') || message.includes('response option') || message.includes('supporting') ||
        message.includes('call group') || message.includes('previous survey') || message.includes('match') ? 400 :
        500;
      res.status(status).json({ message });
    }
  }
);

// Close survey
router.post(
  '/:surveyId/close',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { surveyId } = req.params;
      const survey = await closeSurvey(surveyId);
      const payload = await SurveyReadService.getSurveyWithStats(survey.id);
      res.json({
        message: 'Survey closed successfully',
        survey: formatSurveyListItem(payload),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      const status = message.includes('not found') ? 404 : message.includes('active') ? 400 : 500;
      res.status(status).json({ message });
    }
  }
);

// Response options (custom labels per survey)
router.get(
  '/:surveyId/response-options',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { surveyId } = req.params;
      const survey = await getSurveyOr404(surveyId);
      if (!survey) {
        res.status(404).json({ message: 'Survey not found' });
        return;
      }

      const isAgent = await assertSurveyAgentAccess(survey, req.user!.id);
      if (!isAdmin(req.user!) && !isAgent) {
        res.status(403).json({ message: 'Access denied' });
        return;
      }

      const options = await SurveyResponseOptionService.listForSurvey(surveyId);
      res.json({
        message: 'Response options retrieved successfully',
        options: options.map(SurveyResponseOptionService.formatOption),
      });
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

router.post(
  '/:surveyId/response-options',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { surveyId } = req.params;
      const { label, category, isDesignatedSupporter } = req.body;

      if (!label || typeof label !== 'string') {
        res.status(400).json({ message: 'Label is required' });
        return;
      }
      if (!isDesignatedSupporter && (!category || !VALID_CATEGORIES.has(category))) {
        res.status(400).json({
          message: 'Valid category is required: opposition, neutral, unreachable, relocated, declined, withheld (or mark as supporting your campaign)',
        });
        return;
      }

      const option = await SurveyResponseOptionService.addOption(surveyId, {
        label,
        category: (category as SurveyResponseCategory) || SurveyResponseCategory.NEUTRAL,
        isDesignatedSupporter: !!isDesignatedSupporter,
      });

      res.status(201).json({
        message: 'Response option added successfully',
        option: SurveyResponseOptionService.formatOption(option),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      const status = message.includes('not found') ? 404 : message.includes('draft') ? 400 : 500;
      res.status(status).json({ message });
    }
  }
);

router.patch(
  '/:surveyId/response-options/:optionId/designate',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const option = await SurveyResponseOptionService.setDesignatedSupporter(
        req.params.surveyId,
        req.params.optionId
      );
      res.json({
        message: 'Supporter option updated successfully',
        option: SurveyResponseOptionService.formatOption(option),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      const status = message.includes('not found') ? 404 : message.includes('draft') ? 400 : 500;
      res.status(status).json({ message });
    }
  }
);

router.delete(
  '/:surveyId/response-options/:optionId',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      await SurveyResponseOptionService.deleteOption(
        req.params.surveyId,
        req.params.optionId
      );
      res.json({ message: 'Response option removed successfully' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      const status =
        message.includes('not found') ? 404 :
        message.includes('draft') ? 400 :
        500;
      res.status(status).json({ message });
    }
  }
);

// Survey headline stats
router.get(
  '/:surveyId/stats',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const payload = await SurveyReadService.getSurveyWithStats(req.params.surveyId);
      if (!payload) {
        res.status(404).json({ message: 'Survey not found' });
        return;
      }
      res.json({ message: 'Survey stats retrieved successfully', ...payload });
    } catch (error) {
      logger.error('Survey stats error:', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

router.get(
  '/:surveyId/agent-stats',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const agents = await SurveyReadService.getAgentStats(req.params.surveyId);
      res.json({ message: 'Survey agent stats retrieved successfully', agents });
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

router.get(
  '/:surveyId/supporter-breakdown',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const survey = await getSurveyOr404(req.params.surveyId);
      if (!survey) {
        res.status(404).json({ message: 'Survey not found' });
        return;
      }
      const breakdown = await SurveyReadService.getSupporterJurisdictionBreakdown(
        survey.eventId,
        survey.id
      );
      res.json({
        message: 'Supporter jurisdiction breakdown retrieved successfully',
        breakdown,
      });
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

router.get(
  '/:surveyId/jurisdiction-stats',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const ward = typeof req.query.ward === 'string' ? req.query.ward : undefined;
      const jurisdictions = await SurveyReadService.getJurisdictionStats(req.params.surveyId, ward);
      res.json({ message: 'Survey jurisdiction stats retrieved successfully', jurisdictions });
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

router.get(
  '/:surveyId/daily-stats',
  authenticate,
  requireAdmin,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const daily = await SurveyReadService.getDailyStats(req.params.surveyId);
      res.json({ message: 'Survey daily stats retrieved successfully', daily });
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Call agent queue
router.get(
  '/:surveyId/my-assignments',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { surveyId } = req.params;
      const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
      const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
      const skip = (page - 1) * limit;
      const status =
        req.query.status === 'completed'
          ? SurveyAssignmentStatus.COMPLETED
          : SurveyAssignmentStatus.PENDING;
      const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';

      const survey = await getSurveyOr404(surveyId);
      if (!survey) {
        res.status(404).json({ message: 'Survey not found' });
        return;
      }

      if (survey.status !== SurveyStatus.ACTIVE && survey.status !== SurveyStatus.CLOSED) {
        res.status(400).json({ message: 'Survey is not available for calling yet' });
        return;
      }

      const isAgent = await assertSurveyAgentAccess(survey, req.user!.id);
      if (!isAdmin(req.user!) && !isAgent) {
        res.status(403).json({ message: 'Access denied' });
        return;
      }

      const agentId = isAdmin(req.user!) && typeof req.query.agentId === 'string'
        ? req.query.agentId
        : req.user!.id;

      const assignmentRepo = AppDataSource.getRepository(SurveyAssignment);
      const qb = assignmentRepo
        .createQueryBuilder('a')
        .where('a.surveyId = :surveyId', { surveyId })
        .andWhere('a.agentId = :agentId', { agentId })
        .andWhere('a.status = :status', { status });

      if (search) {
        qb.andWhere(
          '(a.participantName LIKE :search OR a.phoneNumber LIKE :search)',
          { search: `%${search}%` }
        );
      }

      const total = await qb.getCount();
      const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

      const assignments = await qb
        .leftJoinAndSelect('a.responseOption', 'responseOption')
        .orderBy('a.createdAt', 'ASC')
        .skip(skip)
        .take(limit)
        .getMany();

      const agentStat = await AppDataSource.query(
        `SELECT assigned, pending, completed, supporter, notSupporter, undecided, notFound, relocated, declined, withheld
         FROM survey_agent_stats WHERE surveyId = ? AND agentId = ? LIMIT 1`,
        [surveyId, agentId]
      );

      res.json({
        message: 'Assignments retrieved successfully',
        assignments: assignments.map((row) => ({
          id: row.id,
          participantId: row.participantId,
          participantName: row.participantName,
          phoneNumber: row.phoneNumber,
          ward: row.ward,
          constituency: row.constituency,
          pollingCenter: row.pollingCenter,
          status: row.status,
          response: row.response,
          responseOptionId: row.responseOptionId,
          responseLabel: row.responseOption?.label ?? (row.response ? row.response : null),
          responseCategory: row.responseOption?.category ?? null,
          recordedAt: row.recordedAt?.toISOString() ?? null,
        })),
        agentProgress: agentStat[0]
          ? {
              assigned: Number(agentStat[0].assigned) || 0,
              pending: Number(agentStat[0].pending) || 0,
              completed: Number(agentStat[0].completed) || 0,
              supporter: Number(agentStat[0].supporter) || 0,
              not_supporter: Number(agentStat[0].notSupporter) || 0,
              undecided: Number(agentStat[0].undecided) || 0,
              not_found: Number(agentStat[0].notFound) || 0,
              relocated: Number(agentStat[0].relocated) || 0,
              declined: Number(agentStat[0].declined) || 0,
              withheld: Number(agentStat[0].withheld) || 0,
            }
          : null,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPreviousPage: page > 1,
        },
      });
    } catch (error) {
      logger.error('Get assignments error:', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: 'Internal server error' });
    }
  }
);

// Record call response
router.patch(
  '/:surveyId/assignments/:assignmentId',
  authenticate,
  async (req: AuthRequest, res: Response): Promise<void> => {
    try {
      const { surveyId, assignmentId } = req.params;
      const { response, responseOptionId } = req.body;

      const option = await resolveResponseOption(surveyId, { responseOptionId, response });
      if (!option) {
        res.status(400).json({
          message: 'Valid responseOptionId or response code is required',
        });
        return;
      }

      const survey = await getSurveyOr404(surveyId);
      if (!survey) {
        res.status(404).json({ message: 'Survey not found' });
        return;
      }

      if (survey.status !== SurveyStatus.ACTIVE) {
        res.status(400).json({ message: 'Survey is not active' });
        return;
      }

      const isAgent = await assertSurveyAgentAccess(survey, req.user!.id);
      if (!isAdmin(req.user!) && !isAgent) {
        res.status(403).json({ message: 'Access denied' });
        return;
      }

      const assignmentRepo = AppDataSource.getRepository(SurveyAssignment);
      const assignment = await assignmentRepo.findOne({
        where: { id: assignmentId, surveyId },
      });

      if (!assignment) {
        res.status(404).json({ message: 'Assignment not found' });
        return;
      }

      if (!isAdmin(req.user!) && assignment.agentId !== req.user!.id) {
        res.status(403).json({ message: 'This assignment belongs to another agent' });
        return;
      }

      if (assignment.status === SurveyAssignmentStatus.COMPLETED) {
        res.status(400).json({ message: 'Response already recorded for this person' });
        return;
      }

      const recordedAt = new Date();
      const legacyResponse = legacyResponseFromCode(option.code);

      await AppDataSource.transaction(async (manager) => {
        const result = await manager.update(
          SurveyAssignment,
          { id: assignmentId, status: SurveyAssignmentStatus.PENDING },
          {
            status: SurveyAssignmentStatus.COMPLETED,
            response: legacyResponse,
            responseOptionId: option.id,
            recordedById: req.user!.id,
            recordedAt,
          }
        );

        if (!result.affected) {
          throw new Error('Assignment already completed');
        }

        await incrementSurveyOnResponse(manager, {
          surveyId,
          agentId: assignment.agentId,
          optionId: option.id,
          category: option.category,
          isDesignatedSupporter: option.isDesignatedSupporter,
          grainKey: assignment.grainKey,
          county: assignment.county,
          constituency: assignment.constituency,
          ward: assignment.ward,
          pollingCenter: assignment.pollingCenter,
          recordedAt,
        });
      });

      res.json({
        message: 'Response recorded successfully',
        assignment: {
          id: assignment.id,
          status: SurveyAssignmentStatus.COMPLETED,
          responseOptionId: option.id,
          responseLabel: option.label,
          responseCategory: option.category,
          recordedAt: recordedAt.toISOString(),
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal server error';
      const status = message.includes('already completed') ? 409 : 500;
      logger.error('Record survey response error:', { error: message });
      res.status(status).json({ message: status === 500 ? 'Internal server error' : message });
    }
  }
);

export default router;
