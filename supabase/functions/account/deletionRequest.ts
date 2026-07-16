import type { AccountDeletion, DeletionResult } from "./deletionSaga.ts";

export interface AccountDeletionRequestDeps {
  freeze(): Promise<AccountDeletion>;
  advance(deletion: AccountDeletion): Promise<DeletionResult>;
  reportDeferredError(error: unknown, deletion: AccountDeletion): void;
}

/**
 * Freeze is the account-deletion request's irreversible acceptance point.
 * Once it succeeds, later cleanup failures belong to the durable retry worker
 * and must still be acknowledged to the client so it tears down its session.
 */
export async function requestAccountDeletion(
  deps: AccountDeletionRequestDeps,
): Promise<DeletionResult> {
  const deletion = await deps.freeze();

  try {
    return await deps.advance(deletion);
  } catch (error) {
    deps.reportDeferredError(error, deletion);
    return {
      deleted: false,
      pending: true,
      state: deletion.state,
    };
  }
}
