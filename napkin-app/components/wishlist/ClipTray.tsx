/**
 * ClipTray — the Places doorway for starting and reviewing imports.
 *
 * The needs-look badge reflects the mounted first exhausted page only (up to
 * 50 items). ImportLinkSheet is intentionally nested inside this Modal: under
 * RN Fabric a sibling Modal cannot present over an already-open Modal. Routes
 * likewise push only from the tray Modal's dismissal completion (with the
 * Android requestAnimationFrame fallback), so back returns to Places closed.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    KeyboardAvoidingView,
    Keyboard,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    Text,
    TextInput,
    View,
    type DimensionValue,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Colors, Radius, Shadow, Spacing, Type } from '@/constants/theme';
import { classifyImportInput } from '@/lib/importInput';
import { isVideoImportAvailable } from '@/modules/media-extract';
import type { ClipLedgerRow } from './clipTrayUtils';
import { ImportLinkSheet } from './ImportLinkSheet';
import { SnapSheet, type SnapSheetHandle } from '@/components/sheets/SnapSheet';
import { FULL, HALF, PEEK } from '@/components/sheets/snapSheetMath';
import { useToast } from '@/providers/ToastProvider';
import { maybeOfferNotifPrompt } from '@/lib/localNotify';

type Palette = typeof Colors.light;
type ImportOpenTo = 'menu' | 'video' | 'screenshot';

const VIDEO_IMPORT_AVAILABLE = Platform.OS === 'ios' && isVideoImportAvailable();

interface ClipTrayProps {
    visible: boolean;
    onDismiss: () => void;
    palette: Palette;
    rows: ClipLedgerRow[];
    hasOlder: boolean;
    isEmpty: boolean;
}

export function ClipTray({
    visible,
    onDismiss,
    palette,
    rows,
    hasOlder,
    isEmpty,
}: ClipTrayProps) {
    const insets = useSafeAreaInsets();
    const router = useRouter();
    const toast = useToast();
    const queuedVideoRef = useRef(false);
    const [inputValue, setInputValue] = useState('');
    const [importOpen, setImportOpen] = useState(false);
    const [pendingUrl, setPendingUrl] = useState<string | undefined>();
    const [pendingText, setPendingText] = useState<string | undefined>();
    const [pendingOpenTo, setPendingOpenTo] = useState<ImportOpenTo>('menu');
    const sheetRef = useRef<SnapSheetHandle>(null);
    const [trayHeight, setTrayHeight] = useState(0);
    const trayMetrics = useMemo(() => ({
        peekRatio: 0, peekFloor: 0, halfRatio: 0.64,
        fullRatio: trayHeight > 0 ? Math.min(0.96, 1 - insets.top / trayHeight) : 0.96,
    }), [insets.top, trayHeight]);
    const pendingRouteRef = useRef<string | null>(null);
    const androidFrameRef = useRef<number | null>(null);
    // A link, or a pasted message/list of places (read for every name in it).
    const input = classifyImportInput(inputValue);
    const inputOk = input.kind !== 'empty';

    const finishNavigation = useCallback(() => {
        if (queuedVideoRef.current) {
            queuedVideoRef.current = false;
            toast.show('video added; we’ll let you know when it’s ready', {
                label: 'view', onPress: () => router.push('/import-progress'),
            });
            void maybeOfferNotifPrompt();
        }
        const route = pendingRouteRef.current;
        if (!route) return;
        pendingRouteRef.current = null;
        router.push(route as never);
    }, [router, toast]);

    const dismissTray = useCallback(() => {
        pendingRouteRef.current = null;
        onDismiss();
    }, [onDismiss]);

    const openRoute = useCallback((route: string | null) => {
        if (!route) return;
        pendingRouteRef.current = route;
        onDismiss();
        if (Platform.OS === 'android') {
            androidFrameRef.current = requestAnimationFrame(finishNavigation);
        }
    }, [finishNavigation, onDismiss]);

    const openImport = useCallback((openTo: ImportOpenTo, url?: string, text?: string) => {
        setPendingOpenTo(openTo);
        setPendingUrl(url);
        setPendingText(text);
        setImportOpen(true);
    }, []);

    const openLink = useCallback(() => {
        if (input.kind === 'url') openImport('menu', input.url);
        else if (input.kind === 'text') openImport('menu', undefined, input.text);
    }, [input, openImport]);

    useEffect(() => () => {
        if (androidFrameRef.current !== null) {
            cancelAnimationFrame(androidFrameRef.current);
        }
    }, []);

    return (
        <Modal
            visible={visible}
            transparent
            animationType="slide"
            onRequestClose={dismissTray}
            onDismiss={finishNavigation}
        >
            <GestureHandlerRootView style={styles.backdrop}>
                <Pressable
                    style={[StyleSheet.absoluteFill, { backgroundColor: palette.overlay }]}
                    onPress={dismissTray}
                    accessibilityLabel="close clip tray"
                    accessibilityRole="button"
                />
                <KeyboardAvoidingView
                    style={styles.keyboardLayer}
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    pointerEvents="box-none"
                >
                    <View
                        style={styles.keyboardLayer}
                        pointerEvents="box-none"
                        onLayout={(event) => setTrayHeight(event.nativeEvent.layout.height)}
                    >
                    {visible && trayHeight > 0 ? <SnapSheet
                        H={trayHeight}
                        sheetRef={sheetRef}
                        initialSnap={HALF}
                        metrics={trayMetrics}
                        backgroundColor={palette.background}
                        handleColor={palette.ruleWarmNib}
                        onSettle={(snap) => { if (snap === PEEK) dismissTray(); }}
                        onPanStart={Keyboard.dismiss}
                        renderHeader={() => (
                            <View style={styles.trayHeader}>
                                <Text style={[Type.sectionTitle, { color: palette.text }]}>Clip tray</Text>
                                <Pressable onPress={dismissTray} style={styles.headerAction}
                                    accessibilityRole="button" accessibilityLabel="done with clip tray">
                                    <Text style={[Type.metadata, { color: palette.textMuted }]}>done</Text>
                                </Pressable>
                            </View>
                        )}
                        renderContent={({ scrollEnabled, onScroll }) => (
                        <Animated.ScrollView
                            showsVerticalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                            keyboardDismissMode="on-drag"
                            scrollEnabled={scrollEnabled}
                            onScroll={onScroll}
                            scrollEventThrottle={16}
                            contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, Spacing.lg) }]}
                        >
                            <StartBand
                                palette={palette}
                                inputValue={inputValue}
                                inputOk={inputOk}
                                onChangeText={setInputValue}
                                onFocus={() => sheetRef.current?.snapTo(FULL)}
                                onOpenLink={openLink}
                                onOpenVideo={VIDEO_IMPORT_AVAILABLE
                                    ? () => openImport('video')
                                    : undefined}
                                onOpenScreenshot={() => openImport('screenshot')}
                            />
                            <LedgerBand
                                palette={palette}
                                rows={rows}
                                hasOlder={hasOlder}
                                isEmpty={isEmpty}
                                onOpenRoute={openRoute}
                            />
                        </Animated.ScrollView>
                        )}
                    /> : null}
                    </View>
                </KeyboardAvoidingView>

                <ImportLinkSheet
                    visible={importOpen}
                    onDismiss={() => setImportOpen(false)}
                    initialUrl={pendingUrl}
                    initialText={pendingText}
                    openTo={pendingOpenTo}
                    onVideoQueued={() => {
                        queuedVideoRef.current = true;
                        onDismiss();
                    }}
                />
            </GestureHandlerRootView>
        </Modal>
    );
}

function StartBand({
    palette,
    inputValue,
    inputOk,
    onChangeText,
    onFocus,
    onOpenLink,
    onOpenVideo,
    onOpenScreenshot,
}: {
    palette: Palette;
    inputValue: string;
    inputOk: boolean;
    onChangeText: (value: string) => void;
    onFocus: () => void;
    onOpenLink: () => void;
    onOpenVideo?: () => void;
    onOpenScreenshot: () => void;
}) {
    return (
        <View>
            <Text style={[Type.labelSmall, styles.kicker, { color: palette.textMuted }]}>
                clip a place
            </Text>
            <View style={[styles.linkCard, { backgroundColor: palette.surfaceNote }, Shadow.clip]}>
                <Ionicons
                    name="clipboard-outline"
                    size={22}
                    color={palette.primary}
                    style={styles.linkIcon}
                />
                <TextInput
                    value={inputValue}
                    onChangeText={onChangeText}
                    onFocus={onFocus}
                    placeholder="paste a link or a list"
                    placeholderTextColor={palette.textFaint}
                    style={[
                        Type.body,
                        styles.linkInput,
                        { color: palette.text, borderBottomColor: palette.ruleInkSoft },
                    ]}
                    autoCapitalize="none"
                    autoCorrect={false}
                    multiline
                    scrollEnabled
                    accessibilityLabel="place link or list"
                />
                {inputValue.length === 0 ? (
                    <PasteButton palette={palette} onPaste={onChangeText} />
                ) : (
                    <View style={styles.inputActions}>
                        <Pressable
                            onPress={() => onChangeText('')}
                            hitSlop={8}
                            style={styles.clearButton}
                            accessibilityRole="button"
                            accessibilityLabel="clear"
                        >
                            <Ionicons name="close-outline" size={20} color={palette.textFaint} />
                        </Pressable>
                        <Pressable
                            onPress={onOpenLink}
                            disabled={!inputOk}
                            style={({ pressed }) => [
                                styles.goButton,
                                {
                                    backgroundColor: inputOk
                                        ? palette.primary
                                        : palette.surfaceContainerHigh,
                                    opacity: pressed ? 0.8 : 1,
                                },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="find places"
                            accessibilityState={{ disabled: !inputOk }}
                        >
                            <Ionicons
                                name="arrow-forward-outline"
                                size={20}
                                color={inputOk ? palette.textInverse : palette.textFaint}
                            />
                        </Pressable>
                    </View>
                )}
            </View>
            <View style={styles.startActions}>
                {onOpenVideo ? (
                    <StartAction
                        icon="film-outline"
                        label="from a video"
                        palette={palette}
                        onPress={onOpenVideo}
                    />
                ) : null}
                <StartAction
                    icon="image-outline"
                    label="from a screenshot"
                    palette={palette}
                    onPress={onOpenScreenshot}
                />
            </View>
        </View>
    );
}

/**
 * One tap from "copied in WhatsApp" to a filled field. iOS's own paste control
 * reads the clipboard without the "Allow Paste" prompt; elsewhere a plain
 * button reads it (Android never prompts).
 */
