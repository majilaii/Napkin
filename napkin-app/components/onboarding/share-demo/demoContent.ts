/** Bundled, fictional editorial example. Never passed to an import or save API. */
export type DemoSource = 'TikTok' | 'Instagram';
export const DEMO_ICON = require('@/assets/images/icon.png');
export const DEMO_CLIPS = {
    TikTok: require('@/assets/onboarding/tiktok-crudo.png'),
    Instagram: require('@/assets/onboarding/reel-kitchen.png'),
};
export const DEMO_SPOTS = [
    { name: 'Barrafina', detail: 'Spanish · Dean Street', x: 0.68, y: 0.24 },
    { name: 'Kiln', detail: 'Thai · Brewer Street', x: 0.26, y: 0.55 },
    { name: 'Bocca di Lupo', detail: 'Italian · Archer Street', x: 0.57, y: 0.72 },
];

// Artwork tokens for external-app facsimiles. These deliberately use system
// type and the source app's chrome; Napkin surfaces use constants/theme.ts.
export const ExternalUI = {
    background: '#101010', sheet: '#242426', raised: '#333336', field: '#303034',
    white: '#ffffff', muted: '#bdbdc4', rule: '#414145', pink: '#fe2c55',
    teal: '#25f4ee', green: '#25d366', blue: '#1687fa',
    shadow: 'rgba(0,0,0,0.45)', scrim: 'rgba(0,0,0,0.32)',
    clear: 'rgba(0,0,0,0)', ring: 'rgba(255,255,255,0.78)',
};
