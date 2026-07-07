import { AppDataSource } from '../config/database';
import { Event } from '../entities/Event';
import { User, UserRole } from '../entities/User';
import { EventMobilizationRoleType } from '../entities/EventMobilizationRole';
import { hashPassword } from '../utils/auth';
import { smsService } from './sms';
import { MobilizationAccessError } from './MobilizationAccessService';
import { MobilizationRosterService } from './MobilizationRosterService';
import { MobilizerPollingCenter } from '../utils/mobilizationPollingCenter';

export interface CreateMobilizerInput {
  name: string;
  email: string;
  phoneNumber: string;
  pollingCenter: MobilizerPollingCenter;
}

export interface CreateMobilizerResult {
  user: {
    id: string;
    name: string;
    email: string;
    phoneNumber: string | null;
  };
  role: Awaited<ReturnType<typeof MobilizationRosterService.addRole>>;
  created: boolean;
  smsSent: boolean;
  password?: string;
  message: string;
}

export type CreateCoordinatorResult = CreateMobilizerResult;

function generateRandomPassword(): string {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 12; i++) {
    password += charset.charAt(Math.floor(Math.random() * charset.length));
  }
  return password;
}

async function ensureUserOnEvent(eventId: string, userId: string): Promise<void> {
  const rows = (await AppDataSource.query(
    `SELECT 1 AS ok FROM users_events WHERE userId = ? AND eventId = ? LIMIT 1`,
    [userId, eventId]
  )) as Array<{ ok: number }>;
  if (rows.length > 0) {
    return;
  }
  await AppDataSource.query(`INSERT INTO users_events (userId, eventId) VALUES (?, ?)`, [
    userId,
    eventId,
  ]);
}

export class MobilizationOnboardingService {
  static async createMobilizer(
    event: Event,
    input: CreateMobilizerInput,
    actorId: string,
    options?: { enforceCoordinatorCapacity?: boolean }
  ): Promise<CreateMobilizerResult> {
    const name = input.name?.trim();
    const email = input.email?.trim().toLowerCase();
    const phoneRaw = input.phoneNumber?.trim();

    if (!name || !email || !phoneRaw) {
      throw new MobilizationAccessError('Name, email, and phone number are required', 400);
    }

    const normalizedPhone = smsService.normalizePhoneNumber(phoneRaw);
    if (typeof normalizedPhone === 'object' && 'error' in normalizedPhone) {
      throw new MobilizationAccessError('Invalid phone number format', 400);
    }
    const displayPhone = `0${normalizedPhone.slice(3)}`;

    const userRepository = AppDataSource.getRepository(User);
    let user = await userRepository.findOne({ where: { email } });
    let created = false;
    let smsSent = false;
    let password: string | undefined;
    let message: string;

    if (!user) {
      password = generateRandomPassword();
      const hashedPassword = await hashPassword(password);
      user = userRepository.create({
        name,
        email,
        password: hashedPassword,
        role: UserRole.USER,
        adminId: event.createdById,
        phoneNumber: displayPhone,
      });
      await userRepository.save(user);
      created = true;
      smsSent = await smsService.sendUserCredentials(displayPhone, email, password);
      message = smsSent
        ? 'Mobilizer created. Login credentials sent by SMS.'
        : 'Mobilizer created. SMS failed — share credentials manually.';
    } else {
      if (user.phoneNumber !== displayPhone) {
        user.phoneNumber = displayPhone;
        await userRepository.save(user);
      }
      if (user.name !== name) {
        user.name = name;
        await userRepository.save(user);
      }
      message = 'Existing user added to this campaign as a mobilizer.';
    }

    await ensureUserOnEvent(event.eventId, user.id);

    const existingRole = await MobilizationRosterService.findRole(event.eventId, user.id);
    if (existingRole) {
      throw new MobilizationAccessError(
        `This user is already a ${existingRole.role} on this campaign`,
        400
      );
    }

    const role = await MobilizationRosterService.addRole(
      event.eventId,
      user.id,
      EventMobilizationRoleType.MOBILIZER,
      actorId,
      input.pollingCenter,
      { enforceCoordinatorCapacity: options?.enforceCoordinatorCapacity }
    );

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
      },
      role,
      created,
      smsSent,
      ...(created && !smsSent && password ? { password } : {}),
      message,
    };
  }

  static async createCoordinator(
    event: Event,
    input: Pick<CreateMobilizerInput, 'name' | 'email' | 'phoneNumber'>,
    actorId: string
  ): Promise<CreateCoordinatorResult> {
    const name = input.name?.trim();
    const email = input.email?.trim().toLowerCase();
    const phoneRaw = input.phoneNumber?.trim();

    if (!name || !email || !phoneRaw) {
      throw new MobilizationAccessError('Name, email, and phone number are required', 400);
    }

    const normalizedPhone = smsService.normalizePhoneNumber(phoneRaw);
    if (typeof normalizedPhone === 'object' && 'error' in normalizedPhone) {
      throw new MobilizationAccessError('Invalid phone number format', 400);
    }
    const displayPhone = `0${normalizedPhone.slice(3)}`;

    const userRepository = AppDataSource.getRepository(User);
    let user = await userRepository.findOne({ where: { email } });
    let created = false;
    let smsSent = false;
    let password: string | undefined;
    let message: string;

    if (!user) {
      password = generateRandomPassword();
      const hashedPassword = await hashPassword(password);
      user = userRepository.create({
        name,
        email,
        password: hashedPassword,
        role: UserRole.USER,
        adminId: event.createdById,
        phoneNumber: displayPhone,
      });
      await userRepository.save(user);
      created = true;
      smsSent = await smsService.sendUserCredentials(displayPhone, email, password);
      message = smsSent
        ? 'Coordinator created. Login credentials sent by SMS.'
        : 'Coordinator created. SMS failed — share credentials manually.';
    } else {
      if (user.phoneNumber !== displayPhone) {
        user.phoneNumber = displayPhone;
        await userRepository.save(user);
      }
      if (user.name !== name) {
        user.name = name;
        await userRepository.save(user);
      }
      message = 'Existing user added to this campaign as a coordinator.';
    }

    await ensureUserOnEvent(event.eventId, user.id);

    const existingRole = await MobilizationRosterService.findRole(event.eventId, user.id);
    if (existingRole) {
      throw new MobilizationAccessError(
        `This user is already a ${existingRole.role} on this campaign`,
        400
      );
    }

    const role = await MobilizationRosterService.addRole(
      event.eventId,
      user.id,
      EventMobilizationRoleType.COORDINATOR,
      actorId,
      null
    );

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phoneNumber: user.phoneNumber,
      },
      role,
      created,
      smsSent,
      ...(created && !smsSent && password ? { password } : {}),
      message,
    };
  }
}
