// Minimal beat helpers, matching RPEN's core/beat.mjs behaviour without
// depending on the internal module resolver. Purely numeric; never throws.
export function beatValue(beat) {
  if (!Array.isArray(beat) || beat.length !== 3) return Number.NaN;
  const [whole, numerator, denominator] = beat;
  if (!Number.isFinite(whole) || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return Number.NaN;
  return whole + numerator / denominator;
}

export function fromNumber(value, denominator = 19200) {
  if (!Number.isFinite(value)) return [0, 0, 1];
  const total = Math.round(value * denominator);
  if (!Number.isSafeInteger(total)) return [0, 0, 1];
  const whole = Math.floor(total / denominator);
  const numerator = total - whole * denominator;
  let divisor = denominator;
  let remainder = numerator;
  while (remainder) { const next = divisor % remainder; divisor = remainder; remainder = next; }
  return [whole, numerator / divisor, denominator / divisor];
}
