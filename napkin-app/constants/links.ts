/**
 * Outbound links. Single home so copy/config edits don't hunt through screens.
 */

/**
 * Public TestFlight invite link — powers the "invite" share sheet on a
 * brand-new table. Create one in App Store Connect (TestFlight → Public Link)
 * and paste it here; until then the share message goes out without a URL.
 */
export const TESTFLIGHT_INVITE_URL: string | null = null;

/**
 * Legal + support pages (TICKET-090) — static site deployed on Vercel from
 * web/legal/. These same URLs go into App Store Connect (App Privacy /
 * Support URL fields).
 */
export const LEGAL_URLS = {
    privacy: 'https://napkin-legal.vercel.app/privacy.html',
    terms: 'https://napkin-legal.vercel.app/terms.html',
    support: 'https://napkin-legal.vercel.app/support.html',
} as const;

/** Where report/abuse + account questions land (also on the support page). */
export const SUPPORT_EMAIL = 'jackyieong@mainrichinternational.com';
