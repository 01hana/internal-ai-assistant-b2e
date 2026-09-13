import { performance } from 'node:perf_hooks';

export class InvocationMonotonicClock {
  nowMilliseconds(): number { return performance.now(); }
}

export class LocalInvocationDeadline {
  readonly timeoutMs: number;
  constructor(remainingBudgetMs: number, manifestTimeoutMs: number, elapsedMs = 0) {
    const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : remainingBudgetMs;
    this.timeoutMs = Math.max(0, Math.min(4_500, manifestTimeoutMs, remainingBudgetMs - elapsed - 250));
  }
}

export function combineAbortSignals(signals: readonly AbortSignal[], timeoutMs?: number): Readonly<{ signal: AbortSignal; dispose(): void }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of signals) {
    if (signal.aborted) controller.abort(); else signal.addEventListener('abort', abort, { once: true });
  }
  const timer = timeoutMs === undefined ? undefined : setTimeout(abort, Math.max(0, timeoutMs));
  return Object.freeze({ signal: controller.signal, dispose: () => {
    if (timer) clearTimeout(timer);
    for (const signal of signals) signal.removeEventListener('abort', abort);
  } });
}
