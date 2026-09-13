import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { GuideIllustration } from './GuideIllustration';

/** The zero-Table screen explains the idea without treating solo use as lacking. */
export function TableIntroduction({ palette, onCreate, onLearn }: {
    palette: typeof Colors.light;
    onCreate: () => void;
    onLearn: () => void;
}) {
    const insets = useSafeAreaInsets();
    return (
        <ScrollView style={{ flex: 1, backgroundColor: palette.background }} contentContainerStyle={[s.content, { paddingTop: insets.top + Spacing.lg, paddingBottom: insets.bottom + 96 }]}>
            <Text style={[Type.sectionKicker, { color: palette.primary }]}>Tables</Text>
            <Text accessibilityRole="header" style={[Type.displayLarge, s.title, { color: palette.text }]}>{'Good taste,\nin good company.'}</Text>
            <Text style={[Type.body, s.body, { color: palette.textSecondary }]}>A private space for your people to keep their meals and find the next place together.</Text>
            <GuideIllustration topic="tables" palette={palette} />
            <View style={s.benefits}>
                <Benefit icon="book-outline" text="Keep your shared meal history" palette={palette} />
                <Benefit icon="chatbubble-outline" text="Remember everyone’s take" palette={palette} />
                <Benefit icon="bookmark-outline" text="See places you all want to try" palette={palette} />
            </View>
            <Pressable onPress={onCreate} style={({ pressed }) => [s.primary, { backgroundColor: palette.primary, opacity: pressed ? 0.85 : 1 }]} accessibilityRole="button">
                <Text style={[Type.body, s.bold, { color: palette.textInverse }]}>Start a Table</Text>
            </Pressable>
            <Pressable onPress={onLearn} style={s.learn} accessibilityRole="button">
                <Text style={[Type.metadata, { color: palette.primary }]}>How Tables work</Text>
            </Pressable>
            <Text style={[Type.metadata, s.center, { color: palette.textMuted }]}>Your own journal is ready whenever you are.</Text>
        </ScrollView>
    );
}

function Benefit({ icon, text, palette }: { icon: 'book-outline' | 'chatbubble-outline' | 'bookmark-outline'; text: string; palette: typeof Colors.light }) {
    return <View style={s.benefit}><Ionicons name={icon} size={24} color={palette.secondary} /><Text style={[Type.body, s.flex, { color: palette.textSecondary }]}>{text}</Text></View>;
}

const s = StyleSheet.create({
    content: { paddingHorizontal: Spacing.lg },
    title: { marginTop: Spacing.md, marginBottom: Spacing.md },
    body: { marginBottom: Spacing.lg },
    benefits: { gap: Spacing.md, paddingVertical: Spacing.lg },
    benefit: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
    flex: { flex: 1 },
    primary: { minHeight: 56, padding: Spacing.md, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
    bold: { fontFamily: 'Manrope_700Bold' },
    learn: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
    center: { textAlign: 'center' },
});
