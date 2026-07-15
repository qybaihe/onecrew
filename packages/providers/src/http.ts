import { ProviderError } from './errors.js';

export async function fetchProvider(
  provider: string,
  url: string,
  init: RequestInit,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw error;
    throw new ProviderError(
      'PROVIDER_NETWORK_ERROR',
      `${provider} network request failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      true,
    );
  }
  if (!response.ok) {
    const body = (await response.text()).slice(0, 2_000);
    throw new ProviderError(
      `PROVIDER_HTTP_${response.status}`,
      `${provider} returned HTTP ${response.status}: ${body}`,
      response.status === 408 || response.status === 409 || response.status === 429 || response.status >= 500,
      response.status,
    );
  }
  return response;
}

export async function fetchProviderJson(
  provider: string,
  url: string,
  init: RequestInit,
): Promise<{ response: Response; json: unknown }> {
  const response = await fetchProvider(provider, url, init);
  try {
    return { response, json: await response.json() };
  } catch {
    throw new ProviderError('PROVIDER_INVALID_JSON', `${provider} returned invalid JSON`, false, 502);
  }
}

export function bearerHeaders(apiKey: string, idempotencyKey?: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
  };
}
