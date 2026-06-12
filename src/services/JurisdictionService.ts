import { SelectQueryBuilder } from 'typeorm';
import { AppDataSource } from '../config/database';
import { PollingCenter } from '../entities/PollingCenter';
import { Event, EventScopeType } from '../entities/Event';
import { Participant } from '../entities/Participant';

export interface DrillDownFilter {
  county?: string;
  constituency?: string;
  ward?: string;
  pollingCenter?: string;
}

export class JurisdictionService {
  static parseDrillDownFilter(query: Record<string, unknown>): DrillDownFilter {
    const pick = (key: string) => {
      const v = query[key];
      if (typeof v === 'string' && v.trim()) return v.trim();
      return undefined;
    };
    return {
      county: pick('county'),
      constituency: pick('constituency'),
      ward: pick('ward'),
      pollingCenter: pick('pollingCenter'),
    };
  }

  static hasDrillDownFilter(filter: DrillDownFilter): boolean {
    return !!(filter.county || filter.constituency || filter.ward || filter.pollingCenter);
  }

  static drillDownFilterLabel(filter: DrillDownFilter): string | null {
    const parts: string[] = [];
    if (filter.county) parts.push(filter.county);
    if (filter.constituency) parts.push(filter.constituency);
    if (filter.ward) parts.push(filter.ward);
    if (filter.pollingCenter) parts.push(filter.pollingCenter);
    return parts.length ? parts.join(' · ') : null;
  }

  static drillDownDefaultsFromEvent(event: Event): DrillDownFilter {
    const filter: DrillDownFilter = {};
    if (event.county) filter.county = event.county;
    if (event.constituency) filter.constituency = event.constituency;
    if (event.ward) filter.ward = event.ward;
    if (event.scopeType === EventScopeType.POLLING_CENTER && event.pollingCenter?.name) {
      filter.pollingCenter = event.pollingCenter.name;
    }
    return filter;
  }

  static filterCentersByDrillDown(
    centers: PollingCenter[],
    filter: DrillDownFilter
  ): PollingCenter[] {
    if (!JurisdictionService.hasDrillDownFilter(filter)) return centers;
    return centers.filter((pc) => {
      if (filter.county && pc.countyName !== filter.county) return false;
      if (filter.constituency && pc.constituencyName !== filter.constituency) return false;
      if (filter.ward && pc.wardName !== filter.ward) return false;
      if (filter.pollingCenter && pc.name !== filter.pollingCenter) return false;
      return true;
    });
  }

  static applyDrillDownToParticipantQuery(
    qb: SelectQueryBuilder<Participant>,
    filter: DrillDownFilter,
    alias = 'p'
  ): void {
    if (filter.county) {
      qb.andWhere(`${alias}.county = :ddCounty`, { ddCounty: filter.county });
    }
    if (filter.constituency) {
      qb.andWhere(`${alias}.constituency = :ddConstituency`, {
        ddConstituency: filter.constituency,
      });
    }
    if (filter.ward) {
      qb.andWhere(`${alias}.ward = :ddWard`, { ddWard: filter.ward });
    }
    if (filter.pollingCenter) {
      qb.andWhere(`${alias}.pollingCenter = :ddPc`, { ddPc: filter.pollingCenter });
    }
  }

  static matchesDrillDownParticipant(
    row: { county?: string; constituency?: string; ward?: string; pollingCenter?: string },
    filter: DrillDownFilter
  ): boolean {
    if (filter.county && row.county !== filter.county) return false;
    if (filter.constituency && row.constituency !== filter.constituency) return false;
    if (filter.ward && row.ward !== filter.ward) return false;
    if (filter.pollingCenter && row.pollingCenter !== filter.pollingCenter) return false;
    return true;
  }

  static getAnalysisLevelForDrillDown(
    filter: DrillDownFilter,
    eventScopeType: EventScopeType | null
  ): {
    level: 'county' | 'constituency' | 'ward' | 'polling_center';
    field: 'countyName' | 'constituencyName' | 'wardName' | null;
    label: string;
  } | null {
    if (filter.pollingCenter) {
      return { level: 'polling_center', field: null, label: 'Polling center' };
    }
    if (filter.ward) {
      return { level: 'polling_center', field: null, label: 'Polling center' };
    }
    if (filter.constituency) {
      return { level: 'ward', field: 'wardName', label: 'Ward' };
    }
    if (filter.county) {
      return { level: 'constituency', field: 'constituencyName', label: 'Constituency' };
    }
    return JurisdictionService.getChildJurisdictionLevel(eventScopeType);
  }

