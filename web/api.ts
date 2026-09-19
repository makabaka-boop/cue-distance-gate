export type ApiSuccess =
  | {
      status: 'within';
      distance: number;
      k: number;
      lengths: { a: number; b: number };
    }
  | {
      status: 'exceeded';
      k: number;
      lengths: { a: number; b: number };
    };

export type ApiError = {
  status: 'error';
  error: {
    code: string;
    message: string;
    details?: Record<string, number | string>;
  };
};

export class ApiTransportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiTransportError';
  }
}

/** 调用 /api/distance；HTTP 非 2xx 时返回解析后的错误对象 */
export async function postDistance(
  a: number[],
  b: number[],
  k: number,
): Promise<{ httpStatus: number; body: ApiSuccess | ApiError }> {
  let response: Response;
  try {
    response = await fetch('/api/distance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ a, b, k }),
    });
  } catch {
    throw new ApiTransportError('无法连接复核服务，请确认 API 已启动');
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiTransportError('服务返回了无法解析的响应');
  }

  return { httpStatus: response.status, body: body as ApiSuccess | ApiError };
}
