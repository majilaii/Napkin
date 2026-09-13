import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { DEMO_CLIPS, ExternalUI as C, type DemoSource } from './demoContent';

type Icon = React.ComponentProps<typeof Ionicons>['name'];
const AVATARS = [require('@/assets/guide/clara.jpg'), require('@/assets/guide/julian.jpg')];

/** One continuous source screen remains underneath every sharing layer. */
export function SourceAppScene({ source, top, bottom, active, onShare }: {
    source: DemoSource; top: number; bottom: number; active: boolean; onShare: () => void;
}) {
    const instagram = source === 'Instagram';
    return <View style={s.scene}>
        <View style={[s.video, { bottom: bottom + 54 }]}>
            <Image source={DEMO_CLIPS[source]} style={s.photo} resizeMode="cover" accessible={false} />
            <LinearGradient colors={[C.shadow, C.clear, C.shadow]} locations={[0, 0.42, 1]} style={StyleSheet.absoluteFill} />
            <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[s.sourceNav, { top }]}>
                {instagram ? <><Text allowFontScaling={false} style={s.reelsTitle}>Reels</Text><Ionicons name="camera-outline" size={25} color={C.white} /></> : <>
                    <Ionicons name="tv-outline" size={23} color={C.white} />
                    <View style={s.feedTabs}><Text allowFontScaling={false} style={s.tabMuted}>Following</Text><View><Text allowFontScaling={false} style={s.tabActive}>For You</Text><View style={s.activeRule} /></View></View>
                    <Ionicons name="search-outline" size={26} color={C.white} />
                </>}
            </View>
            <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.videoTitle}>
                <Text allowFontScaling={false} style={s.videoKicker}>THE DINNER SHORTLIST</Text>
                <Text allowFontScaling={false} style={s.videoWords}>3 Soho spots{ '\n' }worth saving</Text>
                <Text allowFontScaling={false} style={s.videoNames}>Barrafina · Kiln · Bocca di Lupo</Text>
            </View>
            <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.caption}>
                <View style={s.location}><Ionicons name="location" size={13} color={C.white} /><Text allowFontScaling={false} style={s.locationText}>Soho, London</Text></View>
                <Text allowFontScaling={false} style={s.handle}>napkin.demo</Text>
                <Text allowFontScaling={false} style={s.captionText}>Your next dinner, sorted. Save these{ '\n' }for later. #soho #londonfood</Text>
                <View style={s.music}><Ionicons name="musical-notes" size={13} color={C.white} /><Text allowFontScaling={false} style={s.captionMeta}>original sound · napkin.demo</Text></View>
            </View>
            <View style={s.rail}>
                {!instagram ? <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.avatarWrap}><Image source={AVATARS[0]} style={s.avatar} accessible={false} /><View style={s.follow}><Ionicons name="add" size={15} color={C.white} /></View></View> : null}
                <RailItem icon={instagram ? 'heart-outline' : 'heart'} count="2,418" />
                <RailItem icon={instagram ? 'chatbubble-outline' : 'chatbubble-ellipses'} count="32" />
                <RailItem icon={instagram ? 'repeat-outline' : 'bookmark'} count={instagram ? '18' : '486'} />
                <Pressable onPress={onShare} disabled={!active} accessible={active} accessibilityRole="button" accessibilityLabel={`Share ${source} video`}
                    style={({ pressed }) => [s.railItem, { opacity: pressed ? 0.7 : 1 }]}>
                    {active ? <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.targetRing} /> : null}
                    <Ionicons name={instagram ? 'paper-plane-outline' : 'arrow-redo'} size={31} color={C.white} />
                    <Text allowFontScaling={false} style={s.railCount}>{instagram ? '154' : 'Share'}</Text>
                    {active ? <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.shareCoach}><Text allowFontScaling={false} style={s.coachText}>Tap Share</Text><Ionicons name="arrow-forward" size={25} color={C.white} /></View> : null}
                </Pressable>
                <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.record}>{instagram ? <Ionicons name="ellipsis-horizontal" size={24} color={C.white} /> : <Image source={DEMO_CLIPS[source]} style={s.recordPhoto} accessible={false} />}</View>
            </View>
            <View style={s.videoProgress} />
        </View>
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[s.nav, { height: 54 + bottom, paddingBottom: bottom }]}>
            <NavItem icon={instagram ? 'home-outline' : 'home'} label="Home" instagram={instagram} />
            <NavItem icon={instagram ? 'search-outline' : 'people-outline'} label="Friends" instagram={instagram} />
            {instagram ? <Ionicons name="add-circle-outline" size={27} color={C.white} /> : <View style={s.newVideoSides}><View style={s.newVideo}><Ionicons name="add" size={24} color={C.background} /></View></View>}
            <NavItem icon={instagram ? 'play-circle-outline' : 'chatbox-outline'} label="Inbox" instagram={instagram} />
            <NavItem icon="person-outline" label="Profile" instagram={instagram} />
        </View>
    </View>;
}