  static getRegisteredVotersFromCenters(centers: PollingCenter[]): number {
    return centers.reduce((sum, pc) => sum + pc.registeredVoters, 0);
  }

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

  static compositeKey(name: string, ward: string, constituency: string): string {
    return `${name}|${ward}|${constituency}`.toUpperCase().trim();
  }

  static getScopeLabel(event: Event): string | null {
    switch (event.scopeType) {
      case EventScopeType.POLLING_CENTER:
        return event.pollingCenter?.name ?? null;
      case EventScopeType.WARD:
        return event.ward && event.constituency
          ? `${event.ward} · ${event.constituency}`
          : event.ward ?? null;
      case EventScopeType.CONSTITUENCY:
        return event.constituency ?? null;
      case EventScopeType.COUNTY:
        return event.county ?? null;
      default:
        return null;
    }
  }

  static async getPollingCentersInEventScope(event: Event): Promise<PollingCenter[]> {
    if (!event.scopeType) return [];

    const repo = AppDataSource.getRepository(PollingCenter);

    if (event.scopeType === EventScopeType.POLLING_CENTER) {
      if (!event.pollingCenterId) return [];
      const center = await repo.findOne({ where: { id: event.pollingCenterId } });
      return center ? [center] : [];
    }

    const qb = repo
      .createQueryBuilder('pc')
      .orderBy('pc.constituencyName', 'ASC')
      .addOrderBy('pc.wardName', 'ASC')
      .addOrderBy('pc.name', 'ASC');

    switch (event.scopeType) {
      case EventScopeType.COUNTY:
        if (!event.county) return [];
        qb.where('pc.countyName = :county', { county: event.county });
        break;
      case EventScopeType.CONSTITUENCY:
        if (!event.constituency) return [];
        qb.where('pc.constituencyName = :constituency', { constituency: event.constituency });
        if (event.county) qb.andWhere('pc.countyName = :county', { county: event.county });
        break;
      case EventScopeType.WARD:
        if (!event.ward || !event.constituency) return [];
        qb.where('pc.wardName = :ward AND pc.constituencyName = :constituency', {
          ward: event.ward,
          constituency: event.constituency,
        });
        break;
      default:
        return [];
    }

    return qb.getMany();
  }

  static buildPollingCenterBreakdown(
    centersInScope: PollingCenter[],
    collectionByCenter: Map<string, number>
  ): Array<{
    name: string;
    pollingCenter: string;
    ward: string;
    constituency: string;
    county: string;
    code: string;
    count: number;
    registered_voters: number;
    ratio: string;
    coverage_percent: number | null;
  }> {
    return centersInScope.map((pc) => {
      const key = JurisdictionService.compositeKey(pc.name, pc.wardName, pc.constituencyName);
      const count = collectionByCenter.get(key) ?? 0;
      const registeredVoters = pc.registeredVoters;
      const displayName = pc.wardName ? `${pc.name} (${pc.wardName})` : pc.name;

      return {
        name: displayName,
        pollingCenter: pc.name,
        ward: pc.wardName,
        constituency: pc.constituencyName,
        county: pc.countyName,
        code: pc.code,
        count,
        registered_voters: registeredVoters,
        ratio: `${count} / ${registeredVoters}`,
        coverage_percent:
          registeredVoters > 0
            ? parseFloat(((count / registeredVoters) * 100).toFixed(1))
            : null,
      };
    });
  }

