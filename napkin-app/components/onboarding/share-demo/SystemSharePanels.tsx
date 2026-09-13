import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

export type SystemSharePanelsProps = {
    width: number;
    height: number;
    bottomInset?: number;
    stage: 'system' | 'apps';
    source?: 'TikTok' | 'Instagram';
    onMore: () => void;
    onNapkin: () => void;
};

// A local illustration of iOS, deliberately using its system appearance rather
// than Napkin's paper/type tokens. The only live targets advance the rehearsal.
const IOS = {
    sheet: '#242426',
    group: 'rgba(255, 255, 255, 0.075)',
    separator: 'rgba(255, 255, 255, 0.12)',
    white: '#ffffff',
    label: '#f5f5f7',
    secondary: '#a5a5ab',
    blue: '#0a84ff',
    font: Platform.OS === 'ios' ? 'System' : 'sans-serif',
};

const AVATARS = [
    { name: 'Maya', image: require('../../../assets/guide/maya.jpg') },
    { name: 'Julian', image: require('../../../assets/guide/julian.jpg') },
    { name: 'Clara', image: require('../../../assets/guide/clara.jpg') },
] as const;
const ICON = require('../../../assets/images/icon.png');
const CLIPS = {
    TikTok: require('../../../assets/onboarding/tiktok-crudo.png'),
    Instagram: require('../../../assets/onboarding/reel-kitchen.png'),
};
type AppName = 'AirDrop' | 'Messages' | 'Mail' | 'Notes' | 'More' | 'Napkin' | 'Reminders';
const SHARE_APPS: AppName[] = ['AirDrop', 'Messages', 'Mail', 'Notes', 'More'];

/** Full panel bounds; the caller owns its bottom position and transition. */
export function SystemSharePanels({ width, height, bottomInset = 0, stage, source = 'TikTok', onMore, onNapkin }: SystemSharePanelsProps) {
    return (
        <View style={[s.sheet, { width, height }]}>
            <LinearGradient pointerEvents="none" colors={['rgba(255,255,255,0.045)', 'rgba(255,255,255,0)']} style={StyleSheet.absoluteFill} />
            {stage === 'system'
                ? <SystemPanel width={width} height={height} bottomInset={bottomInset} source={source} onMore={onMore} />
                : <AppsPanel bottomInset={bottomInset} onNapkin={onNapkin} />}
        </View>
    );
}

