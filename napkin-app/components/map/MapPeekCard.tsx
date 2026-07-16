import React from 'react';
import {
    ActivityIndicator,
    Pressable,
    StyleSheet,
    Text,
    View,
    type StyleProp,
    type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';

import {
    Colors,
    IconSize,
    Radius,
    Shadow,
    Type,
} from '@/constants/theme';
import { PlacesCredit, type PlacesPhotoCredit } from '@/components/ui/PlacesCredit';
import {
    PEEK_MAX_FONT_SCALE,
    peekCardHeight,
    peekEffectiveFontScale,
    peekPlacesCreditHeight,
} from '@/components/wishlist/peekLayout';
import type { MapPeekThumbnail } from './mapPeekPresentation';

interface MapPeekCardProps {
    name: string;
    meta: string;
    hoursLine: string | null;
    contextLine: string | null;
    contextActionLabel?: string;
    onContextPress?: () => void;
    contextTailLine?: string;
    contextTailActionLabel?: string;
    onContextTailPress?: () => void;
    thumbnail: MapPeekThumbnail | null;
    placesCredit: PlacesPhotoCredit | null;
    fontScale: number;
    palette: typeof Colors.light;
    style?: StyleProp<ViewStyle>;
    onThumbnailError: () => void;
    onOpen: () => void;
    openAccessibilityLabel: string;
    saved: boolean | undefined;
    wishlistPending: boolean;
    wishlistDisabled: boolean;
    onWishlistPress: () => void;
    onWishlistPressIn: () => void;
    onWishlistLongPress?: () => void;
    onLogVisit: () => void;
    onDirections: () => void;
}

/** The founder-approved 334×136 floating map caption (width is rail-owned). */
export function MapPeekCard({
    name,
    meta,
    hoursLine,
    contextLine,
    contextActionLabel,
    onContextPress,
    contextTailLine,
    contextTailActionLabel,
    onContextTailPress,
    thumbnail,
    placesCredit,
    fontScale,
    palette,
    style,
    onThumbnailError,
    onOpen,
    openAccessibilityLabel,
    saved,
    wishlistPending,
    wishlistDisabled,
    onWishlistPress,
    onWishlistPressIn,
    onWishlistLongPress,
    onLogVisit,
    onDirections,
}: MapPeekCardProps) {
    const effectiveScale = peekEffectiveFontScale(fontScale);
    const nameLineHeight = Math.round(24 * effectiveScale);
    const copyLineHeight = Math.round(18 * effectiveScale);
    const actionLineHeight = Math.round(18 * effectiveScale);
    const summaryHeight = Math.round(60 * effectiveScale);
    const actionHeight = Math.round(44 + (effectiveScale - 1) * 14);
    const hasPlacesCredit = thumbnail?.isPlaces === true && placesCredit != null;
    const height = peekCardHeight(fontScale, hasPlacesCredit);
    const creditHeight = peekPlacesCreditHeight(fontScale);
    const heartBusy = wishlistPending || saved === undefined;
    const hoursAreLiveOpen = /\bopen(?:\s+until)?\b/i.test(hoursLine ?? '');

    return (
        <View
            testID="map-peek-card"
            style={[
                styles.card,
                Shadow.ambient,
                { backgroundColor: palette.card, height },
                style,
            ]}
        >
            <View
                testID="map-peek-summary"
                style={[styles.summary, { height: summaryHeight }]}
            >
                <Pressable
                    testID="map-peek-open-action"
                    style={StyleSheet.absoluteFill}
                    accessibilityRole="button"
                    accessibilityLabel={openAccessibilityLabel}
                    onPress={onOpen}
                />

                {thumbnail ? (
                    <View
                        testID="map-peek-thumbnail"
                        accessible={false}
                        pointerEvents="none"
                        style={[
                            styles.thumbnail,
                            {
                                borderColor: palette.imageOutline,
                                backgroundColor: palette.surfaceContainerLow,
                            },
                        ]}
                    >
                        <ExpoImage
                            source={{ uri: thumbnail.url }}
                            recyclingKey={thumbnail.url}
                            contentFit="cover"
                            transition={120}
                            style={StyleSheet.absoluteFill}
                            onError={onThumbnailError}
                        />
                        {thumbnail.isPlaces ? (
                            <View
                                pointerEvents="none"
                                style={[
                                    StyleSheet.absoluteFill,
                                    {
                                        backgroundColor: palette.placesOverlayTint,
                                        opacity: palette.placesOverlayOpacity,
                                    },
                                ]}
                            />
                        ) : null}
                    </View>
                ) : null}

                <View
                    testID="map-peek-copy"
                    pointerEvents="box-none"
                    style={[styles.copy, { height: summaryHeight }]}
                >
                    <Text
                        pointerEvents="none"
                        maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                        numberOfLines={1}
                        style={[
                            Type.mapPeekName,
                            { color: palette.text, lineHeight: nameLineHeight },
                        ]}
                    >
                        {name}
                    </Text>
                    <View pointerEvents="none" style={[styles.copyLine, { height: copyLineHeight }]}>
                        {meta ? (
                            <Text
                                maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                numberOfLines={1}
                                style={[
                                    Type.mapPeekMeta,
                                    { color: palette.textMuted, lineHeight: copyLineHeight },
                                ]}
                            >
                                {meta}
                            </Text>
                        ) : null}
                    </View>
                    <View pointerEvents="box-none" style={[styles.detailRow, { height: copyLineHeight }]}>
                        {hoursLine ? (
                            <Text
                                pointerEvents="none"
                                maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                numberOfLines={1}
                                style={[
                                    styles.hoursText,
                                    hoursAreLiveOpen ? Type.mapPeekDetailStrong : Type.mapPeekMeta,
                                    { color: palette.textSecondary, lineHeight: copyLineHeight },
                                ]}
                            >
                                {hoursLine}
                            </Text>
                        ) : null}
                        {hoursLine && contextLine ? (
                            <Text
                                pointerEvents="none"
                                maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                style={[
                                    Type.mapPeekMeta,
                                    { color: palette.textSecondary, lineHeight: copyLineHeight },
                                ]}
                            >
                                {' · '}
                            </Text>
                        ) : null}
                        {contextLine ? (
                            <Text
                                pointerEvents="none"
                                maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                numberOfLines={1}
                                style={[
                                    styles.contextText,
                                    Type.mapPeekMeta,
                                    { color: palette.textSecondary, lineHeight: copyLineHeight },
                                ]}
                            >
                                {contextLine}
                            </Text>
                        ) : null}
                        {contextLine && contextTailLine ? (
                            <Text
                                pointerEvents="none"
                                maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                style={[
                                    Type.mapPeekMeta,
                                    { color: palette.textSecondary, lineHeight: copyLineHeight },
                                ]}
                            >
                                {' · '}
                            </Text>
                        ) : null}
                        {contextTailLine ? (
                            <Text
                                pointerEvents="none"
                                maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                numberOfLines={1}
                                style={[
                                    Type.mapPeekMeta,
                                    { color: palette.textSecondary, lineHeight: copyLineHeight },
                                ]}
                            >
                                {contextTailLine}
                            </Text>
                        ) : null}
                    </View>

                    {onContextPress || onContextTailPress ? (
                        <View
                            testID="map-peek-context-actions-overlay"
                            pointerEvents="box-none"
                            style={styles.contextActionsOverlay}
                        >
                            {hoursLine ? (
                                <Text
                                    accessible={false}
                                    pointerEvents="none"
                                    maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                    numberOfLines={1}
                                    style={[
                                        styles.hoursText,
                                        styles.invisibleMeasure,
                                        hoursAreLiveOpen ? Type.mapPeekDetailStrong : Type.mapPeekMeta,
                                        { lineHeight: copyLineHeight },
                                    ]}
                                >
                                    {hoursLine}
                                </Text>
                            ) : null}
                            {hoursLine && contextLine ? (
                                <Text
                                    accessible={false}
                                    pointerEvents="none"
                                    maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                    style={[
                                        styles.invisibleMeasure,
                                        Type.mapPeekMeta,
                                        { lineHeight: copyLineHeight },
                                    ]}
                                >
                                    {' · '}
                                </Text>
                            ) : null}
                            {contextLine ? (
                                onContextPress ? (
                                    <Pressable
                                        testID="map-peek-context-action"
                                        accessibilityRole="button"
                                        accessibilityLabel={contextActionLabel}
                                        onPress={onContextPress}
                                        style={({ pressed }) => [
                                            styles.contextAction,
                                            { opacity: pressed ? 0.65 : 1 },
                                        ]}
                                    >
                                        <Text
                                            accessible={false}
                                            maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                            numberOfLines={1}
                                            style={[
                                                styles.invisibleMeasure,
                                                Type.mapPeekMeta,
                                                { lineHeight: copyLineHeight },
                                            ]}
                                        >
                                            {contextLine}
                                        </Text>
                                    </Pressable>
                                ) : (
                                    <Text
                                        accessible={false}
                                        pointerEvents="none"
                                        maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                        numberOfLines={1}
                                        style={[
                                            styles.contextText,
                                            styles.invisibleMeasure,
                                            Type.mapPeekMeta,
                                            { lineHeight: copyLineHeight },
                                        ]}
                                    >
                                        {contextLine}
                                    </Text>
                                )
                            ) : null}
                            {contextLine && contextTailLine ? (
                                <Text
                                    accessible={false}
                                    pointerEvents="none"
                                    maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                    style={[
                                        styles.invisibleMeasure,
                                        Type.mapPeekMeta,
                                        { lineHeight: copyLineHeight },
                                    ]}
                                >
                                    {' · '}
                                </Text>
                            ) : null}
                            {contextTailLine && onContextTailPress ? (
                                <Pressable
                                    testID="map-peek-context-tail-action"
                                    accessibilityRole="button"
                                    accessibilityLabel={contextTailActionLabel}
                                    onPress={onContextTailPress}
                                    style={({ pressed }) => [
                                        styles.contextTailAction,
                                        { opacity: pressed ? 0.65 : 1 },
                                    ]}
                                >
                                    <Text
                                        accessible={false}
                                        maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                                        numberOfLines={1}
                                        style={[
                                            styles.invisibleMeasure,
                                            Type.mapPeekMeta,
                                            { lineHeight: copyLineHeight },
                                        ]}
                                    >
                                        {contextTailLine}
                                    </Text>
                                </Pressable>
                            ) : null}
                        </View>
                    ) : null}
                </View>
            </View>

            {hasPlacesCredit ? (
                <View style={[styles.creditSlot, { height: creditHeight }]}>
                    <PlacesCredit
                        credits={[placesCredit]}
                        photoCount={1}
                        testID="map-peek-places-credit"
                        interactive={false}
                        maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                    />
                </View>
            ) : null}

            <View style={[styles.actions, { height: actionHeight }]}>
                <Pressable
                    testID="map-peek-log-action"
                    accessibilityRole="button"
                    accessibilityLabel={`Log a visit to ${name}`}
                    onPress={onLogVisit}
                    style={({ pressed }) => [
                        styles.primaryAction,
                        {
                            height: actionHeight,
                            backgroundColor: palette.mapPeekPrimaryWash,
                            opacity: pressed ? 0.78 : 1,
                        },
                    ]}
                >
                    <Ionicons name="create-outline" size={IconSize.md} color={palette.terracottaDeep} />
                    <Text
                        maxFontSizeMultiplier={PEEK_MAX_FONT_SCALE}
                        numberOfLines={1}
                        style={[
                            Type.mapPeekAction,
                            { color: palette.terracottaDeep, lineHeight: actionLineHeight },
                        ]}
                    >
                        log a visit
                    </Text>
                </Pressable>

                <Pressable
                    testID="map-peek-heart-action"
                    accessibilityRole="button"
                    accessibilityLabel={
                        saved === undefined
                            ? 'Checking wishlist'
                            : saved
                              ? 'Remove from wishlist'
                              : 'Add to wishlist'
                    }
                    accessibilityState={{
                        disabled: wishlistDisabled,
                        busy: heartBusy,
                        selected: saved === true,
                    }}
                    disabled={wishlistDisabled}
                    delayLongPress={350}
                    onPress={onWishlistPress}
                    onPressIn={onWishlistPressIn}
                    onLongPress={onWishlistLongPress}
                    style={({ pressed }) => [
                        styles.iconAction,
                        {
                            height: actionHeight,
                            backgroundColor: saved ? palette.mapPeekSavedWash : undefined,
                            opacity: pressed ? 0.65 : wishlistDisabled && !heartBusy ? 0.72 : 1,
                        },
                    ]}
                >
                    {heartBusy ? (
                        <ActivityIndicator size="small" color={palette.textSecondary} />
                    ) : (
                        <Ionicons
                            name={saved ? 'heart' : 'heart-outline'}
                            size={IconSize.md}
                            color={saved ? palette.primary : palette.textSecondary}
                        />
                    )}
                </Pressable>

                <Pressable
                    testID="map-peek-directions-action"
                    accessibilityRole="button"
                    accessibilityLabel={`Directions to ${name}`}
                    onPress={onDirections}
                    style={({ pressed }) => [
                        styles.iconAction,
                        { height: actionHeight, opacity: pressed ? 0.65 : 1 },
                    ]}
                >
                    <Ionicons name="navigate-outline" size={IconSize.md} color={palette.textSecondary} />
                </Pressable>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    card: {
        borderRadius: Radius.lg,
        padding: 12,
    },
    summary: {
        flexDirection: 'row',
        gap: 10,
        minWidth: 0,
    },
    thumbnail: {
        width: 60,
        height: 60,
        alignSelf: 'center',
        borderRadius: Radius.md,
        borderWidth: 1,
        overflow: 'hidden',
    },
    copy: {
        flex: 1,
        minWidth: 0,
        justifyContent: 'center',
    },
    copyLine: {
        justifyContent: 'center',
        minWidth: 0,
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        minWidth: 0,
    },
    hoursText: {
        flexShrink: 1,
        minWidth: 0,
    },
    contextActionsOverlay: {
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: 44,
        flexDirection: 'row',
        alignItems: 'flex-end',
        zIndex: 2,
    },
    invisibleMeasure: {
        opacity: 0,
    },
    contextAction: {
        flex: 1,
        minWidth: 44,
        height: 44,
        justifyContent: 'flex-end',
    },
    contextText: {
        flex: 1,
        minWidth: 0,
    },
    contextTailAction: {
        height: 44,
        minWidth: 44,
        flexShrink: 0,
        justifyContent: 'flex-end',
    },
    creditSlot: {
        justifyContent: 'center',
        minWidth: 0,
    },
    actions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        marginTop: 8,
    },
    primaryAction: {
        flex: 1,
        minWidth: 0,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        gap: 7,
        borderRadius: Radius.md,
        paddingHorizontal: 14,
    },
    iconAction: {
        width: 44,
        minHeight: 44,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: Radius.md,
    },
});

export default MapPeekCard;