  static buildAreaBreakdown(
    areaNames: string[],
    collectionByArea: Map<string, number>
  ): { name: string; count: number }[] {
    return areaNames
      .map((name) => ({
        name,
        count: collectionByArea.get(name.toUpperCase().trim()) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  static uniqueSorted(values: string[]): string[] {
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  static getChildJurisdictionLevel(scopeType: EventScopeType | null): {
    level: 'county' | 'constituency' | 'ward' | 'polling_center';
    field: 'countyName' | 'constituencyName' | 'wardName' | null;
    label: string;
  } | null {
    switch (scopeType) {
      case EventScopeType.COUNTY:
        return { level: 'constituency', field: 'constituencyName', label: 'Constituency' };
      case EventScopeType.CONSTITUENCY:
        return { level: 'ward', field: 'wardName', label: 'Ward' };
      case EventScopeType.WARD:
        return { level: 'polling_center', field: null, label: 'Polling center' };
      case EventScopeType.POLLING_CENTER:
        return { level: 'polling_center', field: null, label: 'Polling center' };
      default:
        return null;
    }
  }

  static coverageStatus(
    mobilized: number,
    coverage: number | null
  ): 'not_started' | 'critical' | 'low' | 'moderate' | 'good' {
    if (mobilized === 0) return 'not_started';
    if (coverage == null) return mobilized > 0 ? 'moderate' : 'not_started';
    if (coverage < 1) return 'critical';
    if (coverage < 5) return 'low';
    if (coverage < 15) return 'moderate';
    return 'good';
  }

  static buildRankedAreaBreakdown(
    centersInScope: PollingCenter[],
    areaField: 'countyName' | 'constituencyName' | 'wardName',
    collectionByArea: Map<string, number>
  ): Array<{
    rank: number;
    name: string;
    mobilized: number;
    registered_voters: number;
    remaining: number;
    coverage_percent: number | null;
    ratio: string;
    status: 'not_started' | 'critical' | 'low' | 'moderate' | 'good';
  }> {
    const rollByArea = new Map<string, { name: string; registered: number }>();

    for (const pc of centersInScope) {
      const name = pc[areaField];
      if (!name) continue;
      const key = name.toUpperCase().trim();
      const existing = rollByArea.get(key);
      if (existing) {
        existing.registered += pc.registeredVoters;
      } else {
        rollByArea.set(key, { name, registered: pc.registeredVoters });
      }
    }

    const sorted = [...rollByArea.values()]
      .map(({ name, registered }) => {
        const mobilized = collectionByArea.get(name.toUpperCase().trim()) ?? 0;
        const coverage =
          registered > 0 ? parseFloat(((mobilized / registered) * 100).toFixed(1)) : null;
        return {
          name,
          mobilized,
          registered_voters: registered,
          remaining: Math.max(0, registered - mobilized),
          coverage_percent: coverage,
          ratio: `${mobilized.toLocaleString()} / ${registered.toLocaleString()}`,
          status: JurisdictionService.coverageStatus(mobilized, coverage),
        };
      })
      .sort((a, b) => {
        const covA = a.coverage_percent ?? -1;
        const covB = b.coverage_percent ?? -1;
        if (covA !== covB) return covA - covB;
        if (a.mobilized !== b.mobilized) return a.mobilized - b.mobilized;
        return b.registered_voters - a.registered_voters;
      });

    return sorted.map((item, index) => ({ ...item, rank: index + 1 }));
  }

  static buildRankedPollingCenterBreakdown(
    centersInScope: PollingCenter[],
    collectionByCenter: Map<string, number>
  ): Array<{
    rank: number;
    name: string;
    ward: string;
    constituency: string;
    mobilized: number;
    registered_voters: number;
    remaining: number;
    coverage_percent: number | null;
    ratio: string;
    status: 'not_started' | 'critical' | 'low' | 'moderate' | 'good';
  }> {
    const sorted = centersInScope
      .map((pc) => {
        const key = JurisdictionService.compositeKey(pc.name, pc.wardName, pc.constituencyName);
        const mobilized = collectionByCenter.get(key) ?? 0;
        const registered = pc.registeredVoters;
        const coverage =
          registered > 0 ? parseFloat(((mobilized / registered) * 100).toFixed(1)) : null;
        return {
          name: pc.name,
          ward: pc.wardName,
          constituency: pc.constituencyName,
          mobilized,
          registered_voters: registered,
          remaining: Math.max(0, registered - mobilized),
          coverage_percent: coverage,
          ratio: `${mobilized.toLocaleString()} / ${registered.toLocaleString()}`,
          status: JurisdictionService.coverageStatus(mobilized, coverage),
        };
      })
      .sort((a, b) => {
        const covA = a.coverage_percent ?? -1;
        const covB = b.coverage_percent ?? -1;
        if (covA !== covB) return covA - covB;
        if (a.mobilized !== b.mobilized) return a.mobilized - b.mobilized;
        return b.registered_voters - a.registered_voters;
      });

    return sorted.map((item, index) => ({ ...item, rank: index + 1 }));
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
