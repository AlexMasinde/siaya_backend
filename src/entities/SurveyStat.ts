import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('survey_stats')
@Index('uq_survey_stats_survey', ['surveyId'], { unique: true })
export class SurveyStat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  surveyId: string;

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
