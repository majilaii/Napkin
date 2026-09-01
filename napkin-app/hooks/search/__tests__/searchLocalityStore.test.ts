type LocalityModule = typeof import('../searchLocalityStore');

function freshStore(): LocalityModule {
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('../searchLocalityStore') as LocalityModule;
}

describe('search locality store', () => {
    it('starts in auto after a cold module start', () => {
        const first = freshStore();
        first.searchLocalityStore.setActiveUser('user-a');
        first.searchLocalityStore.set('user-a', { city: 'Paris' });
        expect(first.searchLocalityStore.get('user-a')).toEqual({ city: 'Paris' });

        const restarted = freshStore();
        restarted.searchLocalityStore.setActiveUser('user-a');
        expect(restarted.searchLocalityStore.get('user-a')).toBe('auto');
    });

    it('clears the prior choice on every auth identity change', () => {
        const { searchLocalityStore } = freshStore();
        searchLocalityStore.setActiveUser('user-a');
        searchLocalityStore.set('user-a', { city: 'Paris' });

        searchLocalityStore.setActiveUser('user-b');
        expect(searchLocalityStore.get('user-a')).toBe('auto');
        expect(searchLocalityStore.get('user-b')).toBe('auto');

        searchLocalityStore.set('user-b', { city: 'Tokyo' });
        searchLocalityStore.setActiveUser('user-a');
        expect(searchLocalityStore.get('user-a')).toBe('auto');
        expect(searchLocalityStore.get('user-b')).toBe('auto');
    });

    it('keeps a choice when the same identity is rebound', () => {
        const { searchLocalityStore } = freshStore();
        searchLocalityStore.setActiveUser('user-a');
        searchLocalityStore.set('user-a', { city: '  New   York  ' });
        searchLocalityStore.setActiveUser('user-a');
        expect(searchLocalityStore.get('user-a')).toEqual({ city: 'New York' });
    });

    it('normalizes city cache buckets', () => {
        const { cityLocalityBucket } = freshStore();
        expect(cityLocalityBucket('  New   York  ')).toBe('city:new york');
        expect(cityLocalityBucket('   ')).toBeNull();
    });

    it('derives the visible label for city, coordinates, and home-city auto states', () => {
        const { searchLocalityLabel } = freshStore();
        expect(searchLocalityLabel({ city: ' Paris, France ' }, true, 'London')).toBe('paris');
        expect(searchLocalityLabel('auto', true, 'London')).toBe('current location');
        expect(searchLocalityLabel('auto', false, ' London, United Kingdom ')).toBe('london');
        expect(searchLocalityLabel('auto', false, null)).toBe('anywhere');
    });
});
