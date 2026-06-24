import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('survey_daily_stats')
@Index('uq_survey_daily_stats_survey_date', ['surveyId', 'statDate'], { unique: true })
export class SurveyDailyStat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  surveyId: string;

  @Column({ type: 'date' })
  statDate: Date;

  @Column({ type: 'int', unsigned: true, default: 0 })
  responsesRecorded: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  supportersRecorded: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
