export async function loadApiData<T = any>(file: string): Promise<T[]> {
  const res = await fetch(`/api/data?file=${encodeURIComponent(file)}`, {
    headers: {
      "x-data-key": import.meta.env.VITE_DATA_API_KEY
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }

  return res.json();
}
