/**
 * Search helpers shared by the list endpoints.
 *
 * Every searchable list builds a Mongo `$regex` from user input, so the input
 * MUST be escaped first: an unescaped term lets a caller inject regex
 * operators and, worse, run an unanchored pattern across the whole collection.
 * Kept in one place so a fourth list cannot forget.
 */

/** Escape regex metacharacters so a search term is matched literally. */
export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Case-insensitive "contains" clauses for several fields at once.
 *
 * Returns an `$or` array, or undefined when there is nothing to search for, so
 * callers can spread it into a filter without a conditional.
 */
export function searchAny(
  term: string | undefined,
  fields: string[],
): Array<Record<string, unknown>> | undefined {
  const trimmed = term?.trim();
  if (!trimmed) return undefined;
  const safe = escapeRegExp(trimmed);
  return fields.map((field) => ({ [field]: { $regex: safe, $options: "i" } }));
}
