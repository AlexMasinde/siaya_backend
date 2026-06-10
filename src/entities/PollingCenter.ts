import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * Manual import from polling_center_list_.xlsx (sheet "Polling Center"):
 * Polling Center Code → code | County/Constituency/Ward Code → *Code columns
 * County/Constituency/Ward Name → *Name columns | Polling Center Name → name
 * Registered Voters → registeredVoters (skip Sr and ID columns)
 */
@Entity('polling_centers')
@Index('uq_polling_centers_code', ['code'], { unique: true })
@Index('idx_pc_ward_constituency', ['wardName', 'constituencyName'])
@Index('idx_pc_name_lookup', ['name', 'wardName', 'constituencyName'])
export class PollingCenter {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 20 })
  code: string;

  @Column({ type: 'varchar', length: 10 })
  countyCode: string;

  @Column({ type: 'varchar', length: 10 })
  constituencyCode: string;

  @Column({ type: 'varchar', length: 10 })
  wardCode: string;

  @Column({ type: 'varchar', length: 100 })
  countyName: string;

  @Column({ type: 'varchar', length: 100 })
  constituencyName: string;

  @Column({ type: 'varchar', length: 100 })
  wardName: string;

  @Column({ type: 'varchar', length: 255 })
  name: string;

  @Column({ type: 'int', unsigned: true })
  registeredVoters: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