function SystemPanel({ width, height, bottomInset, source, onMore }: Pick<SystemSharePanelsProps, 'width' | 'height' | 'onMore'> & { bottomInset: number; source: 'TikTok' | 'Instagram' }) {
    const cellWidth = (width - 32) / SHARE_APPS.length;
    const iconSize = Math.min(60, cellWidth - 8);
    // At the smallest presentation the actionable row still ends above the
    // bottom inset; only the decorative action list below it is cropped.
    const compact = height - bottomInset < 370;
    const contactSize = compact ? 48 : 58;
    return (
        <>
            <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <View style={s.grabber} />
                <View style={[s.preview, compact && s.previewCompact]}>
                    <View style={s.previewImage}>
                        <Image source={CLIPS[source]} style={s.fillImage} resizeMode="cover" />
                        <View style={s.previewPlay}><Ionicons name="play" size={15} color={IOS.white} /></View>
                    </View>
                    <View style={s.flex}>
                        <Text numberOfLines={1} allowFontScaling={false} style={s.previewTitle}>3 Soho dinner spots</Text>
                        <Text numberOfLines={1} allowFontScaling={false} style={s.previewURL}>{source === 'TikTok' ? 'tiktok.com' : 'instagram.com'}</Text>
                        {!compact && <Text allowFontScaling={false} style={s.previewOptions}>Options <Ionicons name="chevron-forward" size={11} color={IOS.secondary} /></Text>}
                    </View>
                    <View style={s.close}><Ionicons name="close" size={21} color={IOS.secondary} /></View>
                </View>
                <View style={[s.contacts, compact && s.contactsCompact]}>
                    {AVATARS.map((person) => <View key={person.name} style={[s.contact, { width: cellWidth }]}>
                        <View style={{ width: contactSize, height: contactSize }}>
                            <Image source={person.image} style={[s.avatar, { width: contactSize, height: contactSize }]} />
                            <View style={s.contactBadge}><AppIcon app="Messages" size={18} /></View>
                        </View>
                        <Text numberOfLines={1} allowFontScaling={false} style={s.contactLabel}>{person.name}</Text>
                    </View>)}
                    <View style={[s.contact, { width: cellWidth }]}>
                        <View style={[s.groupAvatar, { width: contactSize, height: contactSize }]}>
                            {AVATARS.map((person, index) => <Image key={person.name} source={person.image} style={[s.groupFace, { width: contactSize * 0.52, height: contactSize * 0.52, left: index === 1 ? contactSize * 0.42 : contactSize * 0.07, top: index === 2 ? contactSize * 0.43 : contactSize * 0.07 }]} />)}
                            <View style={s.contactBadge}><AppIcon app="Messages" size={18} /></View>
                        </View>
                        <Text numberOfLines={1} allowFontScaling={false} style={s.contactLabel}>Dinner club</Text>
                    </View>
                    <View style={[s.contact, { width: cellWidth }]}>
                        <View style={[s.deviceAvatar, { width: contactSize, height: contactSize }]}><Ionicons name="laptop-outline" size={contactSize * 0.54} color={IOS.label} /></View>
                        <Text numberOfLines={1} allowFontScaling={false} style={s.contactLabel}>MacBook</Text>
                    </View>
                </View>
            </View>
            <View style={s.shareRow}>
                {SHARE_APPS.map((app) => app === 'More' ? (
                    <Pressable key={app} accessibilityRole="button" accessibilityLabel="More apps" accessibilityHint="Open the example iPhone Apps list" onPress={onMore}
                        style={({ pressed }) => [s.shareApp, { width: cellWidth, opacity: pressed ? 0.8 : 1 }]}>
                        <View style={[s.targetRing, { width: iconSize + 20, height: iconSize + 38, top: -10 }]} />
                        <AppIcon app={app} size={iconSize} />
                        <Text allowFontScaling={false} style={s.appLabel}>{app}</Text>
                    </Pressable>
                ) : (
                    <View key={app} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[s.shareApp, s.peripheralApp, { width: cellWidth }]}>
                        <AppIcon app={app} size={iconSize} />
                        <Text allowFontScaling={false} style={s.appLabel}>{app}</Text>
                    </View>
                ))}
                <LinearGradient pointerEvents="none" colors={['rgba(29,29,31,0)', 'rgba(29,29,31,0.94)', 'rgba(29,29,31,0)']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[s.guideShade, { right: cellWidth + 8, width: Math.min(width - cellWidth - 38, 210), height: iconSize + 10 }]} />
                <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[s.moreGuide, { right: cellWidth + 20, height: iconSize }]}>
                    <Text allowFontScaling={false} style={s.guideText}>Tap More</Text><Ionicons name="arrow-forward" size={25} color={IOS.white} />
                </View>
            </View>
            <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.actions}>
                <View style={s.actionRow}><Text allowFontScaling={false} style={s.actionText}>Copy</Text><Ionicons name="copy-outline" size={22} color={IOS.label} /></View>
                <View style={s.actionDivider} />
                <View style={s.actionRow}><Text allowFontScaling={false} style={s.actionText}>Add to Reading List</Text><Ionicons name="glasses-outline" size={23} color={IOS.label} /></View>
                <View style={s.actionDivider} />
                <View style={s.actionRow}><Text allowFontScaling={false} style={s.actionText}>Add to Quick Note</Text><Ionicons name="create-outline" size={22} color={IOS.label} /></View>
            </View>
            {bottomInset > 0 && <View pointerEvents="none" style={[s.bottomCover, { height: bottomInset }]} />}
        </>
    );
}

function AppsPanel({ bottomInset, onNapkin }: { bottomInset: number; onNapkin: () => void }) {
    return (
        <>
            <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.appsNavigation}>
                <View style={s.doneCircle}><Ionicons name="checkmark" size={27} color={IOS.white} /></View>
                <Text allowFontScaling={false} style={s.appsTitle}>Apps</Text>
                <View style={s.editPill}><Text allowFontScaling={false} style={s.editText}>Edit</Text></View>
            </View>
            <ScrollView bounces={false} showsVerticalScrollIndicator={false} contentContainerStyle={[s.appsContent, { paddingBottom: Math.max(bottomInset, 20) }]}>
                <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                    <Text allowFontScaling={false} style={s.groupHeading}>Favorites</Text>
                    <View style={s.appGroup}>
                        <AppListRow app="AirDrop" />
                        <AppListRow app="Messages" />
                        <AppListRow app="Mail" last />
                    </View>
                    <Text allowFontScaling={false} style={s.groupHeading}>Suggestions</Text>
                </View>
                <View style={s.appGroup}>
                    <Pressable accessibilityRole="button" accessibilityLabel="Choose Napkin" accessibilityHint="Open Napkin’s example share extension" onPress={onNapkin}
                        style={({ pressed }) => [s.napkinRow, { opacity: pressed ? 0.8 : 1 }]}>
                        <AppIcon app="Napkin" size={36} />
                        <Text allowFontScaling={false} style={s.napkinLabel}>Napkin</Text>
                        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.napkinGuide}>
                            <Ionicons name="arrow-back" size={22} color={IOS.white} />
                            <Text allowFontScaling={false} style={s.napkinGuideText}>Tap Napkin</Text>
                        </View>
                    </Pressable>
                    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                        <AppListRow app="Notes" />
                        <AppListRow app="Reminders" last />
                    </View>
                </View>
                <Text pointerEvents="none" accessible={false} allowFontScaling={false} style={s.favoritesTip}>For next time: Edit → add Napkin to Favorites.</Text>
            </ScrollView>
        </>
    );
}