function PasteButton({ palette, onPaste }: { palette: Palette; onPaste: (text: string) => void }) {
    if (Clipboard.isPasteButtonAvailable) {
        return (
            <Clipboard.ClipboardPasteButton
                // url too: a lone copied link must enable the control.
                acceptedContentTypes={['plain-text', 'url']}
                onPress={(data) => {
                    if (data.type === 'text' && data.text) onPaste(data.text);
                }}
                // Icon only: the system "Paste" label grows with language and
                // text size, and a clipped UIPasteControl silently ignores taps.
                displayMode="iconOnly"
                cornerStyle="capsule"
                backgroundColor={palette.primary}
                foregroundColor={palette.textInverse}
                style={styles.pasteButton}
                accessibilityLabel="paste"
            />
        );
    }
    return (
        <Pressable
            onPress={async () => {
                try {
                    const text = await Clipboard.getStringAsync();
                    if (text) onPaste(text);
                } catch {
                    // Paste declined; leave the field empty.
                }
            }}
            style={({ pressed }) => [
                styles.pasteButton,
                styles.pasteFallback,
                { backgroundColor: palette.primary, opacity: pressed ? 0.8 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel="paste"
        >
            <Ionicons name="clipboard-outline" size={20} color={palette.textInverse} />
        </Pressable>
    );
}

function StartAction({
    icon,
    label,
    palette,
    onPress,
}: {
    icon: React.ComponentProps<typeof Ionicons>['name'];
    label: string;
    palette: Palette;
    onPress: () => void;
}) {
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                styles.startAction,
                { backgroundColor: palette.surfaceNote, opacity: pressed ? 0.8 : 1 },
                Shadow.clip,
            ]}
            accessibilityRole="button"
            accessibilityLabel={label}
        >
            <Ionicons name={icon} size={24} color={palette.primary} />
            <Text style={[Type.body, styles.startActionLabel, { color: palette.text }]}>
                {label}
            </Text>
        </Pressable>
    );
}

