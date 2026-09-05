import type { NormalizationWarning } from "./types";

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
};

export interface SeekDateResult {
  datePosted: string | null;
  warning: NormalizationWarning | null;
}

export function normalizeSeekPostingDate(
  postingDate: string | null,
  postingText: string | null,
  discoveredAt: string,
): SeekDateResult {
  const discovered = new Date(discoveredAt);
  if (postingDate) {
    const explicit = /^\d{4}-\d{2}-\d{2}$/.test(postingDate)
      ? new Date(`${postingDate}T00:00:00.000Z`)
      : new Date(postingDate);
    if (!Number.isNaN(explicit.getTime()) && explicit.getTime() <= discovered.getTime()) {
      return { datePosted: explicit.toISOString(), warning: null };
    }
    return {
      datePosted: null,
      warning: {
        code: "INVALID_EXPLICIT_DATE",
        field: "postingDate",
        message: "The explicit posting date was invalid or in the future",
        sourceText: postingDate,
      },
    };
  }
  if (!postingText) return { datePosted: null, warning: null };
  if (/^listed today$/i.test(postingText)) {
    return { datePosted: discovered.toISOString(), warning: null };
  }
  const match = /^listed\s+([a-z]+|\d+)\s+days?\s+ago$/i.exec(postingText);
  if (match) {
    const token = match[1].toLowerCase();
    const days = /^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token];
    if (days !== undefined && Number.isInteger(days) && days >= 0 && days <= 365) {
      return {
        datePosted: new Date(discovered.getTime() - days * 86_400_000).toISOString(),
        warning: null,
      };
    }
  }
  return {
    datePosted: null,
    warning: {
      code: "AMBIGUOUS_DATE",
      field: "postingText",
      message: "The relative posting date was not in a supported deterministic form",
      sourceText: postingText,
    },
  };
}
