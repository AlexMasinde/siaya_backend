import { AppDataSource } from '../config/database';
import { Event, EventScopeType } from '../entities/Event';
import { PollingCenter } from '../entities/PollingCenter';

export interface EventScopeInput {
  scopeType?: EventScopeType | null;
  county?: string | null;
  constituency?: string | null;
  ward?: string | null;
  pollingCenterId?: number | null;
}

export async function applyEventScope(
  event: Event,
  input: EventScopeInput
): Promise<{ error?: string }> {
  if (input.scopeType === undefined) {
    return {};
  }

  if (input.scopeType === null || input.scopeType === ('' as EventScopeType)) {
    event.scopeType = null;
    event.county = null;
    event.constituency = null;
    event.ward = null;
    event.pollingCenterId = null;
    return {};
  }

  const scopeType = input.scopeType;
  event.scopeType = scopeType;

  switch (scopeType) {
    case EventScopeType.COUNTY: {
      if (!input.county) return { error: 'county is required for county scope' };
      event.county = input.county;
      event.constituency = null;
      event.ward = null;
      event.pollingCenterId = null;
      break;
    }
    case EventScopeType.CONSTITUENCY: {
      if (!input.county || !input.constituency) {
        return { error: 'county and constituency are required for constituency scope' };
      }
      event.county = input.county;
      event.constituency = input.constituency;
      event.ward = null;
      event.pollingCenterId = null;
      break;
    }
    case EventScopeType.WARD: {
      if (!input.county || !input.constituency || !input.ward) {
        return { error: 'county, constituency, and ward are required for ward scope' };
      }
      event.county = input.county;
      event.constituency = input.constituency;
      event.ward = input.ward;
      event.pollingCenterId = null;
      break;
    }
    case EventScopeType.POLLING_CENTER: {
      if (!input.pollingCenterId) {
        return { error: 'pollingCenterId is required for polling center scope' };
      }
      const center = await AppDataSource.getRepository(PollingCenter).findOne({
        where: { id: input.pollingCenterId },
      });
      if (!center) return { error: 'Polling center not found' };
      event.pollingCenterId = center.id;
      event.county = center.countyName;
      event.constituency = center.constituencyName;
      event.ward = center.wardName;
      break;
    }
    default:
      return { error: 'Invalid scope type' };
  }

  return {};
}
