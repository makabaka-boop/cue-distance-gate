/**
 * Request validation for the distance API.
 *
 * Inputs are plain JSON values (no text formats are interpreted): two
 * arrays of 32-bit signed integers plus an integer threshold k.
 * Every rejection uses a stable error code so clients and the acceptance
 * suite can rely on it.
 */

export const LIMITS = {
  MAX_ARRAY_LENGTH: 50_000,
  MAX_K: 500,
  INT32_MIN: -2_147_483_648,
  INT32_MAX: 2_147_483_647,
} as const;

export type ErrorCode =
  | 'INVALID_JSON'
  | 'INVALID_BODY'
  | 'INVALID_ELEMENT'
  | 'ARRAY_TOO_LONG'
  | 'INVALID_K'
  | 'PAYLOAD_TOO_LARGE'
  | 'INTERNAL';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly statusCode: number;

  constructor(code: ErrorCode, message: string, statusCode = 400) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface CompareRequest {
  a: number[];
  b: number[];
  k: number;
}

export function parseCompareBody(body: unknown): CompareRequest {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new ApiError(
      'INVALID_BODY',
      'Request body must be a JSON object with fields "a", "b" and "k".',
    );
  }

  const { a, b, k } = body as Record<string, unknown>;
  return {
    a: parseInt32Array(a, 'a'),
    b: parseInt32Array(b, 'b'),
    k: parseK(k),
  };
}

function parseInt32Array(value: unknown, field: 'a' | 'b'): number[] {
  if (!Array.isArray(value)) {
    throw new ApiError(
      'INVALID_BODY',
      `Field "${field}" must be an array of 32-bit signed integers.`,
    );
  }
  if (value.length > LIMITS.MAX_ARRAY_LENGTH) {
    throw new ApiError(
      'ARRAY_TOO_LONG',
      `Field "${field}" has ${value.length} elements; the maximum is ${LIMITS.MAX_ARRAY_LENGTH}.`,
    );
  }
  for (let i = 0; i < value.length; i++) {
    const v = value[i];
    if (
      typeof v !== 'number' ||
      !Number.isInteger(v) ||
      v < LIMITS.INT32_MIN ||
      v > LIMITS.INT32_MAX
    ) {
      throw new ApiError(
        'INVALID_ELEMENT',
        `Element "${field}[${i}]" must be a 32-bit signed integer.`,
      );
    }
  }
  return value as number[];
}

function parseK(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > LIMITS.MAX_K
  ) {
    throw new ApiError(
      'INVALID_K',
      `Field "k" must be an integer between 0 and ${LIMITS.MAX_K}.`,
    );
  }
  return value;
}
