import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Pre-aggregated mobilization counts per jurisdiction grain (polling center level).
 * Backfilled from check_in_logs; incremented on each check-in (Phase 2+).
 */
@Entity('event_jurisdiction_stats')
@Index('uq_event_jurisdiction_stats_grain', ['eventId', 'grainKey'], { unique: true })
@Index('idx_event_jurisdiction_stats_event', ['eventId'])
export class EventJurisdictionStat {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  eventId: string;

  /** SHA-256 of pollingCenter|ward|constituency — used for unique index (avoids utf8mb4 key length limits). */
  @Column({ type: 'char', length: 64 })
  grainKey: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  county: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  constituency: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  ward: string;

  @Column({ type: 'varchar', length: 255, default: '' })
  pollingCenter: string;

  /** Distinct participants mobilized at this grain for the event. */
  @Column({ type: 'int', unsigned: true, default: 0 })
  uniqueMobilized: number;

  /** Total check-in log rows at this grain (includes repeat days). */
  @Column({ type: 'int', unsigned: true, default: 0 })
  checkInCount: number;

  @Column({ type: 'timestamp', nullable: true })
  lastMobilizedAt: Date | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
