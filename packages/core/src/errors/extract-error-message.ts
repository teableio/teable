/**
 * Safely extract a human-readable message from any thrown value.
 *
 * Handles all common shapes:
 *  - `Error` instances          → error.message
 *  - plain strings              → the string itself
 *  - objects with message/error → the string field
 *  - nested { error: { message } } → the nested message
 *  - { responseBody: '{"error":{"message":"..."}}' } → parsed body message
 *  - everything else            → JSON.stringify (truncated) or fallback text
 */
const unknownError = 'Unknown error';

export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name || unknownError;
  if (typeof error === 'string') return error;
  if (typeof error !== 'object' || error === null) return unknownError;

  const obj = error as Record<string, unknown>;

  const direct = getStringField(obj, 'message') || getStringField(obj, 'error');
  if (direct) return direct;

  const nested = getNestedErrorMessage(obj);
  if (nested) return nested;

  const body = getResponseBodyMessage(obj);
  if (body) return body;

  try {
    return JSON.stringify(error).slice(0, 500);
  } catch {
    return unknownError;
  }
}

function getStringField(obj: Record<string, unknown>, field: string): string | null {
  const value = obj[field];
  return typeof value === 'string' && value ? value : null;
}

function getNestedErrorMessage(obj: Record<string, unknown>): string | null {
  const nested = obj.error;
  if (typeof nested === 'object' && nested !== null) {
    return getStringField(nested as Record<string, unknown>, 'message');
  }
  return null;
}

function getResponseBodyMessage(obj: Record<string, unknown>): string | null {
  if (typeof obj.responseBody !== 'string') return null;
  try {
    const body = JSON.parse(obj.responseBody);
    return body.error?.message || null;
  } catch {
    return null;
  }
}
