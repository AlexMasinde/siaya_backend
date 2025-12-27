import {
  Entity,
  PrimaryGeneratedColumn,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { User } from './User';
import { Event } from './Event';
import { CheckInLog } from './CheckInLog';

@Entity('participants')
export class Participant {
  @PrimaryColumn({ type: 'varchar', length: 255 })
  id: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  idNumber: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string | null;

  @Column({ type: 'date', nullable: true })
  dateOfBirth: Date | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  sex: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  county: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  constituency: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  ward: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  phoneNumber: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  pollingCenter: string | null;



  @Column({ type: 'varchar', length: 255, nullable: true })
  group: string | null;

  @Column({ type: 'uuid', nullable: true })
  eventId: string | null;

  @ManyToOne(() => Event, (event) => event.participants, { nullable: true })
  @JoinColumn({ name: 'eventId' })
  event: Event | null;

  @Column({ type: 'boolean', default: false })
  isRegisteredVoter: boolean;

  @Column({ type: 'boolean', default: false })
  isInvited: boolean;

  @OneToMany(() => CheckInLog, (checkInLog) => checkInLog.participant)
  checkInLogs: CheckInLog[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}

