/**
 * FeedEmpty — first-week welcome card on the Feed tab.
 *
 * From `early-states.jsx::FeedEmptyPhone`:
 *   - Cream "WELCOME" card with terracotta uppercase label
 *   - Italic-serif headline ("Your feed fills up once people around you start logging.")
 *   - Body line + two CTAs: filled-ink "+ Log a meal", outlined "Find friends"
 *   - "WHILE YOU'RE HERE" suggested-contact rows underneath
 *
 * Suggested contacts are stubbed — the real surface gates on `is_on_napkin`
 * once contact-import lands. For now we just render the structure so the
 * empty state isn't a void.
 */
import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Spacing } from '@/constants/theme';

type Palette = typeof Colors.light;

interface Props {
    palette: Palette;
}

export function FeedEmpty({ palette }: Props) {
    const router = useRouter();

    return (
        <View style={styles.container}>
            <View
                style={[
                    styles.welcome,
                    {
                        backgroundColor: palette.surfaceJournalLow,
                        borderColor: palette.terracottaBorder,
                    },
                ]}
            >
                <Text style={[styles.kicker, { color: palette.primary }]}>
                    WELCOME
                </Text>
                <Text style={[styles.headline, { color: palette.text }]}>
                    Your feed fills up once people around you start logging.
                </Text>
                <Text style={[styles.body, { color: palette.textSecondary }]}>
                    Log your first meal — even one you ate last week from memory.
                    That&rsquo;s usually enough to pull a few friends in.
                </Text>
                <View style={styles.ctaRow}>
                    <Pressable
                        onPress={() => router.push('/(tabs)/search')}
                        style={({ pressed }) => [
                            styles.ctaFilled,
                            {
                                backgroundColor: palette.text,
                                opacity: pressed ? 0.85 : 1,
                            },
                        ]}
                    >
                        <Text style={[styles.ctaFilledText, { color: palette.textInverse }]}>
                            + LOG A MEAL
                        </Text>
                    </Pressable>
                    <Pressable
                        onPress={() => router.push('/(tabs)/search')}
                        style={({ pressed }) => [
                            styles.ctaOutlined,
                            {
                                borderColor: palette.outlineVariant,
                                opacity: pressed ? 0.7 : 1,
                            },
                        ]}
                    >
                        <Text style={[styles.ctaOutlinedText, { color: palette.textSecondary }]}>
                            FIND FRIENDS
                        </Text>
                    </Pressable>
                </View>
            </View>

            <Text style={[styles.sectionLabel, { color: palette.textMuted }]}>
                WHILE YOU&rsquo;RE HERE
            </Text>

            <View
                style={[
                    styles.contactRow,
                    {
                        borderTopColor: palette.dividerSoft,
                        borderBottomColor: palette.dividerSoft,
                    },
                ]}
            >
                <View style={[styles.contactAvatar, { backgroundColor: palette.primaryContainer }]}>
                    <Text style={styles.contactInitials}>CB</Text>
                </View>
                <View style={styles.contactBody}>
                    <Text style={[styles.contactName, { color: palette.text }]}>
                        <Text style={styles.contactItalic}>Clara Bellini</Text>
                        {' is on Napkin'}
                    </Text>
                    <Text style={[styles.contactMeta, { color: palette.textMuted }]}>
                        From your contacts · 84 logs
                    </Text>
                </View>
                <View style={[styles.followBtn, { backgroundColor: palette.text }]}>
                    <Text style={[styles.followText, { color: palette.textInverse }]}>
                        Follow
                    </Text>
                </View>
            </View>

            <View
                style={[
                    styles.contactRow,
                    {
                        borderBottomColor: palette.dividerSoft,
                        borderTopWidth: 0,
                    },
                ]}
            >
                <View style={[styles.contactAvatar, { backgroundColor: palette.primaryContainer }]}>
                    <Text style={styles.contactInitials}>JP</Text>
                </View>
                <View style={styles.contactBody}>
                    <Text style={[styles.contactName, { color: palette.text }]}>
                        <Text style={styles.contactItalic}>Julian Park</Text>
                        {' is on Napkin'}
                    </Text>
                    <Text style={[styles.contactMeta, { color: palette.textMuted }]}>
                        From your contacts · 231 logs
                    </Text>
                </View>
                <View style={[styles.followBtn, { backgroundColor: palette.text }]}>
                    <Text style={[styles.followText, { color: palette.textInverse }]}>
                        Follow
                    </Text>
                </View>
            </View>

            <Text style={[styles.terminus, { color: palette.textMuted }]}>
                — four more from your contacts —
            </Text>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        paddingHorizontal: 22,
        paddingTop: Spacing.sm,
    },
    welcome: {
        padding: 20,
        borderRadius: 12,
        borderWidth: 1,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.8,
        textTransform: 'uppercase',
    },
    headline: {
        marginTop: 8,
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 20,
        fontStyle: 'italic',
        fontWeight: '500',
        lineHeight: 26,
    },
    body: {
        marginTop: 8,
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
        lineHeight: 21,
    },
    ctaRow: {
        marginTop: 16,
        flexDirection: 'row',
        gap: Spacing.sm,
    },
    ctaFilled: {
        paddingHorizontal: 16,
        paddingVertical: 9,
        borderRadius: 9999,
    },
    ctaFilledText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 0.5,
    },
    ctaOutlined: {
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 9999,
        borderWidth: 1,
    },
    ctaOutlinedText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 0.5,
    },
    sectionLabel: {
        marginTop: 28,
        fontFamily: 'Manrope_700Bold',
        fontSize: 10,
        letterSpacing: 1.6,
    },
    contactRow: {
        marginTop: 8,
        paddingVertical: 14,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderTopWidth: 1,
        borderBottomWidth: 1,
    },
    contactAvatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    contactInitials: {
        fontFamily: 'Newsreader_400Regular_Italic',
        color: 'rgba(255,255,255,0.92)',
        fontSize: 14,
    },
    contactBody: {
        flex: 1,
        minWidth: 0,
    },
    contactName: {
        fontFamily: 'Manrope_400Regular',
        fontSize: 13,
    },
    contactItalic: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontWeight: '500',
    },
    contactMeta: {
        marginTop: 2,
        fontFamily: 'Manrope_400Regular',
        fontSize: 11,
    },
    followBtn: {
        paddingHorizontal: 14,
        paddingVertical: 6,
        borderRadius: 9999,
    },
    followText: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 11,
        letterSpacing: 0.3,
    },
    terminus: {
        marginTop: 18,
        textAlign: 'center',
        fontFamily: 'Newsreader_400Regular_Italic',
        fontStyle: 'italic',
        fontSize: 11,
    },
});
