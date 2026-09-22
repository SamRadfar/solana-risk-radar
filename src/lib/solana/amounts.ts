/**
 * Token amount normalisation.
 *
 * Deliberately its own module, free of `server-only`, because this is pure
 * arithmetic that both the server code and the test suite need to reach. It
 * is also the single most dangerous function in the project: the same
 * conversion produces supply, holder balances and every share derived from
 * them, so an error here is never a rounding error — it is a factor of a
 * thousand or a million.
 */

/**
 * Convert a base-unit amount string to whole tokens without precision loss.
 *
 * Done as string surgery rather than `Number(raw) / 10 ** decimals`, because
 * a u64 supply exceeds what a double counts exactly: BONK's raw supply is
 * about 8.8e18, and dividing that as a float silently loses the low digits
 * before the decimal point is ever applied.
 */
export function toUiAmount(rawAmount: string, decimals: number): number {
  if (decimals === 0) return Number(rawAmount);
  const padded = rawAmount.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals);
  return Number(`${whole}.${fraction}`);
}