function LedgerBand({
    palette,
    rows,
    hasOlder,
    isEmpty,
    onOpenRoute,
}: {
    palette: Palette;
    rows: ClipLedgerRow[];
    hasOlder: boolean;
    isEmpty: boolean;
    onOpenRoute: (route: string | null) => void;
}) {
    return (
        <View style={styles.ledgerBand}>
            <Text style={[Type.labelSmall, styles.kicker, { color: palette.textMuted }]}>
                landed
            </Text>
            {isEmpty ? <EmptyBand palette={palette} /> : (
                <View style={styles.ledgerRows}>
                    {rows.map((row) => (
                        <LedgerRow
                            key={row.key}
                            row={row}
                            palette={palette}
                            onPress={() => onOpenRoute(row.route)}
                        />
                    ))}
                    {hasOlder ? (
                        <Pressable
                            onPress={() => onOpenRoute('/import-progress')}
                            style={({ pressed }) => [
                                styles.olderRow,
                                { opacity: pressed ? 0.6 : 1 },
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel="older imports"
                        >
                            <Text style={[Type.metadata, { color: palette.textFaint }]}>older ·</Text>
                        </Pressable>
                    ) : null}
                </View>
            )}
        </View>
    );
}

function LedgerRow({
    row,
    palette,
    onPress,
}: {
    row: ClipLedgerRow;
    palette: Palette;
    onPress: () => void;
}) {
    const statusColor = row.dot === 'terracotta'
        ? palette.primary
        : row.dot === 'amber'
          ? palette.amberBright
          : palette.outlineVariant;
    const isActivelyClipping = row.dot === 'terracotta';
    const progressWidth: DimensionValue = row.progress && row.progress.total > 0
        ? `${Math.min(100, Math.max(0, (row.progress.cursor / row.progress.total) * 100))}%`
        : '34%';

    return (
        <Pressable
            onPress={onPress}
            disabled={!row.route}
            style={({ pressed }) => [
                styles.ledgerRow,
                { backgroundColor: palette.surfaceNote, opacity: pressed ? 0.8 : 1 },
                Shadow.clip,
            ]}
            accessibilityRole={row.route ? 'button' : undefined}
            accessibilityLabel={row.route ? `open ${row.title}` : undefined}
        >
            <View style={styles.rowTopLine}>
                <View
                    style={[
                        styles.statusDot,
                        { backgroundColor: statusColor, opacity: row.dot === 'ghost' ? 0.45 : 1 },
                    ]}
                />
                <View style={styles.rowCopy}>
                    <Text style={[styles.rowTitle, { color: palette.text }]} numberOfLines={2}>
                        {row.title}
                    </Text>
                    <Text style={[Type.metadata, { color: palette.textMuted }]} numberOfLines={1}>
                        {row.meta}
                    </Text>
                </View>
                {row.needsLook > 0 ? (
                    <View style={[styles.needsChip, { backgroundColor: palette.tertiaryFixed }]}>
                        <Text style={[Type.labelSmall, styles.needsChipLabel, { color: palette.amberInk }]}>
                            {`${row.needsLook} to check`}
                        </Text>
                    </View>
                ) : row.route ? (
                    <Ionicons name="chevron-forward-outline" size={18} color={palette.textFaint} />
                ) : null}
            </View>
            {isActivelyClipping ? (
                <View style={styles.clippingDetails}>
                    <View style={[styles.progressTrack, { backgroundColor: palette.primaryMuted }]}>
                        <View
                            style={[
                                styles.progressFill,
                                { backgroundColor: palette.primary, width: progressWidth },
                            ]}
                        />
                    </View>
                    <Text style={[Type.metadata, styles.clippingNote, { color: palette.textFaint }]}>
                        you can keep browsing — it lands on its own.
                    </Text>
                </View>
            ) : null}
        </Pressable>
    );
}

function EmptyBand({ palette }: { palette: Palette }) {
    return (
        <View style={styles.emptyBand}>
            <Ionicons name="download-outline" size={28} color={palette.textFaint} />
            <Text style={[Type.quote, { color: palette.textMuted }]}>what you clip lands here.</Text>
        </View>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    keyboardLayer: {
        flex: 1,
    },
    trayHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: Spacing.lg,
    },
    headerAction: {
        minHeight: 44,
        minWidth: 44,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.xs,
    },
    content: {
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.md,
    },
    kicker: {
        marginBottom: Spacing.sm,
    },
    linkCard: {
        borderRadius: Radius.lg,
        paddingHorizontal: Spacing.md,
        paddingVertical: 12,
        flexDirection: 'row',
        // Grows with the paste; the actions sit at the bottom where the text ends.
        alignItems: 'flex-end',
        gap: Spacing.sm,
    },
    linkIcon: {
        // Level with the first line, however far the paste grows.
        alignSelf: 'flex-start',
        marginTop: 11,
    },
    linkInput: {
        flex: 1,
        minHeight: 44,
        // About five lines, then it scrolls inside.
        maxHeight: 132,
        paddingVertical: Spacing.sm,
        borderBottomWidth: StyleSheet.hairlineWidth,
    },
    inputActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
    },
    clearButton: {
        width: 32,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    goButton: {
        width: 44,
        height: 44,
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    pasteButton: {
        width: 44,
        height: 44,
        alignSelf: 'center',
    },
    pasteFallback: {
        borderRadius: Radius.full,
        alignItems: 'center',
        justifyContent: 'center',
    },
    startActions: {
        flexDirection: 'row',
        gap: Spacing.sm,
        marginTop: Spacing.sm,
    },
    startAction: {
        flex: 1,
        minHeight: 72,
        borderRadius: Radius.lg,
        paddingHorizontal: Spacing.md,
        paddingVertical: Spacing.sm,
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    startActionLabel: {
        flex: 1,
    },
    ledgerBand: {
        marginTop: Spacing.lg,
    },
    ledgerRows: {
        gap: Spacing.sm,
    },
    ledgerRow: {
        borderRadius: Radius.lg,
        padding: Spacing.md,
    },
    rowTopLine: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.sm,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: Radius.full,
    },
    rowCopy: {
        flex: 1,
        minWidth: 0,
    },
    rowTitle: {
        ...Type.editorialBody,
        fontSize: 17,
    },
    needsChip: {
        minHeight: 28,
        borderRadius: Radius.full,
        paddingHorizontal: Spacing.sm,
        justifyContent: 'center',
    },
    needsChipLabel: {
        fontVariant: ['tabular-nums'],
        textTransform: 'none',
        letterSpacing: 0,
    },
    clippingDetails: {
        marginLeft: Spacing.md,
        marginTop: Spacing.sm,
        gap: Spacing.xs,
    },
    progressTrack: {
        height: 3,
        borderRadius: Radius.full,
        overflow: 'hidden',
    },
    progressFill: {
        height: 3,
        borderRadius: Radius.full,
    },
    clippingNote: {
        opacity: 0.82,
    },
    olderRow: {
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
    },
    emptyBand: {
        minHeight: 116,
        alignItems: 'center',
        justifyContent: 'center',
        gap: Spacing.sm,
    },
});
