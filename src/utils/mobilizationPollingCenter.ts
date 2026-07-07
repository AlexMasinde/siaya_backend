export interface MobilizerPollingCenter {
  pollingCenter: string;
  ward: string;
  constituency: string;
}

export function normalizePollingCenterFields(
  pollingCenter: string,
  ward?: string | null,
  constituency?: string | null
): MobilizerPollingCenter {
  return {
    pollingCenter: pollingCenter.trim(),
    ward: (ward ?? '').trim(),
    constituency: (constituency ?? '').trim(),
  };
}

export function pollingCenterLabel(pc: MobilizerPollingCenter): string {
  const parts = [pc.pollingCenter, pc.ward, pc.constituency].filter(Boolean);
  return parts.join(' · ');
}

export function pollingCenterKey(pc: MobilizerPollingCenter): string {
  return `${pc.constituency}\0${pc.ward}\0${pc.pollingCenter}`;
}

export function participantInPollingCenter(
  participant: {
    pollingCenter: string | null;
    ward: string | null;
    constituency: string | null;
  },
  assigned: MobilizerPollingCenter
): boolean {
  return (
    (participant.pollingCenter ?? '').trim() === assigned.pollingCenter &&
    (participant.ward ?? '').trim() === assigned.ward &&
    (participant.constituency ?? '').trim() === assigned.constituency
  );
}
