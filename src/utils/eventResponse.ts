import { Event } from '../entities/Event';
import { JurisdictionService } from '../services/JurisdictionService';

export async function formatEventResponse(event: Event) {
  const registeredVotersInScope = await JurisdictionService.getRegisteredVotersInScope(event);

  return {
    eventId: event.eventId,
    eventName: event.eventName,
    location: event.location,
    date: event.date,
    county: event.county,
    constituency: event.constituency,
    ward: event.ward,
    scopeType: event.scopeType,
    pollingCenterId: event.pollingCenterId,
    pollingCenter: event.pollingCenter
      ? {
          id: event.pollingCenter.id,
          name: event.pollingCenter.name,
          code: event.pollingCenter.code,
          ward: event.pollingCenter.wardName,
          constituency: event.pollingCenter.constituencyName,
          registeredVoters: event.pollingCenter.registeredVoters,
        }
      : null,
    registeredVotersInScope,
    createdBy: event.createdBy
      ? {
          id: event.createdBy.id,
          name: event.createdBy.name,
          email: event.createdBy.email,
        }
      : undefined,
    assignedUsers: event.assignedUsers?.map((user) => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    })),
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
  };
}
