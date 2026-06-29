import { EntityManager } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import {
  SurveyResponseCategory,
  SurveyResponseOption,
} from '../entities/SurveyResponseOption';
import { Survey, SurveyStatus } from '../entities/Survey';
import { AppDataSource } from '../config/database';

export const SURVEY_RESPONSE_CATEGORY_LABELS: Record<SurveyResponseCategory, string> = {
  [SurveyResponseCategory.SUPPORTER]: 'Supporter',
  [SurveyResponseCategory.OPPOSITION]: 'Opposition / base erosion',
  [SurveyResponseCategory.NEUTRAL]: 'Neutral / undecided',
  [SurveyResponseCategory.UNREACHABLE]: 'Unreachable',
  [SurveyResponseCategory.RELOCATED]: 'Relocated / out of area',
  [SurveyResponseCategory.DECLINED]: 'Declined / not interested',
  [SurveyResponseCategory.WITHHELD]: 'Withheld / will not disclose',
};

function slugifyCode(label: string): string {
  const base = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  return base || `option_${Date.now()}`;
}

export class SurveyResponseOptionService {
  static async listForSurvey(surveyId: string): Promise<SurveyResponseOption[]> {
    return AppDataSource.getRepository(SurveyResponseOption).find({
      where: { surveyId },
      order: { sortOrder: 'ASC', label: 'ASC' },
    });
  }

  static async validateSurveyCanStart(surveyId: string): Promise<void> {
    const options = await this.listForSurvey(surveyId);
    if (options.length === 0) {
      throw new Error('Add at least one response option before starting the survey');
    }
    const designated = options.filter((o) => o.isDesignatedSupporter);
    if (designated.length !== 1) {
      throw new Error('Mark exactly one response option as supporting your campaign before starting');
    }
  }

  static async getById(optionId: string, surveyId: string): Promise<SurveyResponseOption | null> {
    return AppDataSource.getRepository(SurveyResponseOption).findOne({
      where: { id: optionId, surveyId },
    });
  }

  static async getByCode(code: string, surveyId: string): Promise<SurveyResponseOption | null> {
    return AppDataSource.getRepository(SurveyResponseOption).findOne({
      where: { code, surveyId },
    });
  }

  static formatOption(option: SurveyResponseOption) {
    return {
      id: option.id,
      code: option.code,
      label: option.label,
      category: option.category,
      sortOrder: option.sortOrder,
      isSystem: option.isSystem,
      is_designated_supporter: option.isDesignatedSupporter,
    };
  }

  private static async clearDesignatedSupporter(
    manager: EntityManager,
    surveyId: string,
    exceptOptionId?: string
  ): Promise<void> {
    const qb = manager
      .createQueryBuilder()
      .update(SurveyResponseOption)
      .set({ isDesignatedSupporter: false })
      .where('surveyId = :surveyId', { surveyId })
      .andWhere('isDesignatedSupporter = :flag', { flag: true });

    if (exceptOptionId) {
      qb.andWhere('id != :exceptOptionId', { exceptOptionId });
    }
    await qb.execute();
  }

  static async addOption(
    surveyId: string,
    input: {
      label: string;
      category: SurveyResponseCategory;
      isDesignatedSupporter?: boolean;
    }
  ): Promise<SurveyResponseOption> {
    const survey = await AppDataSource.getRepository(Survey).findOne({ where: { id: surveyId } });
    if (!survey) throw new Error('Survey not found');
    if (survey.status !== SurveyStatus.DRAFT) {
      throw new Error('Response options can only be changed on draft surveys');
    }

    const label = input.label?.trim();
    if (!label) throw new Error('Label is required');

    return AppDataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurveyResponseOption);
      const maxSort = await repo
        .createQueryBuilder('o')
        .select('MAX(o.sortOrder)', 'max')
        .where('o.surveyId = :surveyId', { surveyId })
        .getRawOne<{ max: string | null }>();

      let code = slugifyCode(label);
      const collision = await repo.findOne({ where: { surveyId, code } });
      if (collision) code = `${code}_${uuidv4().slice(0, 8)}`;

      const designate = !!input.isDesignatedSupporter;
      if (designate) {
        await this.clearDesignatedSupporter(manager, surveyId);
      }

      const option = repo.create({
        surveyId,
        code,
        label,
        category: designate ? SurveyResponseCategory.SUPPORTER : input.category,
        sortOrder: Number(maxSort?.max ?? -1) + 1,
        isSystem: false,
        isDesignatedSupporter: designate,
      });
      return repo.save(option);
    });
  }

  static async setDesignatedSupporter(surveyId: string, optionId: string): Promise<SurveyResponseOption> {
    const survey = await AppDataSource.getRepository(Survey).findOne({ where: { id: surveyId } });
    if (!survey) throw new Error('Survey not found');
    if (survey.status !== SurveyStatus.DRAFT) {
      throw new Error('Response options can only be changed on draft surveys');
    }

    return AppDataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SurveyResponseOption);
      const option = await repo.findOne({ where: { id: optionId, surveyId } });
      if (!option) throw new Error('Response option not found');

      await this.clearDesignatedSupporter(manager, surveyId, optionId);
      option.isDesignatedSupporter = true;
      option.category = SurveyResponseCategory.SUPPORTER;
      return repo.save(option);
    });
  }

  static async deleteOption(surveyId: string, optionId: string): Promise<void> {
    const survey = await AppDataSource.getRepository(Survey).findOne({ where: { id: surveyId } });
    if (!survey) throw new Error('Survey not found');
    if (survey.status !== SurveyStatus.DRAFT) {
      throw new Error('Response options can only be changed on draft surveys');
    }

    const repo = AppDataSource.getRepository(SurveyResponseOption);
    const option = await repo.findOne({ where: { id: optionId, surveyId } });
    if (!option) throw new Error('Response option not found');

    await repo.delete(optionId);
  }

  static legacyColumnForOption(
    isDesignatedSupporter: boolean,
    category: SurveyResponseCategory
  ): string {
    if (isDesignatedSupporter) return 'supporter';
    return this.categoryToLegacyColumn(category);
  }

  static categoryToLegacyColumn(category: SurveyResponseCategory): string {
    switch (category) {
      case SurveyResponseCategory.SUPPORTER:
        return 'supporter';
      case SurveyResponseCategory.OPPOSITION:
        return 'notSupporter';
      case SurveyResponseCategory.NEUTRAL:
        return 'undecided';
      case SurveyResponseCategory.UNREACHABLE:
        return 'notFound';
      case SurveyResponseCategory.RELOCATED:
        return 'relocated';
      case SurveyResponseCategory.DECLINED:
        return 'declined';
      case SurveyResponseCategory.WITHHELD:
        return 'withheld';
      default:
        return 'undecided';
    }
  }
}
