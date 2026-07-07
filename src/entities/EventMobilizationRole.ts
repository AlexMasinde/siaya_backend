import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Event } from './Event';
import { User } from './User';

export enum EventMobilizationRoleType {
  COORDINATOR = 'coordinator',
  MOBILIZER = 'mobilizer',
}

@Entity('event_mobilization_roles')
@Index('uq_event_mobilization_roles_event_user', ['eventId', 'userId'], { unique: true })
@Index('idx_event_mobilization_roles_event_role', ['eventId', 'role'])
export class EventMobilizationRole {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  eventId: string;

  @ManyToOne(() => Event, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'eventId' })
  event: Event;

  @Column({ type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user: User;

  @Column({
    type: 'enum',
    enum: EventMobilizationRoleType,
  })
  role: EventMobilizationRoleType;

  @Column({ type: 'varchar', length: 255, nullable: true })
  assignedPollingCenter: string | null;

  @Column({ type: 'varchar', length: 255, default: '' })
  assignedWard: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  assignedConstituency: string;

  @Column({ type: 'uuid' })
  addedById: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'addedById' })
  addedBy: User;

  @CreateDateColumn()
  createdAt: Date;
}
