export async function loadApiData<T = any>(file: string, params: Record<string, string> = {}): Promise<T> {
  const search = new URLSearchParams({ file, ...params });
  const headers: Record<string, string> = {};
  if (import.meta.env.VITE_DATA_API_KEY) {
    headers["x-data-key"] = import.meta.env.VITE_DATA_API_KEY;
  }

  const res = await fetch(`/api/data?${search.toString()}`, { headers });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  return res.json();
}
