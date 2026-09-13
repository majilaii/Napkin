import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { DEMO_CLIPS, DEMO_SPOTS, type DemoSource } from './demoContent';

type Palette = typeof Colors.light;

export function NapkinDemoScene({ palette: p, source, stage, selected, top, bottom, onReview, onToggle, onSave, onDone }: {
    palette: Palette; source: DemoSource; stage: 'tray' | 'review' | 'map'; selected: string[];
    top: number; bottom: number; onReview: () => void; onToggle: (name: string) => void; onSave: () => void; onDone: () => void;
}) {
    const count = selected.length;
    const { fontScale } = useWindowDimensions();
    const largeText = fontScale > 1.3;
    return <View style={[s.root, { backgroundColor: p.background, paddingTop: top }]}>
        {stage === 'review' ? <>
            <ScrollView showsVerticalScrollIndicator contentContainerStyle={s.reviewContent}>
                <Text style={[Type.sectionKicker, { color: p.primary }]}>REVIEW BEFORE SAVING</Text>
                <Text accessibilityRole="header" style={[Type.displayMedium, { color: p.text, marginTop: Spacing.sm }]}>3 spots from {source}</Text>
                <View style={[s.sourceCard, { backgroundColor: p.surfaceJournal }]}><Image source={DEMO_CLIPS[source]} style={s.thumbnail} accessible={false} /><View style={s.flex}><Text style={[Type.editorialTitle, { color: p.text }]}>3 Soho dinner spots</Text><Text style={[Type.metadata, { color: p.textMuted, marginTop: Spacing.xs }]}>@napkin.demo · example clip</Text></View><Ionicons name={source === 'TikTok' ? 'logo-tiktok' : 'logo-instagram'} size={24} color={p.text} /></View>
                <Text style={[Type.body, { color: p.textSecondary }]}>Keep the places you want to try.</Text>
                <View style={s.spots}>
                    {DEMO_SPOTS.map((spot) => <Pressable key={spot.name} accessibilityRole="checkbox" accessibilityLabel={spot.name} accessibilityState={{ checked: selected.includes(spot.name) }} onPress={() => onToggle(spot.name)} style={({ pressed }) => [s.spot, { backgroundColor: p.card, opacity: pressed ? 0.8 : 1 }]}>
                        <Ionicons name={selected.includes(spot.name) ? 'checkmark-circle' : 'ellipse-outline'} size={27} color={selected.includes(spot.name) ? p.primary : p.textMuted} />
                        <View style={s.flex}><Text style={[Type.editorialTitle, { color: p.text }]}>{spot.name}</Text><Text style={[Type.metadata, { color: p.textMuted, marginTop: Spacing.xs }]}>{spot.detail}</Text></View>
                    </Pressable>)}
                </View>
                <View style={s.destination}><Ionicons name="location-outline" size={22} color={p.primary} /><Text style={[Type.body, { color: p.text }]}>Pin to your map</Text><Ionicons name="checkmark" size={21} color={p.primary} /></View>
            </ScrollView>
            <View style={[s.footer, { paddingBottom: Math.max(bottom, Spacing.lg) }]}><DemoButton palette={p} label={`Save ${count} ${count === 1 ? 'spot' : 'spots'}`} onPress={onSave} disabled={!count} /><Text style={[Type.metadata, s.note, { color: p.textMuted }]}>Example only. Nothing is saved.</Text></View>
        </> : <>
            <View style={s.placesHeader}><Text maxFontSizeMultiplier={1.2} style={[Type.displayLarge, { color: p.text }]}>Places</Text>{!largeText && <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[s.clipButton, { backgroundColor: p.surfaceJournal }]}><Ionicons name="file-tray-outline" size={24} color={p.primary} /><Text maxFontSizeMultiplier={1.2} style={[Type.metadata, { color: p.primary }]}>Clip tray{stage === 'tray' ? ' · 1' : ''}</Text></View>}</View>
            <View style={s.mapFlex}>
                {stage === 'map' ? largeText ? <ScrollView style={s.flex} contentContainerStyle={s.mapScrollContent} showsVerticalScrollIndicator><DemoMap palette={p} names={selected} largeText /></ScrollView> : <DemoMap palette={p} names={selected} /> : !largeText ? <DemoMap palette={p} names={[]} /> : null}
                {stage === 'tray' ? <ScrollView style={[s.tray, largeText && s.trayExpanded, Shadow.note, { backgroundColor: p.background }]} contentContainerStyle={s.trayContent} showsVerticalScrollIndicator>
                    {!largeText && <View style={[s.handle, { backgroundColor: p.ruleInkSoft }]} />}<Text style={[Type.sectionTitle, { color: p.text }]}>Clip tray</Text>
                    <Pressable onPress={onReview} accessibilityRole="button" accessibilityLabel="Review example clip" style={({ pressed }) => [s.clipReview, { backgroundColor: p.card, opacity: pressed ? 0.8 : 1 }]}>
                        {!largeText && <Image source={DEMO_CLIPS[source]} style={s.thumbnail} accessible={false} />}<View style={s.flex}><Text style={[Type.metadata, { color: p.primary }]}>Ready to review</Text><Text style={[Type.editorialTitle, { color: p.text, marginTop: Spacing.xs }]}>3 Soho dinner spots</Text><Text style={[Type.metadata, { color: p.textMuted, marginTop: Spacing.xs }]}>3 places · {source}</Text></View><Ionicons name="chevron-forward-outline" size={23} color={p.primary} />
                    </Pressable>
                    {!largeText && <Text style={[Type.body, s.trayHint, { color: p.textSecondary }]}>Tap the clip to check the places.</Text>}
                </ScrollView> : <View style={[s.result, Shadow.note, { backgroundColor: p.card }]}><View style={[s.success, { backgroundColor: p.oliveCream }]}><Ionicons name="checkmark" size={22} color={p.secondary} /></View><View style={s.flex}><Text style={[Type.editorialTitle, { color: p.text }]}>{count === 1 ? 'A good find, kept.' : 'Good finds, kept.'}</Text><Text style={[Type.metadata, { color: p.textMuted, marginTop: Spacing.xs }]}>{count} {count === 1 ? 'place' : 'places'} from one clip</Text></View></View>}
            </View>
            <View style={[s.footer, { paddingBottom: Math.max(bottom, Spacing.lg) }]}>{stage === 'map' ? <DemoButton palette={p} label="Got it" onPress={onDone} /> : null}<Text style={[Type.metadata, s.note, { color: p.textMuted }]}>Example only. Nothing is saved.</Text></View>
        </>}
    </View>;
}

