import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Pre-aggregated mobilization by field agent and polling center (field dashboard).
 */
@Entity('event_agent_stats')
@Index('uq_event_agent_stats_grain', ['eventId', 'userId', 'grainKey'], { unique: true })
@Index('idx_event_agent_stats_event_user', ['eventId', 'userId'])
export class EventAgentStat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  eventId: string;

  @Column({ type: 'uuid' })
  userId: string;

  @Column({ type: 'char', length: 64 })
  grainKey: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  pollingCenter: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  ward: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  constituency: string;

  @Column({ type: 'int', unsigned: true, default: 0 })
  uniqueMobilized: number;

  @Column({ type: 'int', unsigned: true, default: 0 })
  checkInCount: number;

  @Column({ type: 'timestamp', nullable: true })
  lastMobilizedAt: Date | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
