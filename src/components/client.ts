"use client";

export async function post<T = unknown>(url: string, body?: unknown, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    ...(body instanceof FormData ? { body } : { headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }),
    ...init,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(data.error ?? `${res.status}`);
  return data;
}
