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
import { Event } from './Event';
import { User } from './User';
import { Participant } from './Participant';

@Entity('event_mobilization_assignments')
@Index('uq_event_mobilization_assignments_event_participant', ['eventId', 'participantId'], {
  unique: true,
})
@Index('idx_event_mobilization_assignments_mobilizer', ['eventId', 'mobilizerUserId'])
@Index('idx_event_mobilization_assignments_voted', ['eventId', 'mobilizerUserId', 'votedAt'])
export class EventMobilizationAssignment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  eventId: string;

  @ManyToOne(() => Event, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'eventId' })
  event: Event;

  @Column({ type: 'varchar', length: 255 })
  participantId: string;

  @ManyToOne(() => Participant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'participantId' })
  participant: Participant;

  @Column({ type: 'uuid' })
  mobilizerUserId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'mobilizerUserId' })
  mobilizer: User;

  @Column({ type: 'varchar', length: 255, nullable: true })
  participantName: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phoneNumber: string | null;

  @Column({ type: 'varchar', length: 255, default: '' })
  ward: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  constituency: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  pollingCenter: string;

  @Column({ type: 'uuid' })
  assignedById: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'assignedById' })
  assignedBy: User;

  @Column({ type: 'timestamp' })
  assignedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  votedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  markedById: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({ name: 'markedById' })
  markedBy: User | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
