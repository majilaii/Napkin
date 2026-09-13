import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import type { DiscoveryTopic } from '@/lib/discoveryGuide';

type Palette = typeof Colors.light;
const people = [
    { name: 'Clara', image: require('@/assets/guide/clara.jpg') },
    { name: 'Maya', image: require('@/assets/guide/maya.jpg') },
    { name: 'Julian', image: require('@/assets/guide/julian.jpg') },
];

/** Offline examples, never inserted into the viewer's real journal or Tables. */
export function GuideIllustration({ topic, palette }: { topic: DiscoveryTopic; palette: Palette }) {
    const social = topic === 'tables' || topic === 'friends';
    return (
        <View style={[s.stage, { backgroundColor: palette.surfaceJournal }]}>
            <Text style={[Type.sectionKicker, s.example, { color: palette.textMuted }]}>Example</Text>
            <View style={[s.note, Shadow.note, { backgroundColor: palette.card }]}>
                {social ? (
                    <>
                        <View style={s.people}>
                            {people.map((person) => (
                                <View key={person.name} style={s.person}>
                                    <Image source={person.image} style={[s.avatar, { backgroundColor: palette.oliveCream }]} accessible={false} />
                                    <Text style={[Type.metadata, { color: palette.textSecondary }]}>{person.name}</Text>
                                </View>
                            ))}
                        </View>
                        <Text style={[Type.displaySmall, s.center, { color: palette.text }]}>
                            {topic === 'tables' ? 'The Friday Table' : 'People you follow'}
                        </Text>
                        <View style={[s.rule, { backgroundColor: palette.ghostRule }]} />
                        <View style={s.row}>
                            <Image source={require('@/assets/guide/buvette.png')} style={s.thumb} accessible={false} />
                            <View style={s.flex}>
                                <Text style={[Type.editorialTitle, { color: palette.text }]}>Buvette</Text>
                                <Text style={[Type.metadata, { color: palette.secondary }]}>
                                    {topic === 'tables' ? '3 want to try' : 'Clara pinned a place'}
                                </Text>
                            </View>
                            <Ionicons name="bookmark-outline" size={24} color={palette.primary} />
                        </View>
                    </>
                ) : (
                    <>
                        <Image source={require('@/assets/guide/buvette.png')} style={s.photo} accessible={false} />
                        <View style={s.captionRow}>
                            <View style={s.flex}>
                                <Text style={[Type.sectionKicker, { color: palette.primary }]}>
                                    {topic === 'journal' ? 'A meal to remember' : topic === 'lists' ? 'A weekend in Paris' : 'Pinned for later'}
                                </Text>
                                <Text style={[Type.displaySmall, { color: palette.text, marginTop: Spacing.sm }]}>Buvette</Text>
                            </View>
                            <Ionicons name={topic === 'journal' ? 'book-outline' : topic === 'lists' ? 'albums-outline' : 'bookmark-outline'} size={24} color={palette.primary} />
                        </View>
                        {topic === 'journal' ? (
                            <Text style={[Type.body, { color: palette.textSecondary }]}>Mushroom toast at the bar.</Text>
                        ) : null}
                    </>
                )}
            </View>
            {topic === 'tables' ? (
                <View style={s.privacy}>
                    <Ionicons name="lock-closed-outline" size={16} color={palette.secondary} />
                    <Text style={[Type.metadata, { color: palette.secondary }]}>Your Table is a private group</Text>
                </View>
            ) : null}
        </View>
    );
}

const s = StyleSheet.create({
    stage: { borderRadius: Radius.xxl, padding: Spacing.lg, gap: Spacing.md },
    example: { textAlign: 'center' },
    note: { borderRadius: Radius.lg, padding: Spacing.md, gap: Spacing.md },
    photo: { width: '100%', height: 136, borderRadius: Radius.md },
    captionRow: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
    flex: { flex: 1 },
    people: { flexDirection: 'row', justifyContent: 'center', gap: Spacing.lg },
    person: { alignItems: 'center', gap: Spacing.sm },
    avatar: { width: 48, height: 48, borderRadius: Radius.full },
    center: { textAlign: 'center' },
    rule: { height: StyleSheet.hairlineWidth },
    row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    thumb: { width: 48, height: 56, borderRadius: Radius.sm },
    privacy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm },
});
