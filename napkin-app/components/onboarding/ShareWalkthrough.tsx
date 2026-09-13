import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Animated, { FadeIn, FadeOut, SlideInDown, SlideOutDown, useReducedMotion } from 'react-native-reanimated';
import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { DEMO_ICON, DEMO_SPOTS, ExternalUI as C, type DemoSource } from './share-demo/demoContent';
import { SourceAppScene, SourceSharePanel } from './share-demo/SourceAppScene';
import { SystemSharePanels } from './share-demo/SystemSharePanels';
import { DemoButton, NapkinDemoScene } from './share-demo/NapkinDemoScene';

type Palette = typeof Colors.light;
const STEPS = ['clip', 'source-share', 'system-share', 'apps', 'extension', 'queued', 'tray', 'review', 'map'] as const;
type Step = typeof STEPS[number];
const HINTS: Record<Step, string> = {
    clip: 'Tap the video’s Share button.',
    'source-share': 'Open the iPhone share sheet from the video’s sharing menu.',
    'system-share': 'Tap More to find Napkin in the Apps list.',
    apps: 'Tap Napkin. You can add it to your share favorites using Edit next time.',
    extension: 'Tap add for review. You can carry on watching afterward.',
    queued: 'Added for review. Open Napkin when you are ready.',
    tray: 'In Places, open the clip from your clip tray.',
    review: 'Review the places. Keep your picks and save them to your map.',
    map: 'Your selected example places are pinned. Nothing was saved to your account.',
};

