const SAFE_STATUS = /^[A-Z0-9_]+$/;

export function StatusBadge({ value }: { value: string | null | undefined }) {
  const normalized = value && SAFE_STATUS.test(value) ? value : "BELIRSIZ";
  return <span className={`status status-${normalized.toLowerCase()}`}>{normalized.replaceAll("_", " ")}</span>;
}

