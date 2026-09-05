interface ScoreBadgeProps {
  score: number;
  compact?: boolean;
}

export function ScoreBadge({ score, compact = false }: ScoreBadgeProps) {
  const label = score >= 80 ? "Strong" : score >= 65 ? "Good" : score >= 50 ? "Mixed" : "Low";
  return (
    <div
      className={compact ? "score score--compact" : "score"}
      aria-label={`Fit score ${score} out of 100`}
    >
      <strong>{score}</strong>
      {!compact && <span>{label} fit</span>}
    </div>
  );
}
