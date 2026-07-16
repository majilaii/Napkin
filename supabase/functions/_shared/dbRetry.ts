export interface PostgrestResult<T> {
  data: T | null;
  error: { code?: string; message?: string } | null;
}

const RETRYABLE_TRANSACTION_CODES = new Set(["40001", "40P01"]);

/**
 * PostgreSQL aborts one participant to break serialization/deadlock cycles.
 * Re-run the whole RPC transaction a small, bounded number of times; never
 * retry authority, validation, or other application failures.
 */
export async function retryTransactionRpc<T>(
  operation: () => PromiseLike<PostgrestResult<T>>,
  options: {
    maxAttempts?: number;
    delay?: (milliseconds: number) => Promise<void>;
  } = {},
): Promise<PostgrestResult<T>> {
  const maxAttempts = Math.min(Math.max(options.maxAttempts ?? 4, 1), 6);
  const delay = options.delay ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  let result: PostgrestResult<T> = { data: null, error: null };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    result = await operation();
    if (
      !result.error || !RETRYABLE_TRANSACTION_CODES.has(result.error.code ?? "")
    ) {
      return result;
    }
    if (attempt < maxAttempts) await delay(15 * (2 ** (attempt - 1)));
  }
  return result;
}
