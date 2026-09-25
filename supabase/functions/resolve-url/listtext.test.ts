/**
 * Pasted-text and screenshot-list routing (2026-09-25). Installed builds must
 * route exactly as before; only `source_kind: "text"` reaches the list prompt.
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
    isOwnImportUploadPath,
    routesToListText,
    routesToVideoText,
} from './_helpers.ts';

Deno.test('pasted text routes to the list reader only when the client opts in', () => {
    assertEquals(routesToListText({ source_kind: 'text', extracted_text: 'Bao, Kiln, Brat' }), true);
    assertEquals(routesToListText({ source_kind: 'text', extracted_text: '   ' }), false);
    assertEquals(routesToListText({ extracted_text: 'Bao, Kiln, Brat' }), false);
    assertEquals(routesToListText({ source_kind: 'photo', slide_count: 3, extracted_text: 'x' }), false);
});

Deno.test('installed-build bodies keep their existing routes', () => {
    // Video text (on-device OCR) and caption-only bodies still reach video text.
    assertEquals(routesToVideoText({ extracted_text: 'ocr' }), true);
    assertEquals(routesToVideoText({ caption: 'caption only' }), true);
    // Link and screenshot bodies never do.
    assertEquals(routesToVideoText({ url: 'https://example.com', caption: 'c' }), false);
    assertEquals(routesToVideoText({ image_path: 'u/f.jpg', caption: 'c' }), false);
    assertEquals(routesToListText({ image_path: 'u/f.jpg' }), false);
});

Deno.test('screenshot paths must be the caller\'s own upload, with no dot segments', () => {
    const me = '6f2c1f1e-1111-4a4a-8888-123456789abc';
    assertEquals(isOwnImportUploadPath(`${me}/1758800000000-abc123.jpg`, me), true);
    assertEquals(isOwnImportUploadPath(`other/1758800000000-abc123.jpg`, me), false);
    assertEquals(isOwnImportUploadPath(`${me}/../other/1.jpg`, me), false);
    assertEquals(isOwnImportUploadPath(`${me}/..jpg`, me), false);
    assertEquals(isOwnImportUploadPath(`${me}/nested/1.jpg`, me), false);
    assertEquals(isOwnImportUploadPath(`${me}/1.png`, me), false);
});
