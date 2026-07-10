/**
 * /settings/name — edit display name.
 *
 * One field. Save commits { display_name } via useUpdateProfile and pops back.
 * Save disabled until the trimmed value is 1–80 chars and actually changed.
 */
import React, { useState } from 'react';
import { Text, TextInput, StyleSheet, InteractionManager } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserProfile, useUpdateProfile } from '@/hooks/users';
import { EditorScreen } from '@/components/settings';

export default function EditNameScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();

    const { data: result } = useUserProfile(user?.id);
    const profile = result?.data?.profile;
    const update = useUpdateProfile(user?.id);

    const [value, setValue] = useState('');
    // Focus after the push transition completes — raising the keyboard mid-push
    // reads as flicker.
    const inputRef = React.useRef<TextInput>(null);
    React.useEffect(() => {
        const task = InteractionManager.runAfterInteractions(() => inputRef.current?.focus());
        return () => task.cancel();
    }, []);
    // Seed once; the touched guard stops a late profile fetch from clobbering
    // keystrokes typed into the autoFocused field on a cold cache.
    const touched = React.useRef(false);
    React.useEffect(() => {
        if (profile && !touched.current) setValue(profile.display_name ?? '');
    }, [profile?.user_id]);

    const trimmed = value.trim();
    const dirty = trimmed !== (profile?.display_name ?? '');
    const valid = trimmed.length >= 1 && trimmed.length <= 80;

    const save = () => {
        if (!valid || !dirty) return;
        update.mutate(
            { display_name: trimmed },
            { onSuccess: () => router.back() },
        );
    };

    return (
        <EditorScreen
            title="Name"
            onSave={save}
            saveEnabled={valid && dirty}
            saving={update.isPending}
        >
            <Text style={[Type.caption, { color: palette.textMuted, marginTop: Spacing.lg }]}>
                Display name
            </Text>
            <TextInput
                ref={inputRef}
                value={value}
                onChangeText={(t) => {
                    touched.current = true;
                    setValue(t);
                }}
                style={[styles.input, { color: palette.text, borderColor: palette.outlineVariant }]}
                maxLength={80}
                returnKeyType="done"
                onSubmitEditing={save}
            />
            {update.error ? (
                <Text style={[Type.caption, { color: palette.error, marginTop: Spacing.sm }]}>
                    {update.error.message}
                </Text>
            ) : null}
        </EditorScreen>
    );
}

const styles = StyleSheet.create({
    input: {
        marginTop: Spacing.xs,
        borderWidth: 1,
        borderRadius: Radius.sm,
        paddingHorizontal: Spacing.sm,
        paddingVertical: Spacing.sm,
        fontSize: 15,
    },
});
