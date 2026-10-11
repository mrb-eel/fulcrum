/** Bounded public reads. Keep the provider name and cause on every failure. */
export async function fetchJson(url, source, options = {}, { fetchImpl = fetch, timeoutMs = 12000, retries = 1 } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.code = `HTTP_${response.status}`;
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      return await response.json();
    } catch (cause) {
      const code = cause.cause?.code ?? cause.code ?? cause.name;
      if (attempt < retries && !["EACCES", "EPERM"].includes(code) && cause.retryable !== false) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      const error = new Error(`${source}: ${["EACCES", "EPERM"].includes(code) ? "outbound connection blocked" : cause.message}.`, { cause });
      error.provider = source;
      error.code = code;
      throw error;
    }
  }
}