function RailItem({ icon, count }: { icon: Icon; count: string }) {
    return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.railItem}><Ionicons name={icon} size={31} color={C.white} /><Text allowFontScaling={false} style={s.railCount}>{count}</Text></View>;
}
function NavItem({ icon, label, instagram }: { icon: Icon; label: string; instagram: boolean }) {
    return <View style={s.navItem}><Ionicons name={icon} size={24} color={C.white} />{!instagram ? <Text allowFontScaling={false} style={s.navLabel}>{label}</Text> : null}</View>;
}

/** A source-specific drawer, with the source clip still visible above it. */
export function SourceSharePanel({ source, bottom, onMore }: { source: DemoSource; bottom: number; onMore: () => void }) {
    const instagram = source === 'Instagram';
    const recipients = instagram ? ['Clara', 'Julian', 'Dinner plans'] : ['Clara', 'Julian', 'Dinner plans', 'New chat'];
    return <View style={[s.drawer, { paddingBottom: Math.max(bottom, 18) }]}>
        <View style={s.grabber} />
        {instagram ? <View style={s.search}><Ionicons name="search-outline" size={19} color={C.muted} /><Text allowFontScaling={false} style={s.searchText}>Search</Text></View> : <View style={s.drawerHeader}><Text allowFontScaling={false} style={s.drawerTitle}>Send to</Text><Ionicons name="search-outline" size={21} color={C.white} /></View>}
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.people}>
            {recipients.map((name, i) => <View key={name} style={s.person}>
                {i < 2 ? <Image source={AVATARS[i]} style={s.personPhoto} accessible={false} /> : <View style={[s.personPhoto, s.group]}><Ionicons name={i === 2 ? 'people' : 'add'} size={27} color={C.white} /></View>}
                <Text allowFontScaling={false} style={s.personName}>{name}</Text>
            </View>)}
        </View>
        <View style={s.divider} />
        <View style={s.shareApps}>
            <ShareApp label="Copy link" icon="link" color={C.raised} />
            <ShareApp label="WhatsApp" icon="logo-whatsapp" color={C.green} />
            <ShareApp label="Messages" icon="chatbubble" color={C.green} />
            <Pressable accessibilityRole="button" accessibilityLabel="More sharing options" onPress={onMore} style={({ pressed }) => [s.shareApp, { opacity: pressed ? 0.7 : 1 }]}>
                <View style={[s.roundIcon, s.moreIcon]}><Ionicons name={instagram ? 'share-outline' : 'ellipsis-horizontal'} size={27} color={C.white} /><View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.moreRing} /></View>
                <Text allowFontScaling={false} style={s.personName}>{instagram ? 'Share to…' : 'More'}</Text>
            </Pressable>
        </View>
        <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.moreCoach}><Text allowFontScaling={false} style={s.coachText}>{instagram ? 'Tap Share to…' : 'Tap More'}</Text><Ionicons name="arrow-up" size={22} color={C.white} /></View>
        {!instagram ? <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.secondaryActions}><ShareApp label="Report" icon="flag-outline" color={C.raised} /><ShareApp label="Not interested" icon="heart-dislike-outline" color={C.raised} /><ShareApp label="Save video" icon="download-outline" color={C.raised} /><ShareApp label="Duet" icon="albums-outline" color={C.raised} /></View> : null}
    </View>;
}
function ShareApp({ label, icon, color }: { label: string; icon: Icon; color: string }) {
    return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={s.shareApp}><View style={[s.roundIcon, { backgroundColor: color }]}><Ionicons name={icon} size={26} color={C.white} /></View><Text allowFontScaling={false} style={s.personName}>{label}</Text></View>;
}

