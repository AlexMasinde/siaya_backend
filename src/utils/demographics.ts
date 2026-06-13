export function calculateAge(dateOfBirth: Date | string | null): number | null {
  if (!dateOfBirth) return null;
  const birthDate = new Date(dateOfBirth);
  if (isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

export function getAgeGroup(age: number | null): string {
  if (age === null) return 'NOT STATED';
  if (age < 18) return 'Under 18';
  if (age <= 24) return '18-24';
  if (age <= 34) return '25-34';
  if (age <= 44) return '35-44';
  if (age <= 54) return '45-54';
  if (age <= 64) return '55-64';
  return '65+';
}

export const AGE_GROUP_ORDER = [
  '18-24',
  '25-34',
  '35-44',
  '45-54',
  '55-64',
  '65+',
  'NOT STATED',
] as const;

export function normalizeGender(rawGender: string | null | undefined): string {
  if (!rawGender) return 'NOT STATED';
  const gender = rawGender.trim().toUpperCase();
  if (gender === 'M' || gender === 'MALE') return 'MALE';
  if (gender === 'F' || gender === 'FEMALE') return 'FEMALE';
  return 'NOT STATED';
}

export const GENDER_ORDER = ['MALE', 'FEMALE', 'NOT STATED'] as const;

export function aggregateDemographics(
  participants: { sex: string | null; dateOfBirth: Date | null }[]
): {
  gender: { name: string; count: number; percent: number }[];
  age_groups: { name: string; count: number; percent: number }[];
} {
  const genderCounts: Record<string, number> = {};
  const ageCounts: Record<string, number> = {};

  for (const p of participants) {
    const gender = normalizeGender(p.sex);
    genderCounts[gender] = (genderCounts[gender] || 0) + 1;

    const age = calculateAge(p.dateOfBirth);
    if (age !== null && age < 18) continue;
    const group = getAgeGroup(age);
    ageCounts[group] = (ageCounts[group] || 0) + 1;
  }

  const totalGender = Object.values(genderCounts).reduce((a, b) => a + b, 0);
  const totalAge = Object.values(ageCounts).reduce((a, b) => a + b, 0);

  const gender = GENDER_ORDER.filter((g) => genderCounts[g]).map((name) => ({
    name,
    count: genderCounts[name],
    percent: totalGender > 0 ? parseFloat(((genderCounts[name] / totalGender) * 100).toFixed(1)) : 0,
  }));

  const age_groups = AGE_GROUP_ORDER.filter((g) => ageCounts[g]).map((name) => ({
    name,
    count: ageCounts[name],
    percent: totalAge > 0 ? parseFloat(((ageCounts[name] / totalAge) * 100).toFixed(1)) : 0,
  }));

  return { gender, age_groups };
}
