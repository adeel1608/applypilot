interface StatusPillProps {
  status: string;
}

export function StatusPill({ status }: StatusPillProps) {
  const tone =
    status === "ELIGIBLE" || status === "GOOD_FIT"
      ? "success"
      : status === "INELIGIBLE" || status === "REJECTED"
        ? "danger"
        : status === "REVIEW_REQUIRED"
          ? "warning"
          : "neutral";
  return <span className={`status status--${tone}`}>{status.replaceAll("_", " ")}</span>;
}
