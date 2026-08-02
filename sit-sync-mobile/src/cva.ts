export function formatDerivedCva(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(1)}°`
    : '—';
}

export function derivedCvaDetail(
  value: number | null | undefined,
): string {
  return `Derived CVA-like: ${formatDerivedCva(value)} (lower is worse).`;
}
