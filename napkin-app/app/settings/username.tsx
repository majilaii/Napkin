/**
 * /settings/username — claim or change the @handle.
 *
 * Availability now checks LIVE while typing (debounced 450ms; the old
 * on-blur-only check read as "no check at all" — you typed and save stayed
 * dead until an accidental blur). Standalone write via useUpdateUsername;
 * the atomic private→public first flip still writes username through
 * make-public. No change-count limit for now — friends-test scale doesn't
 * warrant it (revisit if handle-squatting ever appears).
 */
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Colors, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserProfile, useCheckUsername, useUpdateUsername } from '@/hooks/users';
import { EditorScreen, editorStyles, useFocusAfterTransition } from '@/components/settings';

type UsernameState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

const USERNAME_FORMAT = /^[a-z][a-z0-9_]{2,23}$/;
const CHECK_DEBOUNCE_MS = 450;

export default function EditUsernameScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();

    const { data: result } = useUserProfile(user?.id);
    const profile = result?.data?.profile;
    const current = profile?.username ?? null;

    const checkUsername = useCheckUsername();
    const update = useUpdateUsername(user?.id);

    const [value, setValue] = useState('');
    const [state, setState] = useState<UsernameState>('idle');

    // Keyboard rises only after the push settles (see useFocusAfterTransition).
    const inputRef = React.useRef<TextInput>(null);
    useFocusAfterTransition(inputRef);

    // Seed once from the loaded profile; the touched guard prevents a late
    // profile fetch from clobbering keystrokes typed into the focused field.
    const touched = React.useRef(false);
    // Monotonic id for the in-flight availability check — a keystroke bumps it
    // so a stale resolution can't stamp 'available' onto a newer value.
    const checkSeq = React.useRef(0);
    const debounceTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => {
        if (current && !touched.current) setValue(current);
    }, [profile?.user_id]);

    React.useEffect(() => () => {
        if (debounceTimer.current) clearTimeout(debounceTimer.current);
    }, []);

    const runCheck = async (candidate: string) => {
        const seq = ++checkSeq.current;
        setState('checking');
        try {
            const res = await checkUsername.mutateAsync(candidate);
            if (seq !== checkSeq.current) return; // superseded by a newer keystroke
            setState(res.available ? 'available' : 'taken');
        } catch {
            if (seq !== checkSeq.current) return;
            setState('idle');
        }
    };

    // Live availability: debounce while typing; format problems surface
    // immediately once the value is plausibly complete (≥3 chars).
    const handleChange = (text: string) => {
        touched.current = true;
        checkSeq.current += 1;
        if (debounceTimer.current) clearTimeout(debounceTimer.current);

        const next = text.toLowerCase().replace(/[^a-z0-9_]/g, '');
        setValue(next);

        if (!next || (!!current && next === current)) {
            setState('idle');
            return;
        }
        if (!USERNAME_FORMAT.test(next)) {
            setState(next.length >= 3 ? 'invalid' : 'idle');
            return;
        }
        setState('checking');
        debounceTimer.current = setTimeout(() => runCheck(next), CHECK_DEBOUNCE_MS);
    };

    const isSameAsCurrent = !!current && value === current;
    const canSave = state === 'available' && !isSameAsCurrent && !update.isPending;

    const save = () => {
        if (!canSave) return;
        update.mutate(value, { onSuccess: () => router.back() });
    };

    const status = (): { text: string; color: string; icon?: 'checkmark' | 'close' } | null => {
        switch (state) {
            case 'checking':
                return { text: 'checking…', color: palette.textMuted };
            case 'available':
                return { text: 'available', color: palette.success, icon: 'checkmark' };
            case 'taken':
                return { text: 'already taken', color: palette.error, icon: 'close' };
            case 'invalid':
                return { text: '3–24 chars, starts with a letter — a–z, 0–9, _', color: palette.error };
            default:
                return null;
        }
    };
    const s = status();

    return (
        <EditorScreen
            title="username"
            onSave={save}
            saveEnabled={canSave}
            saving={update.isPending}
        >
            <View style={[editorStyles.fieldCard, styles.inputRow, { backgroundColor: palette.card }]}>
                <Text style={[editorStyles.fieldText, { color: palette.textMuted }]}>@</Text>
                <TextInput
                    ref={inputRef}
                    value={value}
                    onChangeText={handleChange}
                    style={[editorStyles.fieldText, styles.input, { color: palette.text }]}
                    autoCapitalize="none"
                    autoCorrect={false}
                    placeholder="yourname"
                    placeholderTextColor={palette.textMuted}
                    returnKeyType="done"
                    onSubmitEditing={save}
                />
                {state === 'checking' ? (
                    <ActivityIndicator size="small" color={palette.textMuted} />
                ) : null}
            </View>

            {s ? (
                <View style={styles.statusRow}>
                    {s.icon ? <Ionicons name={s.icon} size={12} color={s.color} /> : null}
                    <Text style={[editorStyles.helper, styles.statusText, { color: s.color }]}>
                        {s.text}
                    </Text>
                </View>
            ) : null}
            <Text style={[editorStyles.helper, { color: palette.textMuted }]} numberOfLines={1}>
                napkin.app/u/{value || 'yourname'}
            </Text>

            {update.error ? (
                <Text style={[editorStyles.helper, { color: palette.error }]}>
                    {update.error.message}
                </Text>
            ) : null}
        </EditorScreen>
    );
}

const styles = StyleSheet.create({
    inputRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: Spacing.xs,
    },
    input: {
        flex: 1,
    },
    statusRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        marginTop: Spacing.sm,
        paddingHorizontal: 4,
    },
    statusText: {
        flexShrink: 1,
        marginTop: 0,
        paddingHorizontal: 0,
    },
});
