import { AppDataSource } from '../config/database';
import { PollingCenter } from '../entities/PollingCenter';
import { Event, EventScopeType } from '../entities/Event';

export class JurisdictionService {
  static async getCounties(): Promise<{ name: string; code: string }[]> {
    const repo = AppDataSource.getRepository(PollingCenter);
    const rows = await repo
      .createQueryBuilder('pc')
      .select('pc.countyName', 'name')
      .addSelect('MIN(pc.countyCode)', 'code')
      .groupBy('pc.countyName')
      .orderBy('pc.countyName', 'ASC')
      .getRawMany();

    return rows.map((r) => ({ name: r.name, code: r.code }));
  }

  static async getConstituencies(county: string): Promise<{ name: string; code: string }[]> {
    const repo = AppDataSource.getRepository(PollingCenter);
    const rows = await repo
      .createQueryBuilder('pc')
      .select('pc.constituencyName', 'name')
      .addSelect('MIN(pc.constituencyCode)', 'code')
      .where('pc.countyName = :county', { county })
      .groupBy('pc.constituencyName')
      .orderBy('pc.constituencyName', 'ASC')
      .getRawMany();

    return rows.map((r) => ({ name: r.name, code: r.code }));
  }

  static async getWards(
    constituency: string,
    county?: string
  ): Promise<{ name: string; code: string }[]> {
    const repo = AppDataSource.getRepository(PollingCenter);
    const qb = repo
      .createQueryBuilder('pc')
      .select('pc.wardName', 'name')
      .addSelect('MIN(pc.wardCode)', 'code')
      .where('pc.constituencyName = :constituency', { constituency })
      .groupBy('pc.wardName')
      .orderBy('pc.wardName', 'ASC');

    if (county) {
      qb.andWhere('pc.countyName = :county', { county });
    }

    const rows = await qb.getRawMany();
    return rows.map((r) => ({ name: r.name, code: r.code }));
  }

  static async getPollingCenters(
    constituency: string,
    ward: string
  ): Promise<
    { id: number; name: string; code: string; registeredVoters: number; ward: string; constituency: string }[]
  > {
    const repo = AppDataSource.getRepository(PollingCenter);
    const centers = await repo.find({
      where: { constituencyName: constituency, wardName: ward },
      order: { name: 'ASC' },
    });

    return centers.map((pc) => ({
      id: pc.id,
      name: pc.name,
      code: pc.code,
      registeredVoters: pc.registeredVoters,
      ward: pc.wardName,
      constituency: pc.constituencyName,
    }));
  }

  static async getRegisteredVotersInScope(event: Event): Promise<number | null> {
    if (!event.scopeType) {
      return null;
    }

    const repo = AppDataSource.getRepository(PollingCenter);

    if (event.scopeType === EventScopeType.POLLING_CENTER) {
      if (event.pollingCenterId) {
        const center = await repo.findOne({ where: { id: event.pollingCenterId } });
        return center?.registeredVoters ?? null;
      }
      return null;
    }

    const qb = repo.createQueryBuilder('pc').select('SUM(pc.registeredVoters)', 'total');

    switch (event.scopeType) {
      case EventScopeType.COUNTY:
        if (!event.county) return null;
        qb.where('pc.countyName = :county', { county: event.county });
        break;
      case EventScopeType.CONSTITUENCY:
        if (!event.constituency) return null;
        qb.where('pc.constituencyName = :constituency', { constituency: event.constituency });
        break;
      case EventScopeType.WARD:
        if (!event.ward || !event.constituency) return null;
        qb.where('pc.wardName = :ward AND pc.constituencyName = :constituency', {
          ward: event.ward,
          constituency: event.constituency,
        });
        break;
      default:
        return null;
    }

    const result = await qb.getRawOne();
    return result?.total != null ? parseInt(result.total, 10) : 0;
  }

  static async findByComposite(
    name: string,
    ward: string,
    constituency: string
  ): Promise<PollingCenter | null> {
    const repo = AppDataSource.getRepository(PollingCenter);
    return repo
      .createQueryBuilder('pc')
      .where('UPPER(TRIM(pc.name)) = UPPER(TRIM(:name))', { name })
      .andWhere('UPPER(TRIM(pc.wardName)) = UPPER(TRIM(:ward))', { ward })
      .andWhere('UPPER(TRIM(pc.constituencyName)) = UPPER(TRIM(:constituency))', { constituency })
      .getOne();
  }

  static async getRegisteredVotersMap(
    keys: { name: string; ward: string; constituency: string }[]
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (keys.length === 0) return map;

    const repo = AppDataSource.getRepository(PollingCenter);

    for (const key of keys) {
      const compositeKey = `${key.name}|${key.ward}|${key.constituency}`.toUpperCase();
      if (map.has(compositeKey)) continue;

      const center = await this.findByComposite(key.name, key.ward, key.constituency);
      if (center) {
        map.set(compositeKey, center.registeredVoters);
      }
    }

    return map;
  }
}
