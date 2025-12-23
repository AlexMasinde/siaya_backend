import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Participant } from './Participant';
import { User } from './User';
import { Event } from './Event';

@Entity('check_in_logs')
@Index(['participantId', 'eventId', 'checkInDate'], { unique: true })
export class CheckInLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  participantId: string;

  @ManyToOne(() => Participant, (participant) => participant.checkInLogs, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'participantId' })
  participant: Participant;

  @Column({ type: 'uuid' })
  eventId: string;

  @ManyToOne(() => Event, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'eventId' })
  event: Event;

  @Column({ type: 'uuid', nullable: true })
  checkedInById: string | null;

  @ManyToOne(() => User, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'checkedInById' })
  checkedInBy: User | null;

  @Column({ type: 'date' })
  checkInDate: Date; // Date only (for reporting by date)

  @Column({ type: 'timestamp' })
  checkedInAt: Date; // Full timestamp

  @CreateDateColumn()
  createdAt: Date;
}

