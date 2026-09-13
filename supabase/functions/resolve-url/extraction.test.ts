import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { ExtractionError } from '../_shared/importModel.ts';
import { extractionFailureDecision, runAsyncImportExtraction } from './_helpers.ts';

Deno.test('background extraction settles placeholders before exposing a typed provider error', async () => {
  const failure = new ExtractionError('EXTRACTION_UNAVAILABLE', 'Provider unavailable');
  const state = { job: 'pending', wishlist: 'pending', share: 'pending' };
  const caught = await assertRejects(() => runAsyncImportExtraction(
    () => Promise.reject(failure),
    () => {
      // The injected production callback invokes the existing transactional RPC.
      Object.assign(state, { job: 'failed', wishlist: 'failed', share: 'failed' });
      return Promise.resolve();
    },
  ));
  assertEquals(state, { job: 'failed', wishlist: 'failed', share: 'failed' });
  assertEquals(caught, failure);
  assertEquals(extractionFailureDecision(caught), {
    code: 'EXTRACTION_UNAVAILABLE', message: 'Provider unavailable', status: 502,
  });
});

Deno.test('successful empty extraction is not a failed background job', async () => {
  let failed = false;
  assertEquals(await runAsyncImportExtraction(
    () => Promise.resolve([]),
    () => { failed = true; return Promise.resolve(); },
  ), []);
  assertEquals(failed, false);
});

Deno.test('failed completion RPC cannot report success', async () => {
  const databaseFailure = new Error('Completion failed');
  const caught = await assertRejects(() => runAsyncImportExtraction(
    () => Promise.reject(new ExtractionError('EXTRACTION_INVALID', 'Invalid answer')),
    () => Promise.reject(databaseFailure),
  ));
  assertEquals(caught, databaseFailure);
  assertEquals(extractionFailureDecision(caught), null); // caller returns INTERNAL 500
});

Deno.test('configuration, explicit abort and default deadline map to service-error envelopes', () => {
  assertEquals(extractionFailureDecision(new ExtractionError('EXTRACTION_NOT_CONFIGURED', 'Missing credential'))?.status, 503);
  for (const name of ['AbortError', 'TimeoutError']) {
    assertEquals(extractionFailureDecision(new DOMException('Expired', name)), {
      code: 'TIMEOUT', message: 'Import extraction timed out', status: 503,
    });
  }
  assertEquals(extractionFailureDecision(null), null);
});
