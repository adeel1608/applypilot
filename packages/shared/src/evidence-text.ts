/** Exact token sequences preserve technical punctuation and reject ambiguous short labels. */
export function matchesEvidenceText(left: string, right: string): boolean {
  const tokens = (value: string): string[] =>
    value
      .normalize("NFKD")
      .toLocaleLowerCase("en-AU")
      .match(/c\+\+\d*|c#\d*|f#\d*|\.net\d*|[a-z0-9]+/g) ?? [];
  const a = tokens(left);
  const b = tokens(right);
  if (a.length === 0 || b.length === 0) return false;

  const sameSequence = (first: string[], second: string[]) =>
    first.length === second.length && first.every((token, index) => token === second[index]);
  if (sameSequence(a, b)) return true;

  const containsSequence = (haystack: string[], needle: string[]) =>
    haystack.some((_, index) =>
      needle.every((token, offset) => haystack[index + offset] === token),
    );
  const containsAmbiguousShortToken = (values: string[]) =>
    values.some((token) => token.length <= 2 && !/[+#.]|\d/.test(token));

  if (a.length < b.length && containsAmbiguousShortToken(a)) return false;
  if (b.length < a.length && containsAmbiguousShortToken(b)) return false;
  return containsSequence(a, b) || containsSequence(b, a);
}
