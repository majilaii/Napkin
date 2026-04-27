/**
 * Wire types for the critics-admin edge function.
 * TICKET-033
 *
 * CriticAdminRow mirrors what critics-admin?action=list returns:
 * full critic columns + joined restaurant { id, name, city }.
 *
 * Note: audit columns (suppressed_by, suppressed_at, suppression_reason)
 * are NOT available via the normal authenticated SELECT path (column-level
 * revoke applied in the migration). They are returned here because the
 * admin surface calls via the edge function which uses service role.
 */

export interface CriticAdminRow {
    id: string;
    publication: string;
    kind: 'stars' | 'score' | 'essential' | 'feature';
    score: string | null;
    score_out_of: string | null;
    author: string | null;
    published_date: string | null;
    excerpt: string | null;
    source_url: string | null;
    scraped_at: string;
    scrape_confidence: number;
    suppressed: boolean;
    suppressed_by: string | null;
    suppressed_at: string | null;
    suppression_reason: string | null;
    last_seen_on_source_at: string | null;
    restaurant: {
        id: string;
        name: string;
        city: string | null;
    };
}

export interface SetSuppressedResult {
    id: string;
    suppressed: boolean;
    suppressed_by: string | null;
    suppressed_at: string | null;
    suppression_reason: string | null;
}