/** Offline interaction-gated rehearsal. No URL, import, queue, or save side effects. */
export function ShareWalkthrough({ palette, onClose, onDone }: { palette: Palette; onClose: () => void; onDone: () => void }) {
    const insets = useSafeAreaInsets();
    const { width, height } = useWindowDimensions();
    const reduced = useReducedMotion();
    const [step, setStep] = useState<Step>('clip');
    const [source, setSource] = useState<DemoSource>('TikTok');
    const [selected, setSelected] = useState(DEMO_SPOTS.map((spot) => spot.name));
    const index = STEPS.indexOf(step);
    const inNapkin = index >= STEPS.indexOf('tray');
    // Every target captures the step it belongs to. Repeated or outgoing-layer
    // taps cannot skip the next step while sheets are entering/exiting.
    const advance = (expected: Step) => setStep((current) => current === expected ? STEPS[Math.min(STEPS.indexOf(current) + 1, STEPS.length - 1)] : current);
    const back = () => setStep((current) => STEPS[Math.max(STEPS.indexOf(current) - 1, 0)]);
    const sheetEnter = reduced ? undefined : SlideInDown.duration(340);
    const sheetExit = reduced ? undefined : SlideOutDown.duration(260);
    const sceneEnter = reduced ? undefined : FadeIn.duration(260);
    const sceneExit = reduced ? undefined : FadeOut.duration(180);
    const headerBottom = insets.top + 56;
    useEffect(() => { AccessibilityInfo.announceForAccessibility(HINTS[step]); }, [step]);

    return <View style={[s.root, { backgroundColor: inNapkin ? palette.background : C.background }]}>
        <StatusBar style={inNapkin ? 'dark' : 'light'} />
        {!inNapkin ? <View style={StyleSheet.absoluteFill} accessibilityElementsHidden={step !== 'clip'} importantForAccessibility={step === 'clip' ? 'auto' : 'no-hide-descendants'}>
            <SourceAppScene source={source} top={headerBottom + Spacing.md} bottom={insets.bottom} active={step === 'clip'} onShare={() => advance('clip')} />
        </View> : null}
        {index > 0 && !inNapkin ? <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: C.scrim }]} /> : null}
        {step === 'source-share' ? <Animated.View key="source" entering={sheetEnter} exiting={sheetExit} style={s.bottomLayer}>
            <SourceSharePanel source={source} bottom={insets.bottom} onMore={() => advance('source-share')} />
        </Animated.View> : null}
        {step === 'system-share' || step === 'apps' ? <Animated.View key={step} entering={sheetEnter} exiting={sheetExit} style={s.bottomLayer}>
            <SystemSharePanels width={width} height={step === 'apps' ? height - headerBottom - Spacing.sm : Math.min(height * 0.61, 490)} bottomInset={insets.bottom} stage={step === 'apps' ? 'apps' : 'system'} source={source} onMore={() => advance('system-share')} onNapkin={() => advance('apps')} />
        </Animated.View> : null}
        {step === 'extension' ? <Animated.View key="extension" entering={sheetEnter} exiting={sheetExit} style={[s.extensionLayer, { paddingBottom: Math.max(insets.bottom, Spacing.sm), maxHeight: height - headerBottom }]}>
            <Text maxFontSizeMultiplier={1.2} style={s.floatingHint}>Add it now. Review it in Napkin.</Text>
            <View style={[s.extension, Shadow.note, { backgroundColor: palette.card }]}><ScrollView style={s.extensionScroll} contentContainerStyle={s.extensionContent} bounces={false} showsVerticalScrollIndicator>
                <View style={[s.handle, { backgroundColor: palette.ruleInkSoft }]} />
                <Text accessibilityRole="header" style={[Type.displayMedium, { color: palette.text }]}>save to napkin</Text>
                <View style={s.linkReady}><Ionicons name="link-outline" size={16} color={palette.textSecondary} /><Text style={[Type.metadata, { color: palette.textSecondary }]}>link ready · {source}</Text></View>
                <View style={[s.reviewPanel, { backgroundColor: palette.primaryMuted }]}><Ionicons name="shield-checkmark-outline" size={25} color={palette.primary} /><View style={s.flex}><Text style={[Type.body, s.bold, { color: palette.text }]}>review before saving</Text><Text style={[Type.metadata, { color: palette.textSecondary, marginTop: Spacing.xs }]}>Check the restaurants in Napkin before you pin them.</Text></View></View>
                </ScrollView><Pressable accessibilityRole="button" accessibilityLabel="add for review" onPress={() => advance('extension')} style={({ pressed }) => [s.extensionButton, { backgroundColor: palette.primary, opacity: pressed ? 0.8 : 1 }]}><Text style={[Type.body, s.bold, { color: palette.textInverse }]}>add for review</Text></Pressable>
            </View>
        </Animated.View> : null}
        {step === 'queued' ? <Animated.View key="queued" entering={sceneEnter} exiting={sceneExit} style={[s.queued, { paddingTop: headerBottom }]}>
            <View style={[s.queuedCard, Shadow.note, { backgroundColor: palette.card }]}>
                <Image source={DEMO_ICON} style={s.icon} accessible={false} /><Text accessibilityRole="header" style={[Type.displaySmall, { color: palette.text }]}>Added for review</Text><Text style={[Type.body, { color: palette.textSecondary }]}>Carry on watching. Open Napkin when you’re ready.</Text>
                <DemoButton palette={palette} label="Open Napkin in the demo" displayLabel="Open Napkin" onPress={() => advance('queued')} />
            </View>
        </Animated.View> : null}
        {inNapkin ? <Animated.View key={step === 'review' ? 'review' : 'places'} entering={sceneEnter} exiting={sceneExit} style={StyleSheet.absoluteFill}>
            <NapkinDemoScene palette={palette} source={source} stage={step as 'tray' | 'review' | 'map'} selected={selected} top={headerBottom} bottom={insets.bottom}
                onReview={() => advance('tray')} onToggle={(name) => setSelected((current) => current.includes(name) ? current.filter((item) => item !== name) : [...current, name])}
                onSave={() => { if (selected.length) advance('review'); }} onDone={onDone} />
        </Animated.View> : null}
        <View style={[s.header, { top: insets.top + Spacing.xs }]}>
            <Pressable onPress={back} disabled={index === 0} accessibilityRole="button" accessibilityLabel="Previous demo step" accessibilityState={{ disabled: index === 0 }} style={[s.headerButton, { backgroundColor: inNapkin ? palette.surfaceJournal : C.scrim, opacity: index ? 1 : 0 }]}><Ionicons name="arrow-back" size={21} color={inNapkin ? palette.text : C.white} /></Pressable>
            <View accessible accessibilityRole="progressbar" accessibilityLabel="Sharing demo" accessibilityValue={{ min: 1, max: STEPS.length, now: index + 1 }} style={[s.demoBadge, { backgroundColor: inNapkin ? palette.surfaceJournal : C.scrim }]}>
                <Text style={[Type.metadata, { color: inNapkin ? palette.textSecondary : C.white }]}>Practice · {index + 1} of {STEPS.length}</Text>
            </View>
            <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close sharing demo" style={[s.headerButton, { backgroundColor: inNapkin ? palette.surfaceJournal : C.scrim }]}><Ionicons name="close" size={23} color={inNapkin ? palette.text : C.white} /></Pressable>
        </View>
        {step === 'clip' ? <View style={[s.sourcePicker, { top: headerBottom + 61 }]} accessibilityRole="tablist">
            {(['TikTok', 'Instagram'] as const).map((item) => <Pressable key={item} accessibilityRole="tab" accessibilityLabel={item} accessibilityState={{ selected: source === item }} onPress={() => setSource(item)} style={[s.sourceTab, { backgroundColor: source === item ? C.white : C.scrim }]}><Ionicons name={item === 'TikTok' ? 'logo-tiktok' : 'logo-instagram'} size={15} color={source === item ? C.background : C.white} /><Text style={[Type.metadata, { color: source === item ? C.background : C.white }]}>{item}</Text></Pressable>)}
        </View> : null}
    </View>;
}

