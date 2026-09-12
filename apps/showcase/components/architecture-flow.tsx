const stages = [
  ["01", "Approved job sources", "Exact tenant, route and read budget"],
  ["02", "Secure source transport", "HTTPS, pinning and fail-closed stops"],
  ["03", "Immutable observations", "Raw provenance without silent rewrites"],
  ["04", "Normalize + deduplicate", "Typed facts and conservative identity"],
  ["05", "Evidence + fit", "Unknown evidence never becomes a pass"],
  ["06", "Review queue", "Explainable owner decisions"],
  ["07", "Frozen packet", "Documents, answers and disclosures bound"],
  ["08", "Controlled runner", "Target-specific and protection-aware"],
  ["09", "Human approval", "Fresh consent at the irreversible boundary"],
] as const;

export function ArchitectureFlow({ compact = false }: { compact?: boolean }) {
  return (
    <ol className={compact ? "architecture-flow architecture-flow--compact" : "architecture-flow"}>
      {stages.map(([number, title, detail]) => (
        <li key={number}>
          <span className="architecture-flow__number">{number}</span>
          <div>
            <strong>{title}</strong>
            <span>{detail}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
