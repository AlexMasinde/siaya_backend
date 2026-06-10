import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  ManyToMany,
  JoinColumn,
} from 'typeorm';
import { User } from './User';
import { Participant } from './Participant';
import { CheckInLog } from './CheckInLog';
import { PollingCenter } from './PollingCenter';

export enum EventScopeType {
  COUNTY = 'county',
  CONSTITUENCY = 'constituency',
  WARD = 'ward',
  POLLING_CENTER = 'polling_center',
}

@Entity('events')
export class Event {
  @PrimaryGeneratedColumn('uuid')
  eventId: string;

  @Column({ type: 'varchar', length: 255 })
  eventName: string;

  @Column({ type: 'varchar', length: 255, nullable: true })
  location: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  county: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  constituency: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  ward: string | null;

  @Column({
    type: 'enum',
    enum: EventScopeType,
    nullable: true,
  })
  scopeType: EventScopeType | null;

  @Column({ type: 'int', nullable: true })
  pollingCenterId: number | null;

  @ManyToOne(() => PollingCenter, { nullable: true })
  @JoinColumn({ name: 'pollingCenterId' })
  pollingCenter: PollingCenter | null;

  @Column({ type: 'date', nullable: true })
  date: Date | null;

  @Column({ type: 'uuid' })
  createdById: string;

  @ManyToOne(() => User, (user) => user.events)
  @JoinColumn({ name: 'createdById' })
  createdBy: User;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => Participant, (participant) => participant.event)
  participants: Participant[];

  @ManyToMany(() => User, (user) => user.assignedEvents)
  assignedUsers: User[];

  @OneToMany(() => CheckInLog, (checkInLog) => checkInLog.event)
  checkInLogs: CheckInLog[];
}

