import { useMemo, useState } from 'react';
import {
  ApiTransportError,
  postDistance,
  type ApiError,
  type ApiSuccess,
} from './api.js';

const DEMO_A = '[1, 2, 3, 5, 8, 13, 21, 34]';
const DEMO_B = '[1, 2, 4, 5, 8, 13, 34, 55]';

type ParsedInput =
  | { ok: true; value: unknown }
  | { ok: false; message: string };

/** 前端仅做 JSON 语法层面的预判；业务合法性（int32、长度、K）以 API 为准 */
function parseJsonText(text: string): ParsedInput {
  if (text.trim().length === 0) {
    return { ok: false, message: '内容为空' };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, message: '非法 JSON（仅接受标准 JSON，不解析文本格式）' };
  }
}

function isInt32Array(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'number' &&
        Number.isInteger(item) &&
        item >= -2147483648 &&
        item <= 2147483647,
    )
  );
}

type Outcome =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'within'; body: Extract<ApiSuccess, { status: 'within' }> }
  | { kind: 'exceeded'; body: Extract<ApiSuccess, { status: 'exceeded' }> }
  | { kind: 'error'; httpStatus: number; error: ApiError['error'] }
  | { kind: 'transport'; message: string };

export function App() {
  const [textA, setTextA] = useState(DEMO_A);
  const [textB, setTextB] = useState(DEMO_B);
  const [textK, setTextK] = useState('4');
  const [outcome, setOutcome] = useState<Outcome>({ kind: 'idle' });

  const clientIssue = useMemo(() => {
    const parsedA = parseJsonText(textA);
    if (!parsedA.ok) return { where: '计划 cue 序列 a', message: parsedA.message };

    const parsedB = parseJsonText(textB);
    if (!parsedB.ok) return { where: '现场触发序列 b', message: parsedB.message };

    if (!isInt32Array(parsedA.value)) {
      return {
        where: '计划 cue 序列 a',
        message: '必须是 32 位有符号整数的 JSON 数组',
      };
    }
    if (!isInt32Array(parsedB.value)) {
      return {
        where: '现场触发序列 b',
        message: '必须是 32 位有符号整数的 JSON 数组',
      };
    }
    if (parsedA.value.length > 50_000 || parsedB.value.length > 50_000) {
      return { where: '数组', message: '数组各不超过 50000 项' };
    }

    const k = Number(textK);
    if (!Number.isInteger(k) || k < 0 || k > 500) {
      return { where: '阈值 K', message: 'K 必须是 0 至 500 的整数' };
    }

    return null;
  }, [textA, textB, textK]);

  async function handleCheck(): Promise<void> {
    if (clientIssue) return;
    const a = JSON.parse(textA) as number[];
    const b = JSON.parse(textB) as number[];
    const k = Number(textK);

    setOutcome({ kind: 'loading' });
    try {
      const { httpStatus, body } = await postDistance(a, b, k);
      if (body.status === 'error') {
        setOutcome({ kind: 'error', httpStatus, error: body.error });
      } else if (body.status === 'within') {
        setOutcome({ kind: 'within', body });
      } else {
        setOutcome({ kind: 'exceeded', body });
      }
    } catch (err) {
      const message =
        err instanceof ApiTransportError ? err.message : '未知网络错误';
      setOutcome({ kind: 'transport', message });
    }
  }

  return (
    <main className="page">
      <header className="page-header">
        <h1>Cue 偏差复核台</h1>
        <p className="subtitle">
          计划序列与现场触发序列的有界插入/删除距离 · 插入删除各计 1，替换计 2 ·
          数组 ≤ 50000 项，K ∈ [0, 500]
        </p>
      </header>

      <section className="editors">
        <label className="editor">
          <span className="editor-title">计划 cue 序列 a（JSON 整数数组）</span>
          <textarea
            value={textA}
            onChange={(event) => setTextA(event.target.value)}
            spellCheck={false}
            rows={14}
          />
        </label>
        <label className="editor">
          <span className="editor-title">现场触发序列 b（JSON 整数数组）</span>
          <textarea
            value={textB}
            onChange={(event) => setTextB(event.target.value)}
            spellCheck={false}
            rows={14}
          />
        </label>
      </section>

      <section className="controls">
        <label className="k-control">
          <span>容许偏差 K</span>
          <input
            type="number"
            min={0}
            max={500}
            step={1}
            value={textK}
            onChange={(event) => setTextK(event.target.value)}
          />
        </label>
        <button
          type="button"
          onClick={() => void handleCheck()}
          disabled={clientIssue !== null || outcome.kind === 'loading'}
        >
          {outcome.kind === 'loading' ? '复核中…' : '执行偏差复核'}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setTextA('[]');
            setTextB('[]');
          }}
        >
          清空为 []
        </button>
      </section>

      {clientIssue && (
        <div className="result result-error" role="alert">
          <strong>输入预检失败（{clientIssue.where}）：</strong>
          {clientIssue.message}
        </div>
      )}

      <ResultPanel outcome={outcome} />
    </main>
  );
}

function ResultPanel({ outcome }: { outcome: Outcome }) {
  if (outcome.kind === 'idle') {
    return (
      <div className="result result-idle">
        填入两个 JSON 整数数组与阈值 K 后执行复核，将给出可复核的精确距离或超限信号。
      </div>
    );
  }
  if (outcome.kind === 'loading') {
    return <div className="result result-idle">正在计算…</div>;
  }
  if (outcome.kind === 'within') {
    const { distance, k, lengths } = outcome.body;
    return (
      <div className="result result-within" role="status">
        <div className="verdict">偏差距离 = {distance}</div>
        <div className="detail">
          距离 {distance} ≤ K {k}，偏差仍在容许范围（a {lengths.a} 项 / b{' '}
          {lengths.b} 项）。
        </div>
      </div>
    );
  }
  if (outcome.kind === 'exceeded') {
    const { k, lengths } = outcome.body;
    return (
      <div className="result result-exceeded" role="status">
        <div className="verdict">exceeded（真实距离 &gt; {k}）</div>
        <div className="detail">
          偏差已超出容许范围（a {lengths.a} 项 / b {lengths.b} 项），
          仅返回超限信号，不计算完整距离。
        </div>
      </div>
    );
  }
  if (outcome.kind === 'error') {
    const { code, message, details } = outcome.error;
    return (
      <div className="result result-error" role="alert">
        <div className="verdict">
          请求被拒绝（HTTP {outcome.httpStatus} · {code}）
        </div>
        <div className="detail">
          {message}
          {details ? `（${Object.entries(details)
            .map(([key, value]) => `${key}: ${value}`)
            .join('，')}）` : ''}
        </div>
      </div>
    );
  }
  return (
    <div className="result result-error" role="alert">
      <div className="verdict">连接失败</div>
      <div className="detail">{outcome.message}</div>
    </div>
  );
}
