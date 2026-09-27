/** Marque Rush : deux chevrons inclinés — l'élan — dans une pastille. */
export function Logo({ size = 22, mark = false }: { size?: number; mark?: boolean }) {
  const icon = (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="logo__mark">
      <rect width="32" height="32" rx="9" fill="var(--ink)" />
      <path d="M9.5 9.5 16 16l-6.5 6.5" fill="none" stroke="var(--ink-contrast)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M16.5 9.5 23 16l-6.5 6.5" fill="none" stroke="var(--green)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (mark) return icon;
  return (
    <span className="logo" style={{ fontSize: size * 0.95 }}>
      {icon}
      <span className="logo__word">Rush</span>
    </span>
  );
}
