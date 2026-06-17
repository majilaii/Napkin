import { NativeModule, requireNativeModule } from 'expo';

import type { ExtractResult } from './MediaExtract.types';

declare class MediaExtractModule extends NativeModule<{}> {
    /**
     * Native (positional) signature — call the ergonomic `extractFromVideo`
     * wrapper exported from the module index instead.
     */
    extractFromVideo(
        uri: string,
        maxFrames: number,
        fps: number,
        transcribe: boolean,
    ): Promise<ExtractResult>;
}

export default requireNativeModule<MediaExtractModule>('MediaExtract');