const s = StyleSheet.create({
    scene: { flex: 1, backgroundColor: C.background }, video: { position: 'absolute', top: 0, left: 0, right: 0 },
    photo: { position: 'absolute', width: '100%', height: '100%' },
    sourceNav: { position: 'absolute', left: 18, right: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    feedTabs: { flexDirection: 'row', gap: 24 }, tabMuted: { color: C.muted, fontSize: 17, fontWeight: '600' }, tabActive: { color: C.white, fontSize: 17, fontWeight: '700' },
    activeRule: { height: 3, width: 28, backgroundColor: C.white, alignSelf: 'center', marginTop: 7, borderRadius: 3 }, reelsTitle: { fontSize: 25, fontWeight: '700', color: C.white },
    videoTitle: { position: 'absolute', top: '35%', left: 24, right: 68, alignItems: 'center' },
    videoKicker: { color: C.white, fontSize: 11, fontWeight: '700', letterSpacing: 2, marginBottom: 8, textShadowColor: C.shadow, textShadowRadius: 8 },
    videoWords: { color: C.white, fontWeight: '800', fontSize: 34, lineHeight: 36, textAlign: 'center', letterSpacing: -1.1, textShadowColor: C.shadow, textShadowRadius: 10 },
    videoNames: { color: C.white, fontSize: 11, fontWeight: '500', marginTop: 10, textAlign: 'center', textShadowColor: C.shadow, textShadowRadius: 8 },
    rail: { position: 'absolute', right: 8, bottom: 20, width: 50, alignItems: 'center', gap: 14 }, railItem: { width: 50, minHeight: 48, alignItems: 'center', justifyContent: 'center', gap: 3 },
    railCount: { fontSize: 12, fontWeight: '600', color: C.white, textShadowColor: C.shadow, textShadowRadius: 4 },
    avatarWrap: { marginBottom: 7 }, avatar: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: C.white },
    follow: { position: 'absolute', bottom: -7, left: 12, backgroundColor: C.pink, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
    record: { width: 34, height: 34, backgroundColor: C.raised, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginTop: 4 }, recordPhoto: { width: 21, height: 21, borderRadius: 11 },
    caption: { position: 'absolute', left: 14, bottom: 22, right: 78, gap: 7 }, location: { flexDirection: 'row', gap: 4, alignItems: 'center', alignSelf: 'flex-start', borderRadius: 4, padding: 5, backgroundColor: C.scrim },
    locationText: { fontSize: 12, color: C.white }, handle: { fontSize: 16, color: C.white, fontWeight: '700' }, captionText: { fontSize: 13, lineHeight: 18, color: C.white }, music: { flexDirection: 'row', gap: 7, alignItems: 'center' }, captionMeta: { fontSize: 12, color: C.white },
    nav: { position: 'absolute', bottom: 0, left: 0, right: 0, backgroundColor: C.background, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }, navItem: { alignItems: 'center', gap: 3, width: 54 }, navLabel: { fontSize: 11, color: C.white },
    newVideoSides: { width: 47, height: 29, borderRadius: 7, backgroundColor: C.teal, borderRightColor: C.pink, borderRightWidth: 5, paddingLeft: 4 }, newVideo: { backgroundColor: C.white, borderRadius: 6, width: 39, height: 29, alignItems: 'center', justifyContent: 'center' },
    videoProgress: { position: 'absolute', bottom: 1, left: 0, width: '31%', height: 2, backgroundColor: C.white },
    targetRing: { position: 'absolute', width: 66, height: 66, borderWidth: 2, borderColor: C.ring, borderRadius: 33 }, shareCoach: { position: 'absolute', right: 64, flexDirection: 'row', alignItems: 'center', gap: 10, width: 160, justifyContent: 'flex-end' }, coachText: { fontSize: 18, fontWeight: '700', color: C.white, textShadowColor: C.shadow, textShadowRadius: 6 },
    drawer: { borderTopLeftRadius: 24, borderTopRightRadius: 24, backgroundColor: C.sheet, paddingTop: 10, paddingHorizontal: 16 }, grabber: { height: 4, width: 36, borderRadius: 2, backgroundColor: C.muted, opacity: 0.6, alignSelf: 'center', marginBottom: 16 },
    drawerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }, drawerTitle: { fontSize: 17, fontWeight: '700', color: C.white }, search: { borderRadius: 24, backgroundColor: C.field, padding: 12, flexDirection: 'row', gap: 10, alignItems: 'center', marginBottom: 20 }, searchText: { fontSize: 16, color: C.muted },
    people: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 20 }, person: { flex: 1, alignItems: 'center', gap: 8 }, personPhoto: { width: 55, height: 55, borderRadius: 28 }, group: { backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' }, personName: { fontSize: 12, lineHeight: 16, color: C.white, textAlign: 'center' }, divider: { height: StyleSheet.hairlineWidth, backgroundColor: C.rule },
    shareApps: { flexDirection: 'row', paddingTop: 18, paddingBottom: 4 }, shareApp: { flex: 1, alignItems: 'center', gap: 9 }, roundIcon: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' }, moreIcon: { backgroundColor: C.raised }, moreRing: { position: 'absolute', top: -7, left: -7, width: 68, height: 68, borderRadius: 34, borderWidth: 2, borderColor: C.ring }, moreCoach: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 23, gap: 12, marginTop: 16, marginBottom: 12 }, secondaryActions: { flexDirection: 'row', paddingTop: 10, opacity: 0.6 },
});
