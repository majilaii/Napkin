import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { enableDiscoveryGuide } from '@/lib/discoveryGuide';
import { PINNED_PLACES_ROUTE } from '@/lib/handoffNavigation';
import { GUIDE_CHAPTERS, INTRO_CHAPTERS } from '@/components/onboarding/guideContent';
import { GuideIllustration } from '@/components/onboarding/GuideIllustration';

import { ShareWalkthrough } from '@/components/onboarding/ShareWalkthrough';

/** Short first-run chapters and a replayable guide, limited to supported features. */
export default function WelcomeScreen() {
    const palette = Colors[useColorScheme() ?? 'light'];
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const { user, onboardedAt } = useAuth();
    const { intro, preview, topic } = useLocalSearchParams<{ intro?: string; preview?: string; topic?: string }>();
    const isIntro = intro === '1' || preview === '1';
    const supportsSharing = Platform.OS === 'ios';
    const chapters = useMemo(() => GUIDE_CHAPTERS.filter((item) => item.id !== 'sharing' || supportsSharing), [supportsSharing]);
    const introChapters = useMemo(() => INTRO_CHAPTERS.filter((item) => chapters.includes(item)), [chapters]);
    const [selected, setSelected] = useState<string | null>(() => isIntro ? introChapters[0].id : chapters.find((item) => item.id === topic)?.id ?? null);
    const scroll = useRef<ScrollView>(null);
    const chapter = chapters.find((item) => item.id === selected);
    const [demoOpen, setDemoOpen] = useState(false);
    const index = introChapters.findIndex((item) => item.id === selected);

    useEffect(() => {
        setDemoOpen(false);
        setSelected(isIntro ? introChapters[0].id : chapters.find((item) => item.id === topic)?.id ?? null);
        scroll.current?.scrollTo({ y: 0, animated: false });
    }, [isIntro, topic, chapters, introChapters]);

    useEffect(() => {
        if (intro === '1' && preview !== '1' && user?.id && typeof onboardedAt === 'string') {
            void enableDiscoveryGuide(user.id);
        }
    }, [intro, preview, user?.id, onboardedAt]);

    const select = (id: string | null) => {
        setSelected(id);
        scroll.current?.scrollTo({ y: 0, animated: false });
    };
    const close = () => {
        if (isIntro || !router.canGoBack()) router.replace(PINNED_PLACES_ROUTE);
        else router.back();
    };
    const back = () => {
        if (isIntro) select(introChapters[Math.max(0, index - 1)].id);
        else select(null);
    };

    return (
        <View style={[s.root, { backgroundColor: palette.background }]}>
            {supportsSharing ? <Modal visible={demoOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setDemoOpen(false)}>
                {demoOpen ? <ShareWalkthrough palette={palette} onClose={() => setDemoOpen(false)} onDone={() => { setDemoOpen(false); if (isIntro) select(introChapters[Math.min(index + 1, introChapters.length - 1)].id); }} /> : null}
            </Modal> : null}
            <Stack.Screen options={{ headerShown: false, gestureEnabled: !isIntro }} />
            <View style={[s.header, { paddingTop: insets.top + Spacing.sm }]}>
                {chapter && (!isIntro || index > 0) ? (
                    <Pressable onPress={back} style={s.iconButton} accessibilityRole="button" accessibilityLabel="Back">
                        <Ionicons name="chevron-back-outline" size={24} color={palette.text} />
                    </Pressable>
                ) : <View style={s.iconButton} />}
                <Text style={[Type.sectionKicker, { color: palette.primary }]}>{isIntro ? 'Welcome to Napkin' : 'The Napkin guide'}</Text>
                <Pressable onPress={close} style={s.iconButton} accessibilityRole="button" accessibilityLabel={isIntro ? 'Skip introduction' : 'Close guide'}>
                    {isIntro ? <Text style={[Type.metadata, { color: palette.textMuted }]}>Skip</Text> : <Ionicons name="close-outline" size={24} color={palette.text} />}
                </Pressable>
            </View>

            <ScrollView ref={scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
                {chapter ? (
                    <>
                        {isIntro ? (
                            <View accessible style={s.progress} accessibilityRole="progressbar" accessibilityLabel="Introduction" accessibilityValue={{ min: 0, max: introChapters.length, now: index + 1, text: `${index + 1} of ${introChapters.length}` }}>
                                {introChapters.map((item, i) => <View key={item.id} style={[s.segment, { backgroundColor: i <= index ? palette.primary : palette.ruleInkSoft }]} />)}
                            </View>
                        ) : null}
                        <Text style={[Type.sectionKicker, { color: palette.textMuted }]}>{chapter.label}</Text>
                        <Text accessibilityRole="header" style={[Type.displayLarge, s.title, { color: palette.text }]}>{chapter.title}</Text>
                        <Text style={[Type.body, s.body, { color: palette.textSecondary }]}>{chapter.body}</Text>
                        <GuideIllustration topic={chapter.id} palette={palette} />
                        {!isIntro ? <Text style={[Type.body, s.detail, { color: palette.textSecondary }]}>{chapter.detail}</Text> : null}
                        {chapter.id === 'journal' && !isIntro ? (
                            <Pressable onPress={() => router.push('/settings/privacy')} style={s.privacyLink} accessibilityRole="button">
                                <Text style={[Type.metadata, { color: palette.textMuted }]}>Profiles, pins and eligible reviews start public.</Text>
                                <Text style={[Type.metadata, { color: palette.primary }]}>Manage account visibility</Text>
                            </Pressable>
                        ) : null}
                        {chapter.id === 'tables' ? <Text style={[Type.metadata, s.detail, { color: palette.textMuted }]}>Start with your own journal. Your Table can come later.</Text> : null}
                        {chapter.id === 'tables' && !isIntro ? <Text style={[Type.metadata, s.detail, { color: palette.textMuted }]}>Your Table is private. Pins and eligible reviews may also appear on public profiles.</Text> : null}
                    </>
                ) : (
                    <>
                        <Text accessibilityRole="header" style={[Type.displayLarge, s.title, { color: palette.text }]}>Make yourself at home.</Text>
                        <Text style={[Type.body, s.body, { color: palette.textSecondary }]}>A few ways to get more out of Napkin.</Text>
                        {chapters.map((item) => (
                            <Pressable key={item.id} onPress={() => select(item.id)} style={({ pressed }) => [s.chapterRow, { backgroundColor: palette.card, opacity: pressed ? 0.85 : 1 }]} accessibilityRole="button" accessibilityLabel={item.label}>
                                <Ionicons name={item.icon} size={24} color={palette.primary} />
                                <View style={s.flex}>
                                    <Text style={[Type.editorialTitle, { color: palette.text }]}>{item.label}</Text>
                                    <Text style={[Type.metadata, { color: palette.textMuted }]}>{item.title}</Text>
                                </View>
                                <Ionicons name="chevron-forward-outline" size={20} color={palette.textMuted} />
                            </Pressable>
                        ))}
                        <Text style={[Type.metadata, s.detail, { color: palette.textMuted }]}>Come back any time from Settings.</Text>
                    </>
                )}
            </ScrollView>

            <View style={[s.footer, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}>
                        {chapter?.id === 'sharing' ? <Pressable onPress={() => setDemoOpen(true)} style={[s.demoButton, { backgroundColor: palette.primaryMuted }]} accessibilityRole="button">
                            <Ionicons name="play-outline" size={20} color={palette.primary} />
                            <Text style={[Type.body, { color: palette.primary }]}>Try the sharing demo</Text>
                        </Pressable> : null}
                {isIntro && index === introChapters.length - 1 ? (
                    <Pressable onPress={() => router.replace('/(tabs)/tables')} style={s.secondaryButton} accessibilityRole="button">
                        <Text style={[Type.body, { color: palette.primary }]}>Explore Tables</Text>
                    </Pressable>
                ) : null}
                <Pressable onPress={() => {
                    if (isIntro && index < introChapters.length - 1) select(introChapters[index + 1].id);
                    else if (isIntro || !chapter) close();
                    else router.push(chapter.route);
                }} style={({ pressed }) => [s.primary, { backgroundColor: palette.primary, opacity: pressed ? 0.85 : 1 }]} accessibilityRole="button">
                    <Text style={[Type.body, s.buttonLabel, { color: palette.textInverse }]}>
                        {isIntro ? index < introChapters.length - 1 ? 'Continue' : 'Find my first place' : chapter?.action ?? 'Back to Napkin'}
                    </Text>
                    <Ionicons name="arrow-forward-outline" size={20} color={palette.textInverse} />
                </Pressable>
            </View>
        </View>
    );
}

const s = StyleSheet.create({
    root: { flex: 1 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md, paddingBottom: Spacing.sm },
    iconButton: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    content: { padding: Spacing.lg, paddingTop: Spacing.sm, flexGrow: 1 },
    progress: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.xl },
    segment: { flex: 1, height: 2, borderRadius: Radius.full },
    title: { marginTop: Spacing.sm, marginBottom: Spacing.md },
    body: { marginBottom: Spacing.lg },
    detail: { marginTop: Spacing.lg },
    footer: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md },
    primary: { minHeight: 56, padding: Spacing.md, borderRadius: Radius.full, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.md },
    buttonLabel: { fontFamily: 'Manrope_700Bold' },
    secondaryButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.sm },
    chapterRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.lg, borderRadius: Radius.lg, marginBottom: Spacing.sm },
    flex: { flex: 1, gap: Spacing.xs },
    demoButton: { minHeight: 52, marginBottom: Spacing.md, borderRadius: Radius.full, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, padding: Spacing.sm },
    privacyLink: { minHeight: 44, marginTop: Spacing.lg, gap: Spacing.xs },
});
