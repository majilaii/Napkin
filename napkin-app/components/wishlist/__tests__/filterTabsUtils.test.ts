/**
 * filterTabsUtils unit tests — TICKET-124 tabbed filter sheet visibility.
 *
 * Pins the load-bearing rules:
 *  - fixed tab order Cuisine · Price · Area · Sort
 *  - Area hides with <2 cities (hideArea); Sort hides in map mode (hideSort)
 *  - default tab = first visible (always Cuisine)
 *  - a stale active tab clamps to a visible one when its tab is hidden
 */
import {
    visibleFilterTabs,
    defaultFilterTab,
    resolveActiveTab,
    FILTER_TAB_LABELS,
    type FilterTabKey,
} from '../filterTabsUtils';

describe('visibleFilterTabs', () => {
    it('shows all four tabs in fixed order with no hide flags', () => {
        expect(visibleFilterTabs({})).toEqual(['cuisine', 'price', 'area', 'sort']);
    });

    it('hides the Sort tab in map mode (hideSort)', () => {
        expect(visibleFilterTabs({ hideSort: true })).toEqual(['cuisine', 'price', 'area']);
    });

    it('hides the Area tab with <2 cities (hideArea)', () => {
        expect(visibleFilterTabs({ hideArea: true })).toEqual(['cuisine', 'price', 'sort']);
    });

    it('hides both Area and Sort (map mode, single city)', () => {
        expect(visibleFilterTabs({ hideArea: true, hideSort: true })).toEqual(['cuisine', 'price']);
    });
});

describe('defaultFilterTab', () => {
    it('is always the first visible tab (Cuisine)', () => {
        expect(defaultFilterTab({})).toBe('cuisine');
        expect(defaultFilterTab({ hideArea: true, hideSort: true })).toBe('cuisine');
    });
});

describe('resolveActiveTab', () => {
    it('keeps the active tab when it is still visible', () => {
        expect(resolveActiveTab('price', {})).toBe('price');
        expect(resolveActiveTab('area', {})).toBe('area');
    });

    it('clamps a hidden tab to the first visible one', () => {
        // Was on Sort, then entered map mode → Sort is hidden → fall back.
        expect(resolveActiveTab('sort', { hideSort: true })).toBe('cuisine');
        // Was on Area, then dropped below 2 cities → Area hidden → fall back.
        expect(resolveActiveTab('area', { hideArea: true })).toBe('cuisine');
    });
});

describe('FILTER_TAB_LABELS', () => {
    it('has a Title-case label for every tab key', () => {
        const keys: FilterTabKey[] = ['cuisine', 'price', 'area', 'sort'];
        for (const k of keys) {
            expect(FILTER_TAB_LABELS[k]).toBeTruthy();
        }
        expect(FILTER_TAB_LABELS.area).toBe('Area');
    });
});
