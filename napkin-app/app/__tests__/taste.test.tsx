import React from 'react';
// @ts-expect-error react-test-renderer ships no types in this project.
import TestRenderer, { act } from 'react-test-renderer';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let mockParams: { userId?: string } = {};
let mockTasteResult: any;
let mockSpotsResult: any;
const mockUseUserTaste = jest.fn((_identifier?: string) => mockTasteResult);
const mockUseUserSpots = jest.fn((_identifier?: string) => mockSpotsResult);

jest.mock('react-native', () => ({
    Platform: { OS: 'ios', select: (options: any) => options.ios ?? options.default },
    View: 'View',
    Text: 'Text',
    ScrollView: 'ScrollView',
    ActivityIndicator: 'ActivityIndicator',
    Pressable: 'Pressable',
    StyleSheet: {
        hairlineWidth: 1,
        create: (styles: unknown) => styles,
    },
}));
jest.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));
jest.mock('expo-router', () => ({
    Stack: { Screen: 'StackScreen' },
    useLocalSearchParams: () => mockParams,
    useRouter: () => ({ back: jest.fn() }),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('@/hooks/use-color-scheme', () => ({ useColorScheme: () => 'light' }));
jest.mock('@/providers/AuthProvider', () => ({
    useAuth: () => ({ user: { id: 'viewer-id' } }),
}));
jest.mock('@/hooks/users/useUserTaste', () => ({
    useUserTaste: (identifier: string | undefined) => mockUseUserTaste(identifier),
}));
jest.mock('@/hooks/users/useUserSpots', () => ({
    useUserSpots: (identifier: string | undefined) => mockUseUserSpots(identifier),
    deriveTasteEmblemInput: (spots: any[]) => {
        const cities = new Set(spots.map((spot) => spot.city).filter(Boolean));
        const countries = new Set(spots.map((spot) => spot.country).filter(Boolean));
        return {
            totalMeals: spots.reduce((sum, spot) => sum + spot.visit_count, 0),
            totalPlaces: spots.length,
            cityCount: cities.size,
            countryCount: countries.size,
        };
    },
}));

// Mocks must be installed before importing the screen.
// eslint-disable-next-line import/first
import TasteScreen from '../taste';

const emptyTaste = {
    entry_count: 0,
    overall_avg: null,
    categories: {
        flavor: { avg: null, n: 0 },
        service: { avg: null, n: 0 },
        value: { avg: null, n: 0 },
        vibe: { avg: null, n: 0 },
    },
    top_cuisines: [],
    bottom_cuisines: [],
    rating_histogram: [],
};

function renderedText(renderer: any): string {
    return renderer.root
        .findAllByType('Text')
        .flatMap((node: any) => node.props.children)
        .filter((child: unknown) => typeof child === 'string')
        .join(' ');
}

describe('/taste', () => {
    beforeEach(() => {
        mockParams = {};
        mockTasteResult = { data: emptyTaste, isLoading: false, isError: false };
        mockSpotsResult = { data: [], isLoading: false, isError: false };
        mockUseUserTaste.mockClear();
        mockUseUserSpots.mockClear();
    });

    it('uses the signed-in user when no canonical userId param is supplied', () => {
        mockTasteResult = { data: undefined, isLoading: true, isError: false };
        mockSpotsResult = { data: undefined, isLoading: true, isError: false };
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<TasteScreen />); });

        expect(mockUseUserTaste).toHaveBeenCalledWith('viewer-id');
        expect(mockUseUserSpots).toHaveBeenCalledWith('viewer-id');
        expect(renderedText(renderer)).toContain('Your taste');
        expect(renderer.root.findAllByType('ActivityIndicator')).toHaveLength(1);
    });

    it('forwards a public userId and gives an unrated journal an intentional pending emblem', () => {
        mockParams = { userId: 'friend-id' };
        mockSpotsResult = {
            data: [{
                restaurant_id: 'r1',
                name: 'Somewhere',
                city: null,
                country: null,
                cuisine: 'Ramen',
                price_level: null,
                lat: null,
                lng: null,
                photo_url: null,
                visit_count: 1,
                avg_rating: null,
                last_visited_at: null,
            }],
            isLoading: false,
            isError: false,
        };
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<TasteScreen />); });

        expect(mockUseUserTaste).toHaveBeenCalledWith('friend-id');
        expect(mockUseUserSpots).toHaveBeenCalledWith('friend-id');
        const text = renderedText(renderer);
        expect(text).toContain('Taste');
        expect(text).not.toContain('Your taste');
        expect(text).toContain('Taking shape');
        expect(text).toContain('More public journal activity will reveal it.');
    });

    it('shows a deliberate error state when either privacy-gated request fails', () => {
        mockParams = { userId: 'friend-id' };
        mockTasteResult = { data: undefined, isLoading: false, isError: true };
        let renderer: any;
        act(() => { renderer = TestRenderer.create(<TasteScreen />); });

        expect(renderedText(renderer)).toContain("couldn't load this taste just now.");
    });
});
