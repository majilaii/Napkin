/**
 * CriticAdminRow — single row in the /admin/critics list.
 * TICKET-033
 *
 * Displays: restaurant name, publication, kind, score, author,
 * published_date, scrape_confidence, suppressed state + source link.
 *
 * "Suppress" opens SuppressionDialog.
 * "Unsuppress" fires useSetSuppressed directly (no reason required).
 */

import React, { useState } from 'react';
import {
    View,
    Text,
    Pressable,
    StyleSheet,
    Linking,
} from 'react-native';
import { Colors } from '@/constants/theme';
import { useSetSuppressed } from '@/hooks/admin/useSetSuppressed';
import { SuppressionDialog } from './SuppressionDialog';
import type { CriticAdminRow as CriticAdminRowType } from '@/types/admin';

interface Props {
    row: CriticAdminRowType;
}

function confidenceColor(confidence: number): string {
    if (confidence >= 90) return '#5c614d';  // olive — good
    if (confidence >= 70) return '#825516';  // amber — borderline
    return '#a03f28';                        // terracotta — low
}

export function CriticAdminRow({ row }: Props) {
    const [dialogOpen, setDialogOpen] = useState(false);
    const { mutate: setSuppressed, isPending } = useSetSuppressed();
    const c = Colors.light;

    function handleUnsuppress() {
        setSuppressed({ review_id: row.id, suppressed: false });
    }

    function openSourceUrl() {
        if (row.source_url) Linking.openURL(row.source_url);
    }

    const dateStr = row.published_date
        ? new Date(row.published_date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
        : null;

    const scrapedStr = new Date(row.scraped_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

    return (
        <>
            <View style={[styles.row, { backgroundColor: row.suppressed ? c.surfaceContainerLow : c.card }]}>
                {/* Header line */}
                <View style={styles.header}>
                    <Text style={[styles.restaurantName, { color: c.text }]} numberOfLines={1}>
                        {row.restaurant.name}
                    </Text>
                    {row.suppressed && (
                        <View style={[styles.badge, { backgroundColor: c.primaryMuted }]}>
                            <Text style={[styles.badgeText, { color: c.primary }]}>suppressed</Text>
                        </View>
                    )}
                </View>

                {/* Meta line */}
                <Text style={[styles.meta, { color: c.textMuted }]}>
                    {row.publication.toUpperCase()} · {row.kind}
                    {row.score ? ` · ${row.score}${row.score_out_of ? `/${row.score_out_of}` : ''}` : ''}
                    {row.author ? ` · ${row.author}` : ''}
                    {dateStr ? ` · ${dateStr}` : ''}
                </Text>

                {/* Restaurant city */}
                {row.restaurant.city && (
                    <Text style={[styles.city, { color: c.textMuted }]}>
                        {row.restaurant.city}
                    </Text>
                )}

                {/* Excerpt */}
                {row.excerpt && (
                    <Text style={[styles.excerpt, { color: c.textSecondary }]} numberOfLines={2}>
                        &ldquo;{row.excerpt}&rdquo;
                    </Text>
                )}

                {/* Footer: confidence + scraped_at + source link */}
                <View style={styles.footer}>
                    <Text style={[styles.confidence, { color: confidenceColor(row.scrape_confidence) }]}>
                        confidence {row.scrape_confidence}
                    </Text>
                    <Text style={[styles.footerMeta, { color: c.textMuted }]}>
                        scraped {scrapedStr}
                    </Text>
                    {row.source_url && (
                        <Pressable onPress={openSourceUrl}>
                            <Text style={[styles.link, { color: c.primary }]}>source ↗</Text>
                        </Pressable>
                    )}
                </View>

                {/* Suppression reason if suppressed */}
                {row.suppressed && row.suppression_reason && (
                    <Text style={[styles.suppressionNote, { color: c.textMuted }]}>
                        Note: {row.suppression_reason}
                    </Text>
                )}

                {/* Action */}
                <View style={styles.actionRow}>
                    {row.suppressed ? (
                        <Pressable
                            style={[styles.actionBtn, { backgroundColor: c.secondaryContainer }]}
                            onPress={handleUnsuppress}
                            disabled={isPending}
                        >
                            <Text style={[styles.actionBtnText, { color: c.secondary }]}>
                                {isPending ? 'Updating…' : 'Unsuppress'}
                            </Text>
                        </Pressable>
                    ) : (
                        <Pressable
                            style={[styles.actionBtn, { backgroundColor: c.primaryMuted }]}
                            onPress={() => setDialogOpen(true)}
                        >
                            <Text style={[styles.actionBtnText, { color: c.primary }]}>Suppress</Text>
                        </Pressable>
                    )}
                </View>
            </View>

            <SuppressionDialog
                row={row}
                visible={dialogOpen}
                onClose={() => setDialogOpen(false)}
            />
        </>
    );
}

const styles = StyleSheet.create({
    row: {
        marginHorizontal: 16,
        marginVertical: 6,
        borderRadius: 12,
        padding: 16,
        gap: 6,
        // Ambient shadow only
        shadowColor: '#1c1c19',
        shadowOpacity: 0.06,
        shadowRadius: 30,
        shadowOffset: { width: 0, height: 8 },
        elevation: 2,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    restaurantName: {
        flex: 1,
        fontSize: 16,
        fontWeight: '600',
    },
    badge: {
        borderRadius: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
    },
    badgeText: {
        fontSize: 11,
        fontWeight: '600',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
    },
    meta: {
        fontSize: 13,
    },
    city: {
        fontSize: 12,
    },
    excerpt: {
        fontSize: 13,
        fontStyle: 'italic',
        lineHeight: 18,
    },
    footer: {
        flexDirection: 'row',
        gap: 12,
        alignItems: 'center',
        flexWrap: 'wrap',
    },
    confidence: {
        fontSize: 12,
        fontWeight: '500',
    },
    footerMeta: {
        fontSize: 12,
    },
    link: {
        fontSize: 12,
        fontWeight: '500',
    },
    suppressionNote: {
        fontSize: 12,
        fontStyle: 'italic',
    },
    actionRow: {
        marginTop: 4,
    },
    actionBtn: {
        alignSelf: 'flex-start',
        paddingHorizontal: 14,
        paddingVertical: 7,
        borderRadius: 6,
    },
    actionBtnText: {
        fontSize: 13,
        fontWeight: '500',
    },
});
