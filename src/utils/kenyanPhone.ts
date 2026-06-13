/**
 * Kenyan mobile numbers — normalize and validate common field formats:
 * 0722121314, 722121314, +254722121314, 254722121314, 254 722 121 314
 */

export type KenyanMobileResult =
  | { ok: true; local: string; international: string }
  | { ok: false; error: string };

const LOCAL_MOBILE_PATTERN = /^0[17]\d{8}$/;
const NINE_DIGIT_MOBILE_PATTERN = /^[17]\d{8}$/;
const INTERNATIONAL_MOBILE_PATTERN = /^254[17]\d{8}$/;

function cleanRawInput(input: unknown): string {
  if (input == null) return '';

  let value = String(input).trim().replace(/^\+/, '');

  if (/^\d+(\.\d+)?e[+-]?\d+$/i.test(value)) {
    value = String(Math.round(Number(value)));
  } else if (value.includes('.') && !value.includes('e')) {
    value = value.split('.')[0];
  }

  return value.replace(/[\s\-().]/g, '');
}

function toInternational(local: string): string {
  return `254${local.slice(1)}`;
}

/**
 * Parse and validate a Kenyan mobile number.
 * Returns canonical local form (0XXXXXXXXX) and international (254XXXXXXXXX).
 */
export function parseKenyanMobile(input: unknown): KenyanMobileResult {
  const digits = cleanRawInput(input);

  if (!digits) {
    return { ok: false, error: 'Phone number is required' };
  }

  if (!/^\d+$/.test(digits)) {
    return { ok: false, error: 'Invalid phone number' };
  }

  let local: string | null = null;

  if (INTERNATIONAL_MOBILE_PATTERN.test(digits)) {
    local = `0${digits.slice(3)}`;
  } else if (digits.startsWith('254')) {
    const national = digits.slice(3).replace(/^0+/, '');
    if (NINE_DIGIT_MOBILE_PATTERN.test(national)) {
      local = `0${national}`;
    }
  } else if (LOCAL_MOBILE_PATTERN.test(digits)) {
    local = digits;
  } else if (NINE_DIGIT_MOBILE_PATTERN.test(digits)) {
    local = `0${digits}`;
  }

  if (!local || !LOCAL_MOBILE_PATTERN.test(local)) {
    return {
      ok: false,
      error: 'Invalid phone number. Use a valid Kenyan mobile (e.g. 0712345678 or 712345678).',
    };
  }

  return {
    ok: true,
    local,
    international: toInternational(local),
  };
}

export function isValidKenyanMobile(input: unknown): boolean {
  return parseKenyanMobile(input).ok;
}

/** Resolve phone for check-in: prefer request value, fall back to stored participant phone. */
export function resolveKenyanMobileForCheckIn(
  requestPhone: unknown,
  storedPhone: string | null | undefined
): KenyanMobileResult {
  const rawRequest = typeof requestPhone === 'string' ? requestPhone.trim() : '';
  if (rawRequest) {
    return parseKenyanMobile(rawRequest);
  }

  const rawStored = storedPhone?.trim() ?? '';
  if (rawStored) {
    return parseKenyanMobile(rawStored);
  }

  return {
    ok: false,
    error: 'Phone number is required for check-in. Enter a valid Kenyan mobile number.',
  };
}
