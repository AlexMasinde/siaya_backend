import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Event } from './Event';
import { User } from './User';
import { SurveyAgent } from './SurveyAgent';
import { SurveyAssignment } from './SurveyAssignment';

export enum SurveyStatus {
  DRAFT = 'draft',
  BUILDING = 'building',
  ACTIVE = 'active',
  CLOSED = 'closed',
}

@Entity('surveys')
@Index('idx_surveys_event', ['eventId'])
export class Survey {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  eventId: string;

  @ManyToOne(() => Event, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'eventId' })
  event: Event;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({
    type: 'enum',
    enum: SurveyStatus,
    default: SurveyStatus.DRAFT,
  })
  status: SurveyStatus;

  @Column({ type: 'uuid' })
  createdById: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @Column({ type: 'timestamp', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  closedAt: Date | null;

  /** Mobilized count at snapshot (distinct participants). */
  @Column({ type: 'int', unsigned: true, default: 0 })
  mobilizedSnapshot: number;

  /** Mobilized with phone at snapshot. */
  @Column({ type: 'int', unsigned: true, default: 0 })
  callableTotal: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  noPhoneCount: number;

  /** When set, call list was built from outcomes of this prior survey. */
  @Column({ type: 'uuid', nullable: true })
  sourceSurveyId: string | null;

  @ManyToOne(() => Survey, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'sourceSurveyId' })
  sourceSurvey: Survey | null;

  /** Selected cohort keys used at launch (JSON array). Null = full mobilized snapshot. */
  @Column({ type: 'json', nullable: true })
  launchCohorts: string[] | null;

  @OneToMany(() => SurveyAgent, (agent) => agent.survey)
  agents: SurveyAgent[];

  @OneToMany(() => SurveyAssignment, (assignment) => assignment.survey)
  assignments: SurveyAssignment[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