export function DemoButton({ palette: p, label, displayLabel, onPress, disabled = false }: { palette: Palette; label: string; displayLabel?: string; onPress: () => void; disabled?: boolean }) {
    return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={({ pressed }) => [s.button, { backgroundColor: p.primary, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }]}><Text style={[Type.body, s.bold, { color: p.textInverse, flexShrink: 1, textAlign: 'center' }]}>{displayLabel ?? label}</Text><Ionicons name="arrow-forward-outline" size={21} color={p.textInverse} /></Pressable>;
}

/** A bundled illustrative street plan, independent of map services or accounts. */
function DemoMap({ palette: p, names, largeText = false }: { palette: Palette; names: string[]; largeText?: boolean }) {
    return <View style={[s.map, largeText && s.mapExpanded, { backgroundColor: p.surfaceJournalHi }]} accessibilityLabel="Example · your map">
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {[7, 25, 44, 65, 85].map((left, i) => <View key={`v${left}`} style={[s.verticalRoad, { left: `${left}%`, backgroundColor: p.card, transform: [{ rotate: `${i % 2 ? 17 : 14}deg` }] }]} />)}
            {[9, 28, 49, 68, 88].map((top, i) => <View key={`h${top}`} style={[s.horizontalRoad, { top: `${top}%`, backgroundColor: p.card, transform: [{ rotate: `${i % 2 ? -17 : -19}deg` }] }]} />)}
            <View style={[s.park, { backgroundColor: p.oliveCream }]}><Text allowFontScaling={false} style={[s.parkText, { color: p.secondary }]}>SOHO{ '\n' }SQUARE</Text></View>
            <Text allowFontScaling={false} style={[s.district, { color: p.textMuted }]}>S O H O</Text>
            <Text allowFontScaling={false} style={[s.roadName, { top: '42%', left: '11%', color: p.textMuted, transform: [{ rotate: '-19deg' }] }]}>BREWER STREET</Text>
            <Text allowFontScaling={false} style={[s.roadName, { top: '38%', left: '54%', color: p.textMuted, transform: [{ rotate: '-76deg' }] }]}>DEAN STREET</Text>
            <Text allowFontScaling={false} style={[s.roadName, { top: '79%', left: '50%', color: p.textMuted, transform: [{ rotate: '-19deg' }] }]}>SHAFTESBURY AVENUE</Text>
        </View>
        {DEMO_SPOTS.filter((spot) => names.includes(spot.name)).map((spot) => <View key={spot.name} style={[s.mapSpot, { left: `${Math.min(spot.x, 0.55) * 100}%`, top: `${spot.y * 80}%` }]}>
            <View style={[s.pin, Shadow.note, { backgroundColor: p.primary }]}><Ionicons name="restaurant-outline" size={21} color={p.textInverse} /></View><View style={[s.pinLabel, Shadow.note, { backgroundColor: p.card }]}><Text allowFontScaling={false} style={[Type.metadata, { color: p.text }]}>{spot.name}</Text><Text allowFontScaling={false} style={[Type.metadata, { color: p.secondary }]}>pinned</Text></View>
        </View>)}
        <Text allowFontScaling={false} style={[Type.sectionKicker, s.mapLabel, { color: p.textMuted }]}>Illustrative map · London</Text>
    </View>;
}