/** The welcome artwork previews the same source sheet users will rehearse. */
export function SharingPreview({ palette }: { palette: Palette }) {
    return <View style={[s.preview, { backgroundColor: palette.surfaceJournal }]} accessible accessibilityLabel="Practice sharing a TikTok or Instagram clip, then review its restaurants in Napkin">
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.miniPhone}>
            <View style={s.miniScene}><SourceAppScene source="TikTok" top={15} bottom={0} active={false} onShare={() => undefined} /><View style={s.bottomLayer}><SourceSharePanel source="TikTok" bottom={0} onMore={() => undefined} /></View></View>
        </View>
        <View style={[s.previewLabel, { backgroundColor: palette.card }]}><Ionicons name="logo-tiktok" size={20} color={palette.text} /><Ionicons name="logo-instagram" size={20} color={palette.text} /></View>
        <View style={[s.previewResult, Shadow.note, { backgroundColor: palette.card }]}><Image source={DEMO_ICON} style={s.icon} accessible={false} /><Text style={[Type.editorialTitle, { color: palette.text }]}>3 good finds.</Text><Text style={[Type.metadata, { color: palette.textMuted }]}>One clip.</Text><View style={[s.resultRule, { backgroundColor: palette.ruleInkSoft }]} />{DEMO_SPOTS.map((spot) => <View key={spot.name} style={s.previewSpot}><Ionicons name="location-outline" size={17} color={palette.primary} /><Text style={[Type.metadata, { color: palette.text }]}>{spot.name}</Text></View>)}</View>
    </View>;
}

const s = StyleSheet.create({
    root: { flex: 1 }, flex: { flex: 1 }, bold: { fontFamily: 'Manrope_700Bold' }, bottomLayer: { position: 'absolute', bottom: 0, left: 0, right: 0 },
    header: { position: 'absolute', left: Spacing.md, right: Spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, headerButton: { width: Spacing.hitTarget, height: Spacing.hitTarget, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' }, demoBadge: { paddingHorizontal: Spacing.md, minHeight: 36, borderRadius: Radius.full, justifyContent: 'center' },
    sourcePicker: { position: 'absolute', left: 0, right: 0, flexDirection: 'row', justifyContent: 'center', gap: Spacing.sm }, sourceTab: { minHeight: Spacing.hitTarget, borderRadius: Radius.full, paddingHorizontal: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.xs },
    extensionLayer: { position: 'absolute', bottom: 0, left: 10, right: 10 }, floatingHint: { color: C.white, fontFamily: 'Manrope_700Bold', fontSize: 18, textAlign: 'center', marginBottom: Spacing.lg, paddingHorizontal: Spacing.md, textShadowColor: C.shadow, textShadowRadius: 6 }, extension: { borderRadius: Radius.xxl, flexShrink: 1, overflow: 'hidden' }, extensionScroll: { flexShrink: 1 }, extensionContent: { padding: 22, paddingTop: 10, paddingBottom: 0 }, handle: { height: 5, width: 40, borderRadius: Radius.full, alignSelf: 'center', marginBottom: Spacing.lg }, linkReady: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.sm }, reviewPanel: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: Spacing.md, borderRadius: Radius.lg, marginVertical: Spacing.lg }, extensionButton: { marginHorizontal: 22, marginBottom: 22, minHeight: 54, borderRadius: Radius.lg, alignItems: 'center', justifyContent: 'center', padding: Spacing.md },
    queued: { flex: 1, justifyContent: 'center', padding: Spacing.lg }, queuedCard: { padding: Spacing.lg, borderRadius: Radius.xxl, gap: Spacing.md }, icon: { width: 44, height: 44, borderRadius: Radius.md },
    preview: { height: 320, overflow: 'hidden', borderRadius: Radius.xxl }, miniPhone: { position: 'absolute', left: 16, top: 16, width: 180, height: 326, borderRadius: 20, overflow: 'hidden', transform: [{ rotate: '-5deg' }] }, miniScene: { width: 375, height: 680, transform: [{ scale: 0.48 }], transformOrigin: 'top left' }, previewLabel: { position: 'absolute', right: Spacing.lg, top: Spacing.lg, flexDirection: 'row', gap: Spacing.sm, padding: Spacing.sm, borderRadius: Radius.full }, previewResult: { position: 'absolute', right: Spacing.md, bottom: Spacing.lg, width: 168, padding: Spacing.md, borderRadius: Radius.lg, gap: Spacing.xs }, previewSpot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.xs, marginTop: Spacing.xs }, resultRule: { height: 1, marginVertical: Spacing.sm },
});
