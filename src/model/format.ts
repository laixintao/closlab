export const formatCount = (n: number | bigint) => n.toLocaleString('en-US');
export function formatBandwidth(mbps: bigint): string {
  const units = ['Mbps', 'Gbps', 'Tbps', 'Pbps', 'Ebps', 'Zbps', 'Ybps'];
  let divisor = 1n, unit = 0;
  while (mbps >= divisor * 1000n && unit < units.length - 1) { divisor *= 1000n; unit++; }
  const value = Number(mbps * 100n / divisor) / 100;
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' ' + units[unit];
}
export const ratio = (a: bigint, b: bigint) => b === 0n ? 0 : Number(a * 10000n / b) / 100;