function AppListRow({ app, last = false }: { app: AppName; last?: boolean }) {
    return <View style={s.appListRow}>
        <AppIcon app={app} size={31} />
        <View style={[s.appListLabel, !last && s.appListRule]}><Text allowFontScaling={false} style={s.appListText}>{app}</Text></View>
    </View>;
}

function AppIcon({ app, size }: { app: AppName; size: number }) {
    const shape = { width: size, height: size, borderRadius: size * 0.225 };
    if (app === 'Napkin') return <Image source={ICON} style={shape} accessible={false} />;
    if (app === 'More') return <View style={[s.appIcon, shape, s.moreIcon]}><Ionicons name="ellipsis-horizontal" size={size * 0.5} color="#77777b" /></View>;
    if (app === 'Notes') return <View style={[s.appIcon, shape, s.notesIcon]}>
        <LinearGradient colors={['#ffdf51', '#ffcc00']} style={{ position: 'absolute', left: 0, right: 0, top: 0, height: size * 0.29 }} />
        {[0.43, 0.6, 0.77].map((top) => <View key={top} style={{ position: 'absolute', height: 0.6, left: 0, right: 0, top: size * top, backgroundColor: '#c8c8c8' }} />)}
    </View>;
    if (app === 'Reminders') return <View style={[s.appIcon, shape, s.notesIcon]}>
        {['#007aff', '#ff9500', '#ff3b30'].map((color, index) => <View key={color} style={{ position: 'absolute', left: size * 0.17, top: size * (0.23 + index * 0.24), flexDirection: 'row', alignItems: 'center', gap: size * 0.1 }}>
            <View style={{ width: size * 0.13, height: size * 0.13, borderRadius: size * 0.1, backgroundColor: color }} />
            <View style={{ width: size * 0.43, height: 1, backgroundColor: '#c8c8c8' }} />
        </View>)}
    </View>;
    const colors = app === 'Messages' ? ['#65e85a', '#1cc73b'] as const : app === 'Mail' ? ['#1473f5', '#4ec3fa'] as const : ['#68b9fc', '#0878db'] as const;
    return <LinearGradient colors={colors} style={[s.appIcon, shape]}>
        {app === 'AirDrop' ? <View style={[s.airDropMark, { width: size * 0.7, height: size * 0.7 }]}>
            {[1, 0.73, 0.45].map((scale) => <View key={scale} style={{ position: 'absolute', width: size * 0.7 * scale, height: size * 0.7 * scale, borderRadius: size, borderWidth: Math.max(1, size * 0.025), borderColor: 'rgba(255,255,255,0.86)' }} />)}
            <View style={{ width: size * 0.1, height: size * 0.1, borderRadius: size, backgroundColor: IOS.white }} />
            <View style={{ position: 'absolute', bottom: -size * 0.04, width: 0, height: 0, borderLeftWidth: size * 0.14, borderRightWidth: size * 0.14, borderBottomWidth: size * 0.23, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: IOS.white }} />
        </View> : <Ionicons name={app === 'Messages' ? 'chatbubble' : 'mail-outline'} size={size * (app === 'Messages' ? 0.71 : 0.76)} color={IOS.white} />}
    </LinearGradient>;
}

