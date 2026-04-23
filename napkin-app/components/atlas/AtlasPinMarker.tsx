/**
 * AtlasPinMarker — identity-forward pin primitives for the Atlas map view.
 *
 * Design doctrine:
 *   Pin = who went. Rating + details = peek sheet on tap. No rating on the pin.
 *
 * Components:
 *   PersonDisc       — 1 disc (initial + deterministic tint from user_id)
 *   PersonCluster    — 1-4 discs arranged in a tight cluster at the geo-point.
 *                      5+ members: 3 discs + a "+N" disc.
 *                      If hasRound = true: a faint terracotta ring encloses the cluster.
 *                      If wishedByViewer = true: small terracotta outline heart
 *                      tucked top-left, overlapping the cluster edge.
 *
 * Color palette (matches components/feed/Avatar tint logic — deterministic by
 * initial char code modulo 3). With 3 tints, colors can collide across 6+
 * Tablemates; initials disambiguate.
 *
 * Wireframe reference: see 2026-04-23 pin-redesign discussion.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';

// ── Constants ─────────────────────────────────────────────────────────────────

const TERRACOTTA = '#a03f28';
const CREAM = '#fdf6ec';

// Ambient shadow — softer than standalone pins since discs stack
const DISC_SHADOW = {
    shadowColor: '#1c1c19',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.10,
    shadowRadius: 3,
    elevation: 2,
} as const;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PersonMember {
    user_id: string;
    display_name: string;
}

export interface PersonClusterProps {
    /** All Tablemates who visited, in display order. Current user should be last. */
    members: PersonMember[];
    /** True if any visit at this restaurant was a Round (group event). */
    hasRound?: boolean;
    /** True if the viewer wishlisted this restaurant before visiting. */
    wishedByViewer?: boolean;
    palette?: typeof Colors.light;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Deterministic tint from a user identity string. Matches Avatar's logic
 * (initial char code % 3), so a person's pin color equals their avatar color.
 */
function tintFor(
    seed: string,
    palette: typeof Colors.light,
): string {
    const tints = [
        palette.tertiaryFixed,     // amber-cream
        palette.secondaryContainer, // olive-cream
        palette.primaryMuted,      // terracotta-muted
    ];
    return tints[(seed.charCodeAt(0) || 0) % tints.length];
}

function initialOf(name: string): string {
    return (name[0] ?? '?').toUpperCase();
}

// ── HeartOverlay ──────────────────────────────────────────────────────────────

function HeartOverlay() {
    return (
        <View style={styles.heartWrap} pointerEvents="none">
            <Ionicons name="heart-outline" size={12} color={TERRACOTTA} />
        </View>
    );
}

// ── PersonDisc ────────────────────────────────────────────────────────────────

interface PersonDiscProps {
    member: PersonMember;
    size: number;
    palette: typeof Colors.light;
}

export function PersonDisc({ member, size, palette }: PersonDiscProps) {
    const tint = tintFor(member.user_id || member.display_name, palette);
    const initial = initialOf(member.display_name);

    return (
        <View
            style={[
                {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: tint,
                    borderWidth: 1.5,
                    borderColor: CREAM,
                },
                styles.discCenter,
                DISC_SHADOW,
            ]}
        >
            <Text
                style={[
                    styles.discInitial,
                    { fontSize: size * 0.46, color: palette.text },
                ]}
            >
                {initial}
            </Text>
        </View>
    );
}

// ── PersonCluster ─────────────────────────────────────────────────────────────

export function PersonCluster({
    members,
    hasRound = false,
    wishedByViewer = false,
    palette: paletteProp,
}: PersonClusterProps) {
    const palette = paletteProp ?? Colors.light;

    if (members.length === 0) {
        // Defensive: a tile without members shouldn't happen, but render a
        // placeholder dot rather than crash.
        return (
            <View style={styles.outer}>
                <View style={[styles.placeholderDot, DISC_SHADOW]} />
            </View>
        );
    }

    // Single person → one full-size disc
    if (members.length === 1) {
        return (
            <View style={styles.outer}>
                {wishedByViewer && <HeartOverlay />}
                {hasRound && <View style={styles.singleRoundRing} pointerEvents="none" />}
                <PersonDisc member={members[0]} size={26} palette={palette} />
            </View>
        );
    }

    // 2-4+ members → cluster of smaller discs
    const isOverflow = members.length > 4;
    const visible = isOverflow ? members.slice(0, 3) : members.slice(0, 4);
    const overflowCount = isOverflow ? members.length - visible.length : 0;

    const discSize = 20;

    // Layout strategy by count
    //  2: two discs side-by-side, slight overlap
    //  3: triangle (two on top, one below)
    //  4: 2x2 grid
    const layoutStyle: React.ComponentProps<typeof View>['style'] =
        visible.length === 2 || (visible.length === 3 && isOverflow)
            ? styles.rowLayout
            : visible.length === 3
              ? styles.triangleLayout
              : styles.gridLayout;

    return (
        <View style={styles.outer}>
            {wishedByViewer && <HeartOverlay />}
            {hasRound && <View style={styles.clusterRoundRing} pointerEvents="none" />}

            <View style={layoutStyle}>
                {visible.map((member, i) => (
                    <View
                        key={member.user_id}
                        style={[
                            // Overlap siblings slightly
                            i > 0 && styles.discOverlap,
                        ]}
                    >
                        <PersonDisc member={member} size={discSize} palette={palette} />
                    </View>
                ))}
                {overflowCount > 0 && (
                    <View style={styles.discOverlap}>
                        <View
                            style={[
                                {
                                    width: discSize,
                                    height: discSize,
                                    borderRadius: discSize / 2,
                                    backgroundColor: palette.surfaceContainerHigh,
                                    borderWidth: 1.5,
                                    borderColor: CREAM,
                                },
                                styles.discCenter,
                                DISC_SHADOW,
                            ]}
                        >
                            <Text
                                style={[
                                    styles.discInitial,
                                    {
                                        fontSize: 9,
                                        color: palette.textSecondary,
                                        fontFamily: 'Manrope_600SemiBold',
                                        fontStyle: 'normal',
                                    },
                                ]}
                            >
                                {`+${overflowCount}`}
                            </Text>
                        </View>
                    </View>
                )}
            </View>
        </View>
    );
}

