import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Survey } from './Survey';
import { User } from './User';
import { SurveyResponseOption } from './SurveyResponseOption';

export enum SurveyAssignmentStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
}

export enum SurveyResponseType {
  SUPPORTER = 'supporter',
  NOT_SUPPORTER = 'not_supporter',
  UNDECIDED = 'undecided',
  NOT_FOUND = 'not_found',
}

@Entity('survey_assignments')
@Index('uq_survey_assignments_survey_participant', ['surveyId', 'participantId'], { unique: true })
@Index('idx_survey_assignments_queue', ['surveyId', 'agentId', 'status'])
@Index('idx_survey_assignments_survey_status', ['surveyId', 'status'])
export class SurveyAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  surveyId: string;

  @ManyToOne(() => Survey, (survey) => survey.assignments, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'surveyId' })
  survey: Survey;

  @Column({ type: 'varchar', length: 255 })
  participantId: string;

  @Column({ type: 'uuid' })
  agentId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'agentId' })
  agent: User;

  @Column({ type: 'varchar', length: 255, nullable: true })
  participantName: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phoneNumber: string | null;

  @Column({ type: 'varchar', length: 255, default: '' })
  county: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  constituency: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  ward: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  pollingCenter: string;

  @Column({ type: 'char', length: 64, default: '' })
  grainKey: string;

  @Column({
    type: 'enum',
    enum: SurveyAssignmentStatus,
    default: SurveyAssignmentStatus.PENDING,
  })
  status: SurveyAssignmentStatus;

  @Column({
    type: 'enum',
    enum: SurveyResponseType,
    nullable: true,
  })
  response: SurveyResponseType | null;

  @Column({ type: 'uuid', nullable: true })
  responseOptionId: string | null;

  @ManyToOne(() => SurveyResponseOption, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'responseOptionId' })
  responseOption: SurveyResponseOption | null;

  @Column({ type: 'uuid', nullable: true })
  recordedById: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'recordedById' })
  recordedBy: User | null;

  @Column({ type: 'timestamp', nullable: true })
  recordedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
