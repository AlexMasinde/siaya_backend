import 'reflect-metadata';
import '../config/env';
import { AppDataSource } from '../config/database';
import { runAnalyticsBackfill } from '../services/AnalyticsBackfillService';
import logger from '../config/logger';

function parseArgs(argv: string[]): { eventId?: string; verifyOnly: boolean } {
  let eventId: string | undefined;
  let verifyOnly = false;

  for (const arg of argv) {
    if (arg === '--verify-only') {
      verifyOnly = true;
    } else if (arg.startsWith('--eventId=')) {
      eventId = arg.slice('--eventId='.length).trim() || undefined;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage:
  npm run backfill:analytics
  npm run backfill:analytics -- --eventId=<uuid>
  npm run backfill:analytics -- --verify-only
  npm run backfill:analytics -- --eventId=<uuid> --verify-only`);
      process.exit(0);
    }
  }

  return { eventId, verifyOnly };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  try {
    await AppDataSource.initialize();
    logger.info('Database connected for analytics backfill');

    await runAnalyticsBackfill(options);

    await AppDataSource.destroy();
    process.exit(0);
  } catch (error) {
    logger.error('Analytics backfill failed:', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
    process.exit(1);
  }
}

main();
