'use client';

export class ApiClientError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function apiRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    token?: string;
    body?: unknown;
    formData?: FormData;
  } = {},
) {
  const headers = new Headers();
  if (options.token) headers.set('authorization', `Bearer ${options.token}`);
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'same-origin',
    body: options.formData ?? (options.body === undefined ? undefined : JSON.stringify(options.body)),
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new ApiClientError(response.status, payload.error || '请求失败。');
  return payload;
}

export function canFallbackToLocal(error: unknown) {
  return error instanceof ApiClientError ? error.status >= 500 : true;
}
