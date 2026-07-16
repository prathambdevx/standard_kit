import { Country } from 'country-state-city';

/**
 * One-decimal rating, with halves rounding down: 4.74 → 4.7, 4.75 → 4.7,
 * 4.76 → 4.8 (round up only when the hundredths push past the halfway point).
 * Whole numbers are shown without a decimal: 4.0 → "4".
 */
export const formatRating = (value: number): string => {
  const rounded = Math.ceil(value * 10 - 0.5) / 10;
  return rounded.toFixed(1);
};

/**
 * Phone formatting — ensures the country code is visible and the number is
 * spaced for readability. Expects E.164 input (+919876543210) when possible,
 * but tolerates a bare national number entered without the `+` prefix, in
 * which case the country code is inferred from the given country name.
 */
const dialCodeForCountry = (country?: string): string | undefined => {
  if (!country) return undefined;
  const match = Country.getAllCountries().find((c) => c.name === country);
  return match ? `+${match.phonecode.replace(/^\+/, '')}` : undefined;
};

export const formatPhone = (phone: string, country?: string): string => {
  const digits = phone.replace(/\D/g, '');
  const dial = dialCodeForCountry(country);

  if (phone.startsWith('+')) {
    // Dial codes vary 1-4 digits (e.g. "+1" vs "+971") - use the country's actual
    // code length when known, only falling back to guessing for unrecognized countries.
    const codeLen = dial ? dial.length - 1 : digits.length <= 11 ? digits.length - 10 : 3;
    const cc = digits.slice(0, codeLen);
    const national = digits.slice(codeLen).replace(/(\d{5})(\d{5})$/, '$1 $2');
    return `+${cc} ${national}`;
  }

  // No + prefix — infer from country name (fallback for manually entered addresses).
  if (dial) {
    return `${dial} ${digits.replace(/(\d{5})(\d{5,})$/, '$1 $2')}`;
  }

  return phone;
};
