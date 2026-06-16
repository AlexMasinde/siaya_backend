import { createHash } from 'crypto';

function normalizePart(value: string): string {
  return value.trim().toUpperCase();
}

/** Stable hash for polling-center jurisdiction grain (fits MySQL unique index limits). */
export function jurisdictionGrainKey(
  pollingCenter: string,
  ward: string,
  constituency: string
): string {
  const composite = `${normalizePart(pollingCenter)}|${normalizePart(ward)}|${normalizePart(constituency)}`;
  return createHash('sha256').update(composite).digest('hex');
}
