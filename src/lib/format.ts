export function formatUsd(value: number): string {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatNumber(value: number): string {
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(2)}B`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)}K`;
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Token prices span many orders of magnitude, so a fixed number of decimals is
 * useless: memecoins routinely trade below $0.000001. Exponential notation is
 * accurate but unreadable at a glance, so small values are expanded to plain
 * decimals with a fixed number of significant digits instead.
 */
export function formatPrice(price: number): string {
  if (!Number.isFinite(price) || price <= 0) return "—";
  if (price >= 1000) return formatUsd(price);
  if (price >= 1) return `$${price.toFixed(4)}`;
  if (price >= 0.0001) return `$${price.toPrecision(4)}`;

  // Expand exponential notation (1.234e-7) into 0.0000001234.
  const expanded = price.toFixed(20).replace(/0+$/, "");
  const firstSignificant = expanded.search(/[1-9]/);
  if (firstSignificant === -1) return "—";
  return `$${expanded.slice(0, firstSignificant + 4)}`;
}
