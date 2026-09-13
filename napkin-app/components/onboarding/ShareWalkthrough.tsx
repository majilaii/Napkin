import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, useReducedMotion } from 'react-native-reanimated';
import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';

type Palette = typeof Colors.light;
type Source = 'TikTok' | 'Instagram';
const ICON = require('@/assets/images/icon.png');
const CLIPS = {
    TikTok: require('@/assets/onboarding/tiktok-crudo.png'),
    Instagram: require('@/assets/onboarding/reel-kitchen.png'),
};
const SPOTS = ['Matchado', 'TSUJIRI', 'Frothee'];
const TITLES = ['A good find starts here.', 'Send it a little further.', 'Find Napkin.', 'A place for your finds.', 'Ready when you are.', 'Keep the places you want.', 'From your feed to your map.'];
const CAPTIONS = [
    'Tap the video’s Share button.',
    'Choose More to open the iPhone share sheet.',
    'Choose Napkin. If it’s hidden, look under More.',
    'Add the clip for review, then carry on watching.',
    'Open Napkin and find the clip in Places.',
    'Review the restaurants, then save your picks.',
    'Your saved restaurants are ready to find again.',
];

/** Local rehearsal only: no import, queue, account, native Share or network access. */
export function ShareWalkthrough({ palette, onClose, onDone }: { palette: Palette; onClose: () => void; onDone: () => void }) {
    const insets = useSafeAreaInsets();
    const reduced = useReducedMotion();
    const [step, setStep] = useState(0);
    const [source, setSource] = useState<Source>('TikTok');
    const [more, setMore] = useState(false);
    const [selected, setSelected] = useState(SPOTS);
    const next = () => { setMore(false); setStep((current) => Math.min(current + 1, TITLES.length - 1)); };
    useEffect(() => { AccessibilityInfo.announceForAccessibility(`${TITLES[step]} ${CAPTIONS[step]}`); }, [step]);
    const action = (label: string, onPress: () => void, disabled = false) => (
        <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress}
            style={({ pressed }) => [s.action, { backgroundColor: palette.primary, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }]}>
            <Text style={[Type.body, s.bold, { color: palette.textInverse }]}>{label}</Text>
            <Ionicons name="arrow-forward-outline" size={20} color={palette.textInverse} />
        </Pressable>
    );
    return (
        <View style={[s.root, { backgroundColor: palette.background, paddingTop: insets.top }]}>
            <View style={s.header}>
                <Pressable onPress={() => { setMore(false); setStep((current) => Math.max(current - 1, 0)); }} disabled={step === 0} accessibilityRole="button" accessibilityLabel="Previous demo step" accessibilityState={{ disabled: step === 0 }} style={[s.iconButton, { opacity: step ? 1 : 0 }]}>
                    <Ionicons name="arrow-back-outline" size={24} color={palette.text} />
                </Pressable>
                <Text style={[Type.sectionKicker, { color: palette.primary }]}>Try it · example only</Text>
                <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close sharing demo" style={s.iconButton}><Ionicons name="close-outline" size={24} color={palette.text} /></Pressable>
            </View>
            <ScrollView key={step} contentContainerStyle={s.content} showsVerticalScrollIndicator>
                <View accessible accessibilityRole="progressbar" accessibilityLabel="Sharing demo" accessibilityValue={{ min: 1, max: TITLES.length, now: step + 1 }} style={s.progress}>
                    {TITLES.map((title, i) => <View key={title} style={[s.segment, { backgroundColor: i <= step ? palette.primary : palette.ruleInkSoft }]} />)}
                </View>
                <Text accessibilityRole="header" style={[Type.displayLarge, s.title, { color: palette.text }]}>{TITLES[step]}</Text>
                <Text style={[Type.body, s.caption, { color: palette.textSecondary }]}>{CAPTIONS[step]}</Text>
                <Animated.View key={`${step}-${source}`} entering={reduced ? undefined : FadeIn.duration(180)}>
                    {step === 0 ? <>
                        <View accessibilityRole="tablist" style={[s.sources, { backgroundColor: palette.surfaceJournal }]}>
                            {(['TikTok', 'Instagram'] as const).map((item) => <Pressable key={item} onPress={() => setSource(item)} accessibilityRole="tab" accessibilityState={{ selected: item === source }} style={[s.source, { backgroundColor: item === source ? palette.card : undefined }]}>
                                <Ionicons name={item === 'TikTok' ? 'logo-tiktok' : 'logo-instagram'} size={20} color={palette.text} />
                                <Text style={[Type.metadata, { color: palette.text }]}>{item}</Text>
                            </Pressable>)}
                        </View>
                        <View style={[s.video, { backgroundColor: palette.surfaceJournal }]}>
                            <Image source={CLIPS[source]} style={s.fillPhoto} resizeMode="cover" accessible={false} />
                            <View style={[s.videoShade, { backgroundColor: palette.overlayPhoto }]} />
                            <View style={s.videoTop}><Text style={[Type.sectionKicker, { color: palette.textOnImage }]}>Your next good meal</Text></View>
                            <View style={s.videoBottom}>
                                <Text style={[Type.displaySmall, s.flex, { color: palette.textOnImage }]}>A few places worth keeping.</Text>
                                <Pressable onPress={next} accessibilityRole="button" accessibilityLabel={`Share ${source} video`} style={[s.shareTarget, { backgroundColor: palette.card }]}>
                                    <Ionicons name={source === 'Instagram' ? 'paper-plane-outline' : 'arrow-redo-outline'} size={28} color={palette.primary} />
                                    <Text style={[Type.metadata, { color: palette.primary }]}>Share</Text>
                                </Pressable>
                            </View>
                        </View>
                    </> : null}
                    {step === 1 || step === 2 ? <View style={[s.sheetStage, { backgroundColor: palette.surfaceJournal }]}>
                        <View style={s.clipSummary}>
                            <Image source={CLIPS[source]} style={s.thumbnail} accessible={false} />
                            <View style={s.flex}><Text style={[Type.editorialTitle, { color: palette.text }]}>A few good finds</Text><Text style={[Type.metadata, { color: palette.textMuted }]}>A clip from {source}</Text></View>
                        </View>
                        <View style={[s.sheet, Shadow.note, { backgroundColor: palette.card }]}>
                            <View style={[s.handle, { backgroundColor: palette.ruleInkSoft }]} />
                            <Text style={[Type.sectionKicker, s.caption, { color: palette.textMuted }]}>{step === 1 ? 'Share to' : more ? 'Apps' : 'iPhone share sheet'}</Text>
                            {step === 1 ? <View style={s.apps}>
                                <View style={s.decorativeApp} accessible={false}><Ionicons name="link-outline" size={28} color={palette.textMuted} /><Text style={[Type.metadata, { color: palette.textMuted }]}>Copy link</Text></View>
                                <Pressable onPress={next} accessibilityRole="button" accessibilityLabel="More sharing options" style={[s.appTarget, { backgroundColor: palette.primaryMuted }]}><Ionicons name="ellipsis-horizontal" size={28} color={palette.primary} /><Text style={[Type.body, { color: palette.primary }]}>More</Text></Pressable>
                            </View> : <>
                                <Pressable onPress={next} accessibilityRole="button" accessibilityLabel="Choose Napkin" style={[s.appRow, { backgroundColor: palette.primaryMuted }]}>
                                    <Image source={ICON} style={s.appIcon} accessible={false} /><Text style={[Type.body, s.flex, { color: palette.text }]}>Napkin</Text><Ionicons name="arrow-forward-outline" size={24} color={palette.primary} />
                                </Pressable>
                                {!more ? <Pressable onPress={() => setMore(true)} accessibilityRole="button" accessibilityLabel="More apps" style={s.appRow}><Ionicons name="ellipsis-horizontal" size={24} color={palette.textMuted} /><Text style={[Type.body, { color: palette.textMuted }]}>More</Text></Pressable> : null}
                            </>}
                        </View>
                        <Text style={[Type.metadata, s.helper, { color: palette.textMuted }]}>{step === 2 ? 'Tip: add Napkin to your share favourites for next time.' : 'Share menus can look a little different across apps.'}</Text>
                    </View> : null}
                    {step === 3 ? <View style={[s.paper, Shadow.note, { backgroundColor: palette.card }]}>
                        <Image source={ICON} style={s.appIcon} accessible={false} />
                        <Text style={[Type.displaySmall, { color: palette.text }]}>save to napkin</Text>
                        <View style={s.clipSummary}><Image source={CLIPS[source]} style={s.thumbnail} accessible={false} /><Text style={[Type.body, s.flex, { color: palette.textSecondary }]}>link ready · {source}</Text></View>
                        <Text style={[Type.body, { color: palette.textSecondary }]}>Review the restaurants in Napkin before saving.</Text>
                        {action('add for review', next)}
                    </View> : null}
                    {step === 4 ? <View style={[s.paper, Shadow.note, { backgroundColor: palette.card }]}>
                        <Ionicons name="checkmark-circle-outline" size={48} color={palette.secondary} />
                        <Text style={[Type.displaySmall, { color: palette.text }]}>Added for review</Text>
                        <Text style={[Type.body, { color: palette.textSecondary }]}>You’re back in {source}. The clip is waiting in Napkin.</Text>
                        {action('Open Napkin in the demo', next)}
                    </View> : null}
                    {step === 5 ? <View style={[s.paper, Shadow.note, { backgroundColor: palette.card }]}>
                        <Text style={[Type.sectionKicker, { color: palette.primary }]}>Places · clip tray</Text>
                        <View style={s.clipSummary}><Image source={CLIPS[source]} style={s.thumbnail} accessible={false} /><View style={s.flex}><Text style={[Type.editorialTitle, { color: palette.text }]}>3 places to review</Text><Text style={[Type.metadata, { color: palette.textMuted }]}>Example results · {source}</Text></View></View>
                        {SPOTS.map((name) => <Pressable key={name} onPress={() => setSelected((current) => current.includes(name) ? current.filter((spot) => spot !== name) : [...current, name])} accessibilityRole="checkbox" accessibilityLabel={name} accessibilityState={{ checked: selected.includes(name) }} style={s.reviewRow}>
                            <Ionicons name={selected.includes(name) ? 'checkmark-circle-outline' : 'ellipse-outline'} size={24} color={selected.includes(name) ? palette.primary : palette.textMuted} /><Text style={[Type.editorialTitle, { color: palette.text }]}>{name}</Text>
                        </Pressable>)}
                        {action(`Save ${selected.length} ${selected.length === 1 ? 'spot' : 'spots'}`, next, !selected.length)}
                    </View> : null}
                    {step === 6 ? <>
                        <SavedPlacesIllustration palette={palette} names={selected} />
                        {action('Got it', onDone)}
                    </> : null}
                </Animated.View>
            </ScrollView>
            <Text style={[Type.metadata, s.footnote, { color: palette.textMuted, paddingBottom: Math.max(insets.bottom, Spacing.md) }]}>A practice run. Nothing is saved.</Text>
        </View>
    );
}

