import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Pre-aggregated per-day mobilization for an event (event-wide row).
 * Jurisdiction drill-down daily rows can be added in a later table if needed.
 */
@Entity('event_daily_stats')
@Index('uq_event_daily_stats_event_date', ['eventId', 'statDate'], { unique: true })
@Index('idx_event_daily_stats_event', ['eventId'])
export class EventDailyStat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  eventId: string;

  @Column({ type: 'date' })
  statDate: Date;

  /** Check-in logs on this date for the event. */
  @Column({ type: 'int', unsigned: true, default: 0 })
  checkInCount: number;

  /** Distinct participants mobilized on this date. */
  @Column({ type: 'int', unsigned: true, default: 0 })
  uniqueMobilized: number;

  @UpdateDateColumn()
  updatedAt: Date;
}
