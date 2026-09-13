import { assertEquals, assertRejects } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { ExtractionError } from '../_shared/importModel.ts';
import { allowsCaptionPlacesFallback, extractOptionalVision, extractionFailureDecision, runAsyncImportExtraction } from './_helpers.ts';

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

Deno.test('a successful empty model answer blocks raw-caption Places search', () => {
  assertEquals(allowsCaptionPlacesFallback('A little corner of Japan in London', true), false);
  assertEquals(allowsCaptionPlacesFallback('Known direct query without model evidence', false), true);
  assertEquals(allowsCaptionPlacesFallback(null, false), false);
});

Deno.test('optional image failure preserves real text candidates but never creates a successful empty import', async () => {
  const failure = new ExtractionError('EXTRACTION_UNAVAILABLE', 'Image request failed');
  const extracted = [{ name: 'Keiko Uchida' }];
  assertEquals(await extractOptionalVision(extracted, () => Promise.reject(failure)), []);
  assertEquals(extracted, [{ name: 'Keiko Uchida' }]);
  assertEquals(await assertRejects(() => extractOptionalVision([], () => Promise.reject(failure))), failure);
  assertEquals(await extractOptionalVision([], () => Promise.resolve(extracted)), extracted);
});
