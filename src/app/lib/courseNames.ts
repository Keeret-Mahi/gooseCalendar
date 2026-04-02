export function normalizeCourseNameCapitalization(value: string | null | undefined) {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  return normalized.replace(/\b([a-z][a-z'-]{5,})\b/g, (word) => {
    return `${word.charAt(0).toUpperCase()}${word.slice(1)}`;
  });
}
