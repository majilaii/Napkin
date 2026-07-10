import { findBookingUrl } from '../reserveLink';

describe('findBookingUrl', () => {
    // ── Tier 0: the website URL itself is a booking page ──────────────────
    it('matches an opentable /r/ venue URL directly', () => {
        expect(findBookingUrl('https://www.opentable.com/r/carbone-new-york')).toBe(
            'https://www.opentable.com/r/carbone-new-york',
        );
    });

    it('matches country-TLD opentable venue pages', () => {
        expect(findBookingUrl('https://www.opentable.com.hk/r/roganic-hong-kong')).toBe(
            'https://www.opentable.com.hk/r/roganic-hong-kong',
        );
    });

    it('does NOT match an opentable search URL', () => {
        expect(findBookingUrl('https://www.opentable.com/s?term=Kono%20Macau')).toBeNull();
    });

    it('matches a legacy opentable bare-slug venue page', () => {
        expect(findBookingUrl('https://www.opentable.com/le-bernardin')).toBe(
            'https://www.opentable.com/le-bernardin',
        );
    });

    it('does NOT match opentable marketing/region segments', () => {
        expect(findBookingUrl('https://www.opentable.com/start/home')).toBeNull();
        expect(findBookingUrl('https://www.opentable.com/blog')).toBeNull();
    });

    // ── HTML scanning ──────────────────────────────────────────────────────
    it('finds a resy venue link inside HTML', () => {
        const html = '<a href="https://resy.com/cities/ny/carbone?date=2026-07-09&seats=2">Book</a>';
        expect(findBookingUrl(html)).toBe('https://resy.com/cities/ny/carbone?date=2026-07-09&seats=2');
    });

    it('finds a sevenrooms reservations link inside HTML', () => {
        const html = '<a class="btn" href="https://www.sevenrooms.com/reservations/mono-hk">Reserve</a>';
        expect(findBookingUrl(html)).toBe('https://www.sevenrooms.com/reservations/mono-hk');
    });

    it('finds an inline.app booking link (HK/TW)', () => {
        const html = 'book at <a href="https://inline.app/booking/abc123/def456">inline</a>';
        expect(findBookingUrl(html)).toBe('https://inline.app/booking/abc123/def456');
    });

    it('finds a chope booking link', () => {
        const html = '<a href="https://book.chope.co/booking?rid=amber1808amb&source=rest">chope</a>';
        expect(findBookingUrl(html)).toBe('https://book.chope.co/booking?rid=amber1808amb&source=rest');
    });

    it('finds a tablecheck shop link', () => {
        const html = '<a href="https://www.tablecheck.com/en/shops/sushi-saito/reserve">TC</a>';
        expect(findBookingUrl(html)).toBe('https://www.tablecheck.com/en/shops/sushi-saito/reserve');
    });

    it('normalizes an opentable widget rid to a restref link', () => {
        const html =
            '<script src="//www.opentable.com/widget/reservation/loader?rid=158931&type=standard&theme=wide"></script>';
        expect(findBookingUrl(html)).toBe('https://www.opentable.com/restref/client/?rid=158931');
    });

    it('matches exploretock venue pages but not tock marketing pages', () => {
        expect(findBookingUrl('<a href="https://www.exploretock.com/alinea">Tock</a>')).toBe(
            'https://www.exploretock.com/alinea',
        );
        expect(findBookingUrl('<a href="https://www.tock.com/join">Join Tock</a>')).toBeNull();
        expect(findBookingUrl('<a href="https://www.tock.com/gift-cards">gifts</a>')).toBeNull();
        expect(findBookingUrl('<a href="https://www.exploretock.com/faq">faq</a>')).toBeNull();
    });

    it('does NOT match opentable region-index pages', () => {
        expect(findBookingUrl('https://www.opentable.com/london-restaurants')).toBeNull();
        expect(findBookingUrl('https://www.opentable.co.uk/manchester-restaurants')).toBeNull();
    });

    // ── Escaped shapes ─────────────────────────────────────────────────────
    it('finds JSON-escaped URLs (JSON-LD acceptsReservations)', () => {
        const html = '{"acceptsReservations":"https:\\/\\/www.opentable.com\\/r\\/osteria-mozza"}';
        expect(findBookingUrl(html)).toBe('https://www.opentable.com/r/osteria-mozza');
    });

    it('unescapes &amp; inside query strings', () => {
        const html = '<a href="https://resy.com/cities/ldn/fallow?date=x&amp;seats=2">book</a>';
        expect(findBookingUrl(html)).toBe('https://resy.com/cities/ldn/fallow?date=x&seats=2');
    });

    // ── Priority & misc ────────────────────────────────────────────────────
    it('prefers an opentable /r/ link over a later-priority platform', () => {
        const html = `
            <a href="https://www.exploretock.com/somewhere">tock</a>
            <a href="https://www.opentable.com/r/actual-venue">opentable</a>
        `;
        expect(findBookingUrl(html)).toBe('https://www.opentable.com/r/actual-venue');
    });

    it('returns null for HTML with no booking links', () => {
        expect(findBookingUrl('<html><body><a href="https://example.com/menu">Menu</a></body></html>')).toBeNull();
    });

    it('returns null for null/empty input', () => {
        expect(findBookingUrl(null)).toBeNull();
        expect(findBookingUrl(undefined)).toBeNull();
        expect(findBookingUrl('')).toBeNull();
    });

    it('trims trailing prose punctuation', () => {
        expect(findBookingUrl('Book us at https://www.opentable.com/r/foo-bar.')).toBe(
            'https://www.opentable.com/r/foo-bar',
        );
    });

    it('skips the sevenrooms embed.js loader and finds the real venue href', () => {
        // Ho Lee Fook regression: the widget loader appears earlier in the doc
        // than the venue links — it must not win.
        const html = `
            <script src="https://www.sevenrooms.com/reservations/embed.js"></script>
            <a href="https://www.sevenrooms.com/experiences/holeefook?tracking=tc-web">Book</a>
        `;
        expect(findBookingUrl(html)).toBe(
            'https://www.sevenrooms.com/experiences/holeefook?tracking=tc-web',
        );
    });

    it('strips numeric HTML entities riding the match (Chaat regression)', () => {
        const html = 'content=&#34;https://www.sevenrooms.com/experiences/chaathk&#34;';
        expect(findBookingUrl(html)).toBe('https://www.sevenrooms.com/experiences/chaathk');
    });
});
