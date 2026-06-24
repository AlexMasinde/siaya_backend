import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('survey_jurisdiction_stats')
@Index('uq_survey_jurisdiction_stats_grain', ['surveyId', 'grainKey'], { unique: true })
@Index('idx_survey_jurisdiction_stats_survey', ['surveyId'])
export class SurveyJurisdictionStat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  surveyId: string;

  @Column({ type: 'char', length: 64 })
  grainKey: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  county: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  constituency: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  ward: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  pollingCenter: string;

  @Column({ type: 'int', unsigned: true, default: 0 })
  pending: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  completed: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  supporter: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  notSupporter: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  undecided: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  notFound: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  relocated: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  declined: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  withheld: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
