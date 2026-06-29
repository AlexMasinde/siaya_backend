import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Survey } from './Survey';

/** Roll-up bucket for headline KPIs and support-rate math. */
export enum SurveyResponseCategory {
  SUPPORTER = 'supporter',
  OPPOSITION = 'opposition',
  NEUTRAL = 'neutral',
  UNREACHABLE = 'unreachable',
  RELOCATED = 'relocated',
  DECLINED = 'declined',
  WITHHELD = 'withheld',
}

@Entity('survey_response_options')
@Index('uq_survey_response_options_survey_code', ['surveyId', 'code'], { unique: true })
@Index('idx_survey_response_options_survey', ['surveyId'])
export class SurveyResponseOption {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  surveyId: string;

  @ManyToOne(() => Survey, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'surveyId' })
  survey: Survey;

  /** Stable key, e.g. supporter, rival_party_uda */
  @Column({ type: 'varchar', length: 64 })
  code: string;

  @Column({ type: 'varchar', length: 255 })
  label: string;

  @Column({
    type: 'enum',
    enum: SurveyResponseCategory,
  })
  category: SurveyResponseCategory;

  @Column({ type: 'int', unsigned: true, default: 0 })
  sortOrder: number;

  @Column({ type: 'boolean', default: false })
  isSystem: boolean;

  /** When true, selecting this option counts toward confirmed supporters for the campaign. */
  @Column({ type: 'boolean', default: false })
  isDesignatedSupporter: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
