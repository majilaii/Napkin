/**
 * /settings/username — claim or change the @handle.
 *
 * Live availability check (useCheckUsername, self-excluded on the server), then
 * a standalone write via useUpdateUsername. This is the sole handle editor for
 * an already-onboarded account; the atomic private→public first flip still
 * writes username through make-public.
 */
import React, { useState } from 'react';
import { View, Text, TextInput, StyleSheet, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserProfile, useCheckUsername, useUpdateUsername } from '@/hooks/users';
import { EditorScreen } from '@/components/settings';

type UsernameState = 'idle' | 'checking' | 'available' | 'taken' | 'invalid';

const USERNAME_FORMAT = /^[a-z][a-z0-9_]{2,23}$/;

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

    // Seed once from the loaded profile; the touched guard prevents a late
    // profile fetch from clobbering keystrokes typed into the autoFocused field.
    const touched = React.useRef(false);
    // Monotonic id for the in-flight availability check — a keystroke bumps it so
    // a stale resolution can't stamp 'available' onto a newer, unchecked value.
    const checkSeq = React.useRef(0);

    React.useEffect(() => {
        if (current && !touched.current) setValue(current);
    }, [profile?.user_id]);

    const handleChange = (text: string) => {
        touched.current = true;
        checkSeq.current += 1;
        setValue(text.toLowerCase().replace(/[^a-z0-9_]/g, ''));
        setState('idle');
    };

    const isSameAsCurrent = !!current && value === current;

    const handleBlur = async () => {
        if (!value || isSameAsCurrent) {
            setState('idle');
            return;
        }
        if (!USERNAME_FORMAT.test(value)) {
            setState('invalid');
            return;
        }
        const seq = ++checkSeq.current;
        setState('checking');
        try {
            const res = await checkUsername.mutateAsync(value);
            if (seq !== checkSeq.current) return; // superseded by a newer keystroke/check
            setState(res.available ? 'available' : 'taken');
        } catch {
            if (seq !== checkSeq.current) return;
            setState('idle');
        }
    };

    const canSave = state === 'available' && value.length >= 3 && !isSameAsCurrent && !update.isPending;

    const save = () => {
        if (!canSave) return;
        update.mutate(value, { onSuccess: () => router.back() });
    };

    const hint = () => {
        switch (state) {
            case 'checking': return 'Checking…';
            case 'available': return 'Username available';
            case 'taken': return 'Already taken';
            case 'invalid': return 'Must be 3–24 chars, start with a letter, lowercase letters / numbers / underscores only';
            default: return '';
        }
    };
    const hintColor = () => {
        switch (state) {
            case 'available': return palette.success;
            case 'taken':
            case 'invalid': return palette.error;
            default: return palette.textMuted;
        }
    };

    return (
        <EditorScreen
            title="Username"
            onSave={save}
            saveEnabled={canSave}
            saving={update.isPending}
        >
            <Text style={[Type.caption, { color: palette.textMuted, marginTop: Spacing.lg, marginBottom: Spacing.sm }]}>
                napkin.app/u/{value || 'username'}
            </Text>
            <View style={[styles.inputRow, { borderColor: palette.outlineVariant }]}>
                <Text style={[Type.body, { color: palette.textMuted }]}>@</Text>
                <TextInput
                    value={value}
                    onChangeText={handleChange}
                    onBlur={handleBlur}
                    style={[styles.input, { color: palette.text }]}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus
                    placeholder="yourname"
                    placeholderTextColor={palette.textMuted}
                    returnKeyType="done"
                    onSubmitEditing={handleBlur}
                />
                {state === 'checking' ? (
                    <ActivityIndicator size="small" color={palette.textMuted} />
                ) : null}
            </View>
            {hint() ? (
                <Text style={[Type.caption, { color: hintColor(), marginTop: Spacing.xs }]}>
                    {hint()}
                </Text>
            ) : null}
            {update.error ? (
                <Text style={[Type.caption, { color: palette.error, marginTop: Spacing.sm }]}>
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
        borderWidth: 1,
        borderRadius: Radius.sm,
        paddingHorizontal: Spacing.sm,
        paddingVertical: Spacing.sm,
        gap: Spacing.xs,
    },
    input: {
        flex: 1,
        fontSize: 15,
    },
});
