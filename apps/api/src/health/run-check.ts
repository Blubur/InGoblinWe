import { describeError } from '@goblins/core';

export interface CheckResult {
  ok: boolean;
  latencyMs: number;
  error?: string;
}

/** Ejecuta una sonda con límite de tiempo y devuelve un resultado, nunca lanza. */
export async function runCheck(probe: () => Promise<unknown>, timeoutMs = 2_000): Promise<CheckResult> {
  const started = performance.now();
  const elapsed = (): number => Math.round(performance.now() - started);
  let timer: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      probe(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`sin respuesta tras ${timeoutMs} ms`)), timeoutMs);
      }),
    ]);
    return { ok: true, latencyMs: elapsed() };
  } catch (error) {
    return { ok: false, latencyMs: elapsed(), error: describeError(error) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
