import { COUNTRY_NAMES, TIME_ZONE_COUNTRIES } from './country-data';

export const COUNTRIES = Object.values(COUNTRY_NAMES).sort((a, b) => a.localeCompare(b));

export function countryOptionsFor(value: string): string[] {
  return value && !COUNTRIES.includes(value)
    ? [value, ...COUNTRIES]
    : COUNTRIES;
}

export function getBrowserCountry(): string {
  let timeZone = '';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // Some browsers restrict time-zone information.
  }
  const languages = typeof navigator === 'undefined'
    ? []
    : navigator.languages?.length ? navigator.languages : [navigator.language];
  return inferCountry(timeZone, languages);
}

export function inferCountry(timeZone: string, languages: readonly string[] = []): string {
  // Prefer the time zone: Philippine browsers often use the en-US language.
  const region = TIME_ZONE_COUNTRIES[timeZone];
  if (region && COUNTRY_NAMES[region]) return COUNTRY_NAMES[region];
  for (const language of languages) {
    try {
      const region = new Intl.Locale(language).region;
      if (region && COUNTRY_NAMES[region]) return COUNTRY_NAMES[region];
    } catch {
      // Ignore malformed or unsupported locale values.
    }
  }
  return COUNTRY_NAMES['PH'];
}