// ── SimplePin ─────────────────────────────────────────────────────────────────
// Rendered at lower zoom levels. Small, legible at distance. Three variants:
//   solo  — plain terracotta circle, cream interior
//   round — same + 1.5px olive ring (group signal)
//   mixed — round shell + 4px amber edge-dot at 4 o'clock

export type PinType = 'solo' | 'round' | 'mixed';

export interface SimplePinProps {
    type: PinType;
    wishedByViewer?: boolean;
}

const SIMPLE_DIAMETER = 14;
const SIMPLE_RING_DIAMETER = 18; // outer olive ring for round/mixed

export function SimplePin({ type, wishedByViewer = false }: SimplePinProps) {
    const isRoundish = type === 'round' || type === 'mixed';

    return (
        <View style={styles.outer}>
            {wishedByViewer && <HeartOverlay />}

            {isRoundish ? (
                <View style={[styles.simpleRing, DISC_SHADOW]}>
                    <View style={styles.simpleInner} />
                    {type === 'mixed' && <View style={styles.simpleAmberDot} />}
                </View>
            ) : (
                <View style={[styles.simpleSolo, DISC_SHADOW]} />
            )}
        </View>
    );
}

// ── Legacy re-exports so callers don't break while we migrate ─────────────────

/** @deprecated — kept to prevent stale imports. */
export function SoloPin() {
    return null;
}
/** @deprecated */
export function RoundPin() {
    return null;
}
/** @deprecated */
export function MixedPin() {
    return null;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    outer: {
        position: 'relative',
        alignItems: 'center',
        justifyContent: 'center',
    },

    heartWrap: {
        position: 'absolute',
        top: -6,
        left: -6,
        zIndex: 10,
    },

    discCenter: {
        alignItems: 'center',
        justifyContent: 'center',
    },

    discInitial: {
        fontFamily: 'Newsreader_400Regular_Italic',
        includeFontPadding: false,
        textAlign: 'center',
    },

    discOverlap: {
        marginLeft: -6,
    },

    // Defensive placeholder for zero-member cluster
    placeholderDot: {
        width: 16,
        height: 16,
        borderRadius: 8,
        backgroundColor: TERRACOTTA,
        borderWidth: 1.5,
        borderColor: CREAM,
    },

    // Layouts
    rowLayout: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    triangleLayout: {
        // Two on top, one below — implemented as a row of 2 with a 3rd tucked under
        // Simpler fallback for now: render as row. Real triangle can come later.
        flexDirection: 'row',
        alignItems: 'center',
    },
    gridLayout: {
        flexDirection: 'row',
        flexWrap: 'wrap',
        width: 34, // 20 + 20 - 6 overlap
        alignItems: 'center',
    },

    // Round ring — faint terracotta outline enclosing the cluster
    // Single-person round ring
    singleRoundRing: {
        position: 'absolute',
        width: 34,
        height: 34,
        borderRadius: 17,
        borderWidth: 1.5,
        borderColor: 'rgba(160, 63, 40, 0.45)',
        zIndex: 1,
    },
    // Cluster round ring — wider to enclose multi-disc cluster
    clusterRoundRing: {
        position: 'absolute',
        left: -4,
        right: -4,
        top: -4,
        bottom: -4,
        borderRadius: 999,
        borderWidth: 1.5,
        borderColor: 'rgba(160, 63, 40, 0.35)',
        zIndex: 1,
    },

    // ── SimplePin (zoomed-out) ────────────────────────────────────────────────
    // Solo = plain terracotta-bordered cream disc
    simpleSolo: {
        width: 14,
        height: 14,
        borderRadius: 7,
        backgroundColor: TERRACOTTA,
        borderWidth: 1.5,
        borderColor: CREAM,
    },
    // Round/mixed = small olive ring around terracotta disc
    simpleRing: {
        width: 18,
        height: 18,
        borderRadius: 9,
        backgroundColor: '#5c614d', // olive ring
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: CREAM,
    },
    simpleInner: {
        width: 12,
        height: 12,
        borderRadius: 6,
        backgroundColor: TERRACOTTA,
    },
    simpleAmberDot: {
        position: 'absolute',
        width: 5,
        height: 5,
        borderRadius: 2.5,
        backgroundColor: '#b8842a',
        right: -1,
        bottom: 1,
        borderWidth: 0.8,
        borderColor: CREAM,
    },
});
