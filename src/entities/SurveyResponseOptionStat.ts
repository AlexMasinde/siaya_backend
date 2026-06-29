import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('survey_response_option_stats')
@Index('uq_survey_response_option_stats', ['surveyId', 'optionId'], { unique: true })
export class SurveyResponseOptionStat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  surveyId: string;

  @Column({ type: 'uuid' })
  optionId: string;

  @Column({ type: 'int', unsigned: true, default: 0 })
  count: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
