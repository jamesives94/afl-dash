// Dates refer to the Azure blobs actually served, never build/page-load times.
const dates = new Map<string, number>();
const listeners = new Set<() => void>();
export function recordUploadDate(file: string, response: Response) {
  const raw = response.headers.get("x-file-last-modified") || response.headers.get("last-modified");
  const value = raw ? Date.parse(raw) : NaN;
  if (Number.isFinite(value)) dates.set(file, value);
  else dates.delete(file);
  listeners.forEach((listener) => listener());
}
export function subscribeUploadDates(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function latestUploadDate(files: string[]): number | null {
  const values = files.map((file) => dates.get(file)).filter((v): v is number => v !== undefined);
  return values.length ? Math.max(...values) : null;
}
export function formatUploadDate(value: number | null): string {
  return value === null ? "Unavailable" : new Intl.DateTimeFormat("en-AU", {
    timeZone: "Australia/Brisbane", day: "2-digit", month: "short", year: "numeric",
  }).format(value);
}