export function SharingPreview({ palette }: { palette: Palette }) {
    return <View style={[s.preview, { backgroundColor: palette.surfaceJournal }]} accessible accessibilityLabel="Example: TikTok and Instagram clips become restaurants to review in Napkin">
        <View style={[s.previewClip, s.rearClip, Shadow.note]}><Image source={CLIPS.Instagram} style={s.fillPhoto} resizeMode="cover" accessible={false} /><View style={[s.clipBadge, { backgroundColor: palette.card }]}><Ionicons name="logo-instagram" size={20} color={palette.text} /><Text style={[Type.metadata, { color: palette.text }]}>Reels</Text></View></View>
        <View style={[s.previewClip, s.frontClip, Shadow.note]}><Image source={CLIPS.TikTok} style={s.fillPhoto} resizeMode="cover" accessible={false} /><View style={[s.clipBadge, { backgroundColor: palette.card }]}><Ionicons name="logo-tiktok" size={20} color={palette.text} /><Text style={[Type.metadata, { color: palette.text }]}>TikTok</Text></View></View>
        <View style={[s.previewResult, Shadow.note, { backgroundColor: palette.card }]}><Image source={ICON} style={s.smallIcon} accessible={false} /><View style={s.flex}><Text style={[Type.editorialTitle, { color: palette.text }]}>A few good finds</Text><Text style={[Type.metadata, { color: palette.secondary }]}>Ready to review in Napkin</Text></View><Ionicons name="location-outline" size={24} color={palette.primary} /></View>
    </View>;
}