const s = StyleSheet.create({
    root: { flex: 1 }, flex: { flex: 1 }, bold: { fontFamily: 'Manrope_700Bold' },
    reviewContent: { padding: Spacing.lg, paddingTop: Spacing.md }, sourceCard: { marginVertical: Spacing.lg, borderRadius: Radius.lg, padding: Spacing.md, flexDirection: 'row', alignItems: 'center', gap: Spacing.md }, thumbnail: { width: 48, height: 65, borderRadius: Radius.sm },
    spots: { gap: Spacing.sm, marginTop: Spacing.md }, spot: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md, padding: Spacing.md, borderRadius: Radius.lg, minHeight: 80 }, destination: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.lg },
    footer: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.md }, button: { minHeight: 56, padding: Spacing.md, flexDirection: 'row', gap: Spacing.sm, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.full }, note: { textAlign: 'center', marginTop: Spacing.sm },
    placesHeader: { padding: Spacing.lg, paddingTop: Spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, clipButton: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, borderRadius: Radius.full, padding: Spacing.sm }, mapFlex: { flex: 1, overflow: 'hidden' },
    tray: { flexGrow: 0, maxHeight: '85%', borderTopLeftRadius: Radius.xxl, borderTopRightRadius: Radius.xxl }, trayExpanded: { flexGrow: 1, flexShrink: 1, flexBasis: 0, maxHeight: '100%' }, trayContent: { padding: Spacing.lg, paddingTop: Spacing.sm }, handle: { width: 36, height: 4, alignSelf: 'center', borderRadius: Radius.full, marginBottom: Spacing.lg }, clipReview: { padding: Spacing.md, borderRadius: Radius.lg, gap: Spacing.md, flexDirection: 'row', alignItems: 'center', marginTop: Spacing.md }, trayHint: { marginTop: Spacing.md, textAlign: 'center' },
    mapScrollContent: { flexGrow: 1 }, mapExpanded: { minHeight: 330 },
    map: { flex: 1, overflow: 'hidden' }, verticalRoad: { position: 'absolute', width: 10, top: -100, bottom: -100 }, horizontalRoad: { position: 'absolute', height: 12, left: -100, right: -100 }, park: { position: 'absolute', top: 0, right: '17%', width: 74, height: 70, borderRadius: 14, transform: [{ rotate: '-17deg' }], justifyContent: 'center' }, parkText: { fontSize: 11, textAlign: 'center', fontWeight: '500' }, district: { position: 'absolute', top: '29%', left: '14%', fontSize: 17, opacity: 0.5 }, roadName: { position: 'absolute', fontSize: 11, opacity: 0.8 },
    mapSpot: { position: 'absolute', alignItems: 'center', maxWidth: 170 }, pin: { width: 39, height: 39, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' }, pinLabel: { borderRadius: Radius.md, paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs, alignItems: 'center', marginTop: Spacing.xs }, mapLabel: { position: 'absolute', left: Spacing.md, bottom: Spacing.sm },
    result: { margin: Spacing.lg, marginBottom: 0, borderRadius: Radius.lg, flexDirection: 'row', gap: Spacing.md, padding: Spacing.md, alignItems: 'center' }, success: { height: 40, width: 40, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
});