const s = StyleSheet.create({
    sheet: { backgroundColor: IOS.sheet, borderTopLeftRadius: 35, borderTopRightRadius: 35, overflow: 'hidden', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.14)' },
    flex: { flex: 1 },
    fillImage: { position: 'absolute', width: '100%', height: '100%' },
    grabber: { width: 36, height: 5, marginTop: 8, marginBottom: 13, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)', alignSelf: 'center' },
    preview: { flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 18, paddingBottom: 18, opacity: 0.68 },
    previewCompact: { paddingBottom: 14 },
    previewImage: { width: 47, height: 52, borderRadius: 8, overflow: 'hidden', backgroundColor: '#343438' },
    previewPlay: { position: 'absolute', bottom: 5, right: 4, width: 22, height: 22, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
    previewTitle: { fontFamily: IOS.font, fontSize: 16, lineHeight: 20, fontWeight: '600', color: IOS.label },
    previewURL: { fontFamily: IOS.font, fontSize: 13, lineHeight: 18, color: IOS.secondary, marginTop: 2 },
    previewOptions: { fontFamily: IOS.font, fontSize: 13, lineHeight: 17, color: IOS.secondary, marginTop: 2 },
    close: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: IOS.group, alignSelf: 'flex-start' },
    contacts: { flexDirection: 'row', paddingHorizontal: 16, paddingBottom: 19, paddingTop: 4, borderBottomWidth: 0.5, borderBottomColor: IOS.separator, opacity: 0.46 },
    contactsCompact: { paddingBottom: 15, paddingTop: 0 },
    contact: { alignItems: 'center', gap: 7 },
    avatar: { borderRadius: 40, borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.22)' },
    contactBadge: { position: 'absolute', bottom: -1, right: -1, borderWidth: 2, borderColor: '#272729', borderRadius: 6 },
    contactLabel: { fontFamily: IOS.font, fontSize: 11, lineHeight: 14, color: IOS.label },
    groupAvatar: { borderRadius: 40, backgroundColor: '#42454d' },
    groupFace: { position: 'absolute', borderRadius: 20, borderWidth: 1, borderColor: '#42454d' },
    deviceAvatar: { borderRadius: 40, backgroundColor: '#414149', alignItems: 'center', justifyContent: 'center' },
    shareRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 23, paddingBottom: 24 },
    shareApp: { alignItems: 'center', gap: 8, minHeight: 80 },
    peripheralApp: { opacity: 0.4 },
    appIcon: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
    moreIcon: { backgroundColor: IOS.white },
    notesIcon: { backgroundColor: '#fafafa' },
    airDropMark: { alignItems: 'center', justifyContent: 'center' },
    appLabel: { fontFamily: IOS.font, fontSize: 13, lineHeight: 16, color: IOS.label },
    targetRing: { position: 'absolute', borderRadius: 46, borderWidth: 2, borderColor: 'rgba(255,255,255,0.72)', backgroundColor: 'rgba(255,255,255,0.07)' },
    guideShade: { position: 'absolute', top: 18 },
    moreGuide: { position: 'absolute', top: 23, flexDirection: 'row', alignItems: 'center', gap: 7 },
    guideText: { fontFamily: IOS.font, fontSize: 22, lineHeight: 28, fontWeight: '700', color: IOS.white },
    actions: { marginHorizontal: 16, borderRadius: 13, backgroundColor: IOS.group, opacity: 0.46 },
    actionRow: { height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 17 },
    actionDivider: { height: 0.5, marginLeft: 17, backgroundColor: IOS.separator },
    actionText: { fontFamily: IOS.font, fontSize: 17, lineHeight: 22, color: IOS.label },
    bottomCover: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: '#1d1d1f' },
    appsNavigation: { height: 81, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
    doneCircle: { width: 44, height: 44, borderRadius: 22, backgroundColor: IOS.blue, alignItems: 'center', justifyContent: 'center', opacity: 0.65 },
    appsTitle: { position: 'absolute', left: 80, right: 80, textAlign: 'center', fontFamily: IOS.font, fontSize: 17, lineHeight: 22, fontWeight: '600', color: IOS.label },
    editPill: { minWidth: 62, height: 42, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 0.5, borderColor: 'rgba(255,255,255,0.12)' },
    editText: { fontFamily: IOS.font, fontSize: 17, lineHeight: 22, fontWeight: '600', color: '#d3d3d7' },
    appsContent: { paddingHorizontal: 16 },
    favoritesTip: { fontFamily: IOS.font, fontSize: 17, lineHeight: 23, color: IOS.secondary, marginHorizontal: 6, marginTop: 10 },
    groupHeading: { fontFamily: IOS.font, fontSize: 15, lineHeight: 20, fontWeight: '600', color: IOS.secondary, paddingHorizontal: 6, marginTop: 12, marginBottom: 9 },
    appGroup: { borderRadius: 17, overflow: 'hidden', backgroundColor: IOS.group, marginBottom: 9 },
    appListRow: { flexDirection: 'row', alignItems: 'center', paddingLeft: 15, gap: 13, height: 53, opacity: 0.58 },
    appListLabel: { flex: 1, alignSelf: 'stretch', justifyContent: 'center' },
    appListRule: { borderBottomWidth: 0.5, borderBottomColor: IOS.separator },
    appListText: { fontFamily: IOS.font, fontSize: 17, lineHeight: 22, color: IOS.label },
    napkinRow: { minHeight: 66, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(255,255,255,0.065)', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.72)', borderRadius: 17 },
    napkinLabel: { fontFamily: IOS.font, fontSize: 17, lineHeight: 22, color: IOS.white },
    napkinGuide: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
    napkinGuideText: { fontFamily: IOS.font, fontSize: 17, lineHeight: 22, fontWeight: '700', color: IOS.white },
});
