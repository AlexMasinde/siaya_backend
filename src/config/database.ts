import { DataSource } from 'typeorm';
import { User } from '../entities/User';
import { Event } from '../entities/Event';
import { Participant } from '../entities/Participant';
import { CheckInLog } from '../entities/CheckInLog';
import { PollingCenter } from '../entities/PollingCenter';
import { EventJurisdictionStat } from '../entities/EventJurisdictionStat';
import { EventDailyStat } from '../entities/EventDailyStat';
import { EventAgentStat } from '../entities/EventAgentStat';
import { Survey } from '../entities/Survey';
import { SurveyAgent } from '../entities/SurveyAgent';
import { SurveyAssignment } from '../entities/SurveyAssignment';
import { SurveyStat } from '../entities/SurveyStat';
import { SurveyAgentStat } from '../entities/SurveyAgentStat';
import { SurveyJurisdictionStat } from '../entities/SurveyJurisdictionStat';
import { SurveyDailyStat } from '../entities/SurveyDailyStat';
import { SurveyResponseOption } from '../entities/SurveyResponseOption';
import { SurveyResponseOptionStat } from '../entities/SurveyResponseOptionStat';

import { env } from './env';
import logger from './logger';

// Handle CA certificate (can contain newlines as \n or \\n)
const ca = env.DB_SSL_CA?.replace(/\\n/g, '\n');

// Create SSL configuration if DB_SSL is 'true'
const ssl =
  env.DB_SSL === 'true'
    ? {
        minVersion: 'TLSv1.2' as const,
        rejectUnauthorized: true,
        ...(ca ? { ca } : {}),
      }
    : undefined;

const dbConfig = {
  type: 'mysql' as const,
  host: env.DB_HOST,
  port: env.DB_PORT,
  username: env.DB_USERNAME,
  password: env.DB_PASSWORD,
  database: env.DB_DATABASE,
  synchronize: env.NODE_ENV !== 'production',
  logging: env.NODE_ENV === 'development',
  entities: [
    User,
    Event,
    Participant,
    CheckInLog,
    PollingCenter,
    EventJurisdictionStat,
    EventDailyStat,
    EventAgentStat,
    Survey,
    SurveyAgent,
    SurveyAssignment,
    SurveyStat,
    SurveyAgentStat,
    SurveyJurisdictionStat,
    SurveyDailyStat,
    SurveyResponseOption,
    SurveyResponseOptionStat,
  ],
  migrations: ['src/migrations/**/*.ts'],
  subscribers: ['src/subscribers/**/*.ts'],
  ssl,
  // Connection pooling settings
  extra: {
    connectionLimit: env.DB_CONNECTION_LIMIT,
    charset: 'utf8mb4', // Use utf8mb4 for full Unicode support
  },
};

// Log database configuration (without password and sensitive data)
if (env.NODE_ENV === 'development') {
  logger.debug('Database Configuration:', {
    host: dbConfig.host,
    port: dbConfig.port,
    username: dbConfig.username,
    database: dbConfig.database,
    hasSSL: !!ssl,
    hasCA: !!ca,
    connectionLimit: dbConfig.extra.connectionLimit,
  });
}

export const AppDataSource = new DataSource(dbConfig);

