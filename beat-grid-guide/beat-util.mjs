// 节拍数值工具：在 RPEN 的 [整数, 分子, 分母] 节拍三元组与小数之间互转。
// 纯数字运算，不抛异常；实现与 RPEN core/beat.mjs 保持一致。
export function beatValue(beat) {
  // 把 [whole, numerator, denominator] 转成小数节拍（如 [1, 1, 4] → 1.25）。
  if (!Array.isArray(beat) || beat.length !== 3) return Number.NaN;
  const [whole, numerator, denominator] = beat;
  if (!Number.isFinite(whole) || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return Number.NaN;
  return whole + numerator / denominator;
}

// 把小数节拍按 1/19200 精度转回 [整数, 分子, 分母] 三元组。
export function fromNumber(value, denominator = 19200) {
  if (!Number.isFinite(value)) return [0, 0, 1];
  const total = Math.round(value * denominator);
  if (!Number.isSafeInteger(total)) return [0, 0, 1];
  const whole = Math.floor(total / denominator);
  const numerator = total - whole * denominator;
  // 约分，得到最简分母（如 1.25 → [1, 1, 4]）。
  let divisor = denominator;
  let remainder = numerator;
  while (remainder) { const next = divisor % remainder; divisor = remainder; remainder = next; }
  return [whole, numerator / divisor, denominator / divisor];
}
