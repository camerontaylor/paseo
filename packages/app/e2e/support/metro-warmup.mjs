const DEFAULT_METRO_WARMUP_TIMEOUT_MS = 120_000;
const MAX_METRO_WARMUP_TIMEOUT_MS = 600_000;

/** Keep the override finite so a wedged bundle cannot hold CI indefinitely. */
export function resolveMetroWarmupTimeoutMs(raw = process.env.E2E_METRO_WARMUP_TIMEOUT_MS) {
  if (raw === undefined) return DEFAULT_METRO_WARMUP_TIMEOUT_MS;
  if (!/^[1-9]\d*$/.test(raw)) {
    throw new Error("E2E_METRO_WARMUP_TIMEOUT_MS must be a positive integer in milliseconds");
  }
  const timeoutMs = Number(raw);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs > MAX_METRO_WARMUP_TIMEOUT_MS) {
    throw new Error(`E2E_METRO_WARMUP_TIMEOUT_MS must be at most ${MAX_METRO_WARMUP_TIMEOUT_MS}ms`);
  }
  return timeoutMs;
}

/** @param {number} port
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch }} [options]
 */
export async function warmMetro(port, options = {}) {
  const timeoutMs = options.timeoutMs ?? resolveMetroWarmupTimeoutMs();
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > MAX_METRO_WARMUP_TIMEOUT_MS
  ) {
    throw new Error(`Metro warmup timeout must be between 1 and ${MAX_METRO_WARMUP_TIMEOUT_MS}ms`);
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const origin = `http://127.0.0.1:${port}`;
  const documentResponse = await fetchResource(fetchImpl, origin, "/", timeoutMs);
  if (!documentResponse.response.ok) {
    throw new Error(`Metro document warmup failed with HTTP ${documentResponse.response.status}`);
  }
  let document;
  try {
    document = await documentResponse.response.text();
  } catch (error) {
    if (documentResponse.signal.aborted) {
      throw timeoutError("/", documentResponse.started, timeoutMs, 0);
    }
    throw error;
  }
  const scriptSources = [...document.matchAll(/<script[^>]+src=["']([^"']+)["']/g)].map(
    (match) => match[1],
  );
  if (scriptSources.length === 0) {
    throw new Error("Metro document warmup found no scripts to compile");
  }
  for (const source of scriptSources) {
    const scriptUrl = new URL(source, origin);
    if (scriptUrl.origin !== origin) continue;
    const { response, signal, started } = await fetchResource(
      fetchImpl,
      scriptUrl,
      scriptUrl.pathname,
      timeoutMs,
    );
    if (!response.ok) {
      throw new Error(
        `Metro bundle warmup failed for ${scriptUrl.pathname}: HTTP ${response.status}`,
      );
    }
    await drainBundle(response, scriptUrl.pathname, signal, started, timeoutMs);
  }
}

async function drainBundle(response, pathname, signal, started, timeoutMs) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error(`Metro bundle warmup has no response body for ${pathname}`);
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      bytes += chunk.value.byteLength;
    }
  } catch (error) {
    if (signal.aborted) throw timeoutError(pathname, started, timeoutMs, bytes);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function fetchResource(fetchImpl, url, pathname, timeoutMs) {
  const signal = AbortSignal.timeout(timeoutMs);
  const started = Date.now();
  try {
    return { response: await fetchImpl(url, { signal }), signal, started };
  } catch (error) {
    if (signal.aborted) throw timeoutError(pathname, started, timeoutMs, 0);
    throw error;
  }
}

function timeoutError(pathname, started, timeoutMs, bytes) {
  return new Error(
    `Metro warmup timed out for ${pathname} after ${Date.now() - started}ms (${bytes} bytes received; limit ${timeoutMs}ms)`,
  );
}