function SavedPlacesIllustration({ palette, names }: { palette: Palette; names: string[] }) {
    return <View style={[s.map, { backgroundColor: palette.oliveCream }]}>
        <View accessible={false} style={[s.road, { backgroundColor: palette.card, top: '32%', transform: [{ rotate: '-28deg' }] }]} />
        <View accessible={false} style={[s.road, { backgroundColor: palette.card, top: '65%', transform: [{ rotate: '24deg' }] }]} />
        <Text style={[Type.sectionKicker, { color: palette.secondary }]}>Example · your map</Text>
        {names.map((name, i) => <View key={name} style={[s.mapPin, Shadow.note, { backgroundColor: palette.card, alignSelf: i % 2 ? 'flex-end' : 'flex-start' }]}><Ionicons name="location-outline" size={24} color={palette.primary} /><View><Text style={[Type.editorialTitle, { color: palette.text }]}>{name}</Text><Text style={[Type.metadata, { color: palette.secondary }]}>pinned</Text></View></View>)}
    </View>;
}

const s = StyleSheet.create({
    fillPhoto: { position: 'absolute', width: '100%', height: '100%' },
    root: { flex: 1 }, flex: { flex: 1 }, bold: { fontFamily: 'Manrope_700Bold' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: Spacing.md },
    iconButton: { minWidth: Spacing.hitTarget, minHeight: Spacing.hitTarget, alignItems: 'center', justifyContent: 'center' },
    content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, flexGrow: 1 },
    progress: { flexDirection: 'row', gap: Spacing.xs, marginBottom: Spacing.lg }, segment: { flex: 1, height: 2, borderRadius: Radius.full },
    title: { marginBottom: Spacing.sm }, caption: { marginBottom: Spacing.lg },
    sources: { flexDirection: 'row', borderRadius: Radius.full, padding: Spacing.xs, marginBottom: Spacing.md },
    source: { flex: 1, minHeight: Spacing.hitTarget, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, borderRadius: Radius.full },
    video: { height: 340, borderRadius: Radius.xxl, overflow: 'hidden' }, videoShade: { ...StyleSheet.absoluteFillObject },
    videoTop: { padding: Spacing.lg }, videoBottom: { position: 'absolute', bottom: Spacing.lg, left: Spacing.lg, right: Spacing.lg, flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.md },
    shareTarget: { borderRadius: Radius.full, padding: Spacing.md, alignItems: 'center', gap: Spacing.xs },
    sheetStage: { padding: Spacing.md, borderRadius: Radius.xxl, gap: Spacing.lg },
    clipSummary: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md }, thumbnail: { width: 56, height: 72, borderRadius: Radius.md },
    sheet: { padding: Spacing.lg, borderRadius: Radius.xxl }, handle: { width: 36, height: 4, alignSelf: 'center', borderRadius: Radius.full, marginBottom: Spacing.lg },
    apps: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg }, decorativeApp: { flex: 1, alignItems: 'center', gap: Spacing.sm },
    appTarget: { flex: 1, padding: Spacing.md, borderRadius: Radius.lg, alignItems: 'center', gap: Spacing.sm },
    appRow: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: Spacing.md, borderRadius: Radius.md, padding: Spacing.sm },
    appIcon: { width: 48, height: 48, borderRadius: Radius.md }, smallIcon: { width: 40, height: 40, borderRadius: Radius.md }, helper: { textAlign: 'center' },
    paper: { padding: Spacing.lg, borderRadius: Radius.xxl, gap: Spacing.lg },
    action: { minHeight: 56, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: Spacing.sm, borderRadius: Radius.full },
    reviewRow: { minHeight: Spacing.hitTarget, flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    footnote: { textAlign: 'center', paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm },
    preview: { height: 304, borderRadius: Radius.xxl, overflow: 'hidden' },
    previewClip: { position: 'absolute', width: '46%', height: 220, top: Spacing.lg, borderRadius: Radius.lg, overflow: 'hidden' },
    rearClip: { left: '12%', transform: [{ rotate: '-9deg' }] }, frontClip: { right: '12%', top: Spacing.xl, transform: [{ rotate: '8deg' }] },
    clipBadge: { position: 'absolute', top: Spacing.sm, left: Spacing.sm, flexDirection: 'row', gap: Spacing.xs, alignItems: 'center', padding: Spacing.sm, borderRadius: Radius.full },
    previewResult: { position: 'absolute', bottom: Spacing.md, left: Spacing.md, right: Spacing.md, borderRadius: Radius.lg, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    map: { padding: Spacing.lg, borderRadius: Radius.xxl, gap: Spacing.lg, overflow: 'hidden', marginBottom: Spacing.lg, minHeight: 300 },
    road: { position: 'absolute', height: 28, left: -40, right: -40 }, mapPin: { flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', padding: Spacing.md, borderRadius: Radius.lg },
});
