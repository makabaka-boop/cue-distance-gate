import { MAX_K, MAX_LENGTH } from './distance.js';

/**
 * 入参校验。输入一律按标准 JSON 基础类型处理：
 * body 必须是对象 { a: number[], b: number[], k: number }，
 * 数组元素必须是 32 位有符号整数。
 *
 * 32 位有符号整数范围 [-2147483648, 2147483647]。
 * 注意 Number.isInteger 接受 1e30，必须额外做范围检查。
 */

export const INT32_MIN = -2147483648;
export const INT32_MAX = 2147483647;

export type ValidationError =
  | { ok: false; code: 'INVALID_BODY' }
  | { ok: false; code: 'MISSING_FIELD'; field: string }
  | { ok: false; code: 'NOT_ARRAY'; field: string }
  | { ok: false; code: 'ARRAY_TOO_LONG'; field: string }
  | { ok: false; code: 'ELEMENT_NOT_INT32'; field: string; index: number }
  | { ok: false; code: 'K_NOT_INTEGER' }
  | { ok: false; code: 'K_OUT_OF_RANGE' };

export type ValidationSuccess = {
  ok: true;
  a: number[];
  b: number[];
  k: number;
};

export type ValidationResult = ValidationSuccess | ValidationError;

/** 稳定的错误码 -> 人类可读信息（英文 code 便于程序判定，中文说明用于页面） */
export const ERROR_MESSAGES: Record<string, string> = {
  INVALID_JSON: '请求体不是合法 JSON',
  INVALID_BODY: '请求体必须是对象',
  MISSING_FIELD: '缺少必填字段',
  NOT_ARRAY: '该字段必须是数组',
  ARRAY_TOO_LONG: `数组长度不能超过 ${MAX_LENGTH}`,
  ELEMENT_NOT_INT32: '数组元素必须是 32 位有符号整数',
  K_NOT_INTEGER: 'K 必须是整数',
  K_OUT_OF_RANGE: `K 必须在 0 到 ${MAX_K} 之间`,
};

function isInt32(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= INT32_MIN &&
    value <= INT32_MAX
  );
}

export function validateRequest(body: unknown): ValidationResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, code: 'INVALID_BODY' };
  }

  const record = body as Record<string, unknown>;

  for (const field of ['a', 'b', 'k'] as const) {
    if (!(field in record)) {
      return { ok: false, code: 'MISSING_FIELD', field };
    }
  }

  for (const field of ['a', 'b'] as const) {
    const value = record[field];
    if (!Array.isArray(value)) {
      return { ok: false, code: 'NOT_ARRAY', field };
    }
    if (value.length > MAX_LENGTH) {
      return { ok: false, code: 'ARRAY_TOO_LONG', field };
    }
    for (let i = 0; i < value.length; i++) {
      if (!isInt32(value[i])) {
        return { ok: false, code: 'ELEMENT_NOT_INT32', field, index: i };
      }
    }
  }

  const k = record.k;
  if (typeof k !== 'number' || !Number.isInteger(k)) {
    return { ok: false, code: 'K_NOT_INTEGER' };
  }
  if (k < 0 || k > MAX_K) {
    return { ok: false, code: 'K_OUT_OF_RANGE' };
  }

  return {
    ok: true,
    a: record.a as number[],
    b: record.b as number[],
    k,
  };
}

/** 把校验错误展开为 { code, message, details } 形式的稳定响应负载 */
export function errorPayload(error: ValidationError): {
  code: string;
  message: string;
  details?: Record<string, number | string>;
} {
  const payload: {
    code: string;
    message: string;
    details?: Record<string, number | string>;
  } = {
    code: error.code,
    message: ERROR_MESSAGES[error.code] ?? '非法请求',
  };

  if ('field' in error) {
    payload.details = { field: error.field };
    if ('index' in error) {
      payload.details.index = error.index;
    }
  }

  return payload;
}
