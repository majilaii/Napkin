import type { PublicListResult } from '@/hooks/lists/useSearchPublicLists';
import { arrangePublicLists } from '../listPresentation';

function list(id: string, overrides: Partial<PublicListResult> = {}): PublicListResult {
    return {
        id,
        owner_id: 'owner-1',
        title: `List ${id}`,
        description: null,
        ranked: false,
        emoji: null,
        entry_count: 3,
        updated_at: '2026-07-09T12:00:00.000Z',
        owner_display_name: 'Jacky',
        owner_avatar_url: null,
        owner_username: 'jacky',
        cover_photo_url: null,
        ...overrides,
    };
}

describe('arrangePublicLists', () => {
    it('keeps a thin, recent list in the rail rather than presenting it as a feature', () => {
        const thin = list('thin', { entry_count: 1, cover_photo_url: 'https://example.test/a.jpg' });

        expect(arrangePublicLists([thin])).toEqual({ showcase: null, rail: [thin] });
    });

    it('promotes the first substantial list with a real cover and keeps the rest in the rail', () => {
        const plain = list('plain');
        const substantial = list('substantial', { cover_photo_url: 'https://example.test/b.jpg' });

        expect(arrangePublicLists([plain, substantial])).toEqual({
            showcase: substantial,
            rail: [plain],
        });
    });

    it('filters placeholders and empty lists before either presentation path', () => {
        const placeholder = list('placeholder', { title: ' ', entry_count: 4, cover_photo_url: 'https://example.test/c.jpg' });
        const empty = list('empty', { entry_count: 0 });

        expect(arrangePublicLists([placeholder, empty])).toEqual({ showcase: null, rail: [] });
    });
});
