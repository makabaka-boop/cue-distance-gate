export interface SequenceLengths {
  a: number;
  b: number;
}

export interface DistanceOk {
  status: 'ok';
  distance: number;
  k: number;
  lengths: SequenceLengths;
}

export interface DistanceExceeded {
  status: 'exceeded';
  k: number;
  lengths: SequenceLengths;
}

export type DistanceResponse = DistanceOk | DistanceExceeded;

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export class ApiError extends Error {
  readonly code: string;

  constructor(body: ApiErrorBody) {
    super(body.error.message);
    this.name = 'ApiError';
    this.code = body.error.code;
  }
}

export async function fetchDistance(
  a: unknown[],
  b: unknown[],
  k: number,
): Promise<DistanceResponse> {
  const res = await fetch('/api/distance', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ a, b, k }),
  });
  const body: unknown = await res.json();
  if (!res.ok) {
    throw new ApiError(body as ApiErrorBody);
  }
  return body as DistanceResponse;
}
