/**
 * TICKET-250 parity: the consent prompt must name the provider the server
 * actually sends imports to. The server default lives in Deno code
 * (supabase/functions/_shared/importModel.ts); a model switch there without a
 * matching change here would show users the wrong company. This fails first.
 *
 * Production also reads an EXTRACTION_MODEL secret that overrides the default;
 * setting it to another provider needs this constant, the consent version and
 * web/legal/privacy.html changed in the same release.
 */
import fs from 'fs';
import path from 'path';

import { AI_IMPORT_CONSENT_VERSION, AI_IMPORT_PROVIDER_LABEL } from '../aiConsent';

const IMPORT_MODEL = path.resolve(__dirname, '../../../supabase/functions/_shared/importModel.ts');

function serverDefaultModel(): string {
    const source = fs.readFileSync(IMPORT_MODEL, 'utf8');
    const match = source.match(/export const EXTRACTION_MODEL_DEFAULT = '([^']+)'/);
    if (!match) throw new Error('EXTRACTION_MODEL_DEFAULT not found in importModel.ts');
    return match[1];
}

function providerOf(model: string): { label: string; id: string } {
    if (model.startsWith('gpt-')) return { label: 'OpenAI', id: 'openai' };
    if (model.startsWith('claude-')) return { label: 'Anthropic', id: 'anthropic' };
    throw new Error(`unknown provider for model ${model}`);
}

describe('AI consent provider parity', () => {
    it('names the provider of the server default extraction model', () => {
        const provider = providerOf(serverDefaultModel());
        expect(AI_IMPORT_PROVIDER_LABEL).toBe(provider.label);
        expect(AI_IMPORT_CONSENT_VERSION.endsWith(`:${provider.id}`)).toBe(true);
    });

    it('keeps the privacy policy naming the same provider', () => {
        const policy = fs.readFileSync(path.resolve(__dirname, '../../../web/legal/privacy.html'), 'utf8');
        expect(policy).toContain(`<td>${AI_IMPORT_PROVIDER_LABEL}</td>`);
    });
});
