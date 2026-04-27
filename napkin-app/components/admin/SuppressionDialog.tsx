/**
 * SuppressionDialog — modal sheet for entering a suppression reason.
 * TICKET-033
 *
 * Opens when an operator taps "Suppress" on a CriticAdminRow.
 * Free-text reason (≤200 chars, required for suppression).
 * Confirm calls useSetSuppressed.mutate(...).
 */

import React, { useState } from 'react';
import {
    Modal,
    View,
    Text,
    TextInput,
    Pressable,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { Colors } from '@/constants/theme';
import { useSetSuppressed } from '@/hooks/admin/useSetSuppressed';
import type { CriticAdminRow } from '@/types/admin';

interface Props {
    row: CriticAdminRow;
    visible: boolean;
    onClose: () => void;
}

export function SuppressionDialog({ row, visible, onClose }: Props) {
    const [reason, setReason] = useState('');
    const { mutate, isPending } = useSetSuppressed();
    const c = Colors.light;

    function handleConfirm() {
        if (!reason.trim()) return;
        mutate(
            { review_id: row.id, suppressed: true, reason: reason.trim() },
            { onSettled: () => { setReason(''); onClose(); } },
        );
    }

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <KeyboardAvoidingView
                style={styles.overlay}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <View style={[styles.sheet, { backgroundColor: c.card }]}>
                    <Text style={[styles.title, { color: c.text }]}>
                        Suppress review
                    </Text>
                    <Text style={[styles.meta, { color: c.textMuted }]}>
                        {row.restaurant.name} · {row.publication}
                    </Text>

                    <TextInput
                        style={[styles.input, { color: c.text, borderColor: c.terracottaBorder }]}
                        placeholder="Reason for suppression…"
                        placeholderTextColor={c.textMuted}
                        value={reason}
                        onChangeText={setReason}
                        maxLength={200}
                        multiline
                        autoFocus
                    />
                    <Text style={[styles.charCount, { color: c.textMuted }]}>
                        {reason.length}/200
                    </Text>

                    <View style={styles.actions}>
                        <Pressable
                            style={[styles.btn, { backgroundColor: c.surfaceContainerLow }]}
                            onPress={() => { setReason(''); onClose(); }}
                        >
                            <Text style={[styles.btnText, { color: c.textSecondary }]}>Cancel</Text>
                        </Pressable>

                        <Pressable
                            style={[
                                styles.btn,
                                styles.btnPrimary,
                                { backgroundColor: c.primary, opacity: reason.trim().length === 0 || isPending ? 0.5 : 1 },
                            ]}
                            onPress={handleConfirm}
                            disabled={reason.trim().length === 0 || isPending}
                        >
                            <Text style={[styles.btnText, { color: c.textInverse }]}>
                                {isPending ? 'Suppressing…' : 'Suppress'}
                            </Text>
                        </Pressable>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(28,28,25,0.4)',
        justifyContent: 'flex-end',
    },
    sheet: {
        borderTopLeftRadius: 16,
        borderTopRightRadius: 16,
        padding: 24,
        paddingBottom: 40,
        gap: 12,
    },
    title: {
        fontSize: 17,
        fontWeight: '600',
    },
    meta: {
        fontSize: 13,
    },
    input: {
        borderWidth: 1,
        borderRadius: 8,
        padding: 12,
        fontSize: 15,
        minHeight: 80,
        textAlignVertical: 'top',
    },
    charCount: {
        fontSize: 12,
        textAlign: 'right',
    },
    actions: {
        flexDirection: 'row',
        gap: 12,
        marginTop: 4,
    },
    btn: {
        flex: 1,
        paddingVertical: 12,
        borderRadius: 8,
        alignItems: 'center',
    },
    btnPrimary: {},
    btnText: {
        fontSize: 15,
        fontWeight: '500',
    },
});
