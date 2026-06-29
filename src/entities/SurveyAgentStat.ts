import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('survey_agent_stats')
@Index('uq_survey_agent_stats_survey_agent', ['surveyId', 'agentId'], { unique: true })
export class SurveyAgentStat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  surveyId: string;

  @Column({ type: 'uuid' })
  agentId: string;

  @Column({ type: 'int', unsigned: true, default: 0 })
  assigned: number;

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
