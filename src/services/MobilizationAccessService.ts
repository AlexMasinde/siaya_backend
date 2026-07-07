import { AppDataSource } from '../config/database';
import { Event } from '../entities/Event';
import { User, UserRole } from '../entities/User';
import { EventMobilizationRoleType } from '../entities/EventMobilizationRole';

export const MAX_MOBILIZER_ASSIGNMENTS = 30;
export const MAX_MOBILIZERS_PER_COORDINATOR = 20;

export class MobilizationAccessError extends Error {
  constructor(
    message: string,
    public statusCode: number = 403
  ) {
    super(message);
    this.name = 'MobilizationAccessError';
  }
}

export function isMobilizationAdmin(user: User, event?: Event | null): boolean {
  const role = user.role as string;
  if (role === UserRole.SUPER_ADMIN || role === 'super_admin') {
    return true;
  }
  if (
    event &&
    (role === UserRole.ADMIN || role === 'admin') &&
    event.createdById === user.id
  ) {
    return true;
  }
  return false;
}

export async function hasEventMembership(userId: string, eventId: string): Promise<boolean> {
  const rows = (await AppDataSource.query(
    `SELECT 1 AS ok FROM users_events WHERE userId = ? AND eventId = ? LIMIT 1`,
    [userId, eventId]
  )) as Array<{ ok: number }>;
  return rows.length > 0;
}

export async function getMobilizationRole(
  userId: string,
  eventId: string
): Promise<EventMobilizationRoleType | null> {
  const rows = (await AppDataSource.query(
    `SELECT role FROM event_mobilization_roles WHERE eventId = ? AND userId = ? LIMIT 1`,
    [eventId, userId]
  )) as Array<{ role: EventMobilizationRoleType }>;
  return rows[0]?.role ?? null;
}

export async function getEventOrThrow(eventId: string): Promise<Event> {
  const event = await AppDataSource.getRepository(Event).findOne({
    where: { eventId },
  });
  if (!event) {
    throw new MobilizationAccessError('Event not found', 404);
  }
  return event;
}

export async function assertEventMembership(user: User, eventId: string): Promise<void> {
  if (isMobilizationAdmin(user)) {
    return;
  }
  const member = await hasEventMembership(user.id, eventId);
  if (!member) {
    throw new MobilizationAccessError('Access denied');
  }
}

export async function assertMobilizationAdmin(user: User, event: Event): Promise<void> {
  if (isMobilizationAdmin(user, event)) {
    return;
  }
  throw new MobilizationAccessError('Admin access required');
}

export async function assertCoordinatorAccess(user: User, event: Event): Promise<void> {
  if (isMobilizationAdmin(user, event)) {
    return;
  }
  const role = await getMobilizationRole(user.id, event.eventId);
  if (role === EventMobilizationRoleType.COORDINATOR) {
    return;
  }
  throw new MobilizationAccessError('Coordinator access required');
}

export async function assertMobilizerAccess(user: User, event: Event): Promise<void> {
  if (isMobilizationAdmin(user, event)) {
    return;
  }
  const role = await getMobilizationRole(user.id, event.eventId);
  if (role === EventMobilizationRoleType.MOBILIZER) {
    return;
  }
  if (role === EventMobilizationRoleType.COORDINATOR) {
    return;
  }
  throw new MobilizationAccessError('Mobilizer access required');
}

export async function assertCoordinatorOrMobilizerMonitor(
  user: User,
  event: Event
): Promise<EventMobilizationRoleType | 'admin'> {
  if (isMobilizationAdmin(user, event)) {
    return 'admin';
  }
  const role = await getMobilizationRole(user.id, event.eventId);
  if (role === EventMobilizationRoleType.COORDINATOR) {
    return role;
  }
  throw new MobilizationAccessError('Coordinator access required');
}
