import { registerWebModule, NativeModule } from 'expo';

import type { ExtractResult } from './MediaExtract.types';

// media-extract is iOS-only (Vision + Speech). Web/Android throw if called.
class MediaExtractModule extends NativeModule<{}> {
    async extractFromVideo(): Promise<ExtractResult> {
        throw new Error('media-extract is only available on iOS');
    }
}

export default registerWebModule(MediaExtractModule, 'MediaExtractModule');
