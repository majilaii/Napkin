/**
 * /settings/bio — edit bio (≤160 chars).
 *
 * Save commits { bio } via useUpdateProfile (empty → null) and pops back.
 * Save disabled until the value actually changed.
 */
import React, { useState } from 'react';
import { Text, TextInput, StyleSheet, InteractionManager } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors, Radius, Spacing, Type } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserProfile, useUpdateProfile } from '@/hooks/users';
import { EditorScreen } from '@/components/settings';

export default function EditBioScreen() {
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
        if (profile && !touched.current) setValue(profile.bio ?? '');
    }, [profile?.user_id]);

    const next = value.trim() || null;
    const dirty = next !== (profile?.bio ?? null);

    const save = () => {
        if (!dirty) return;
        update.mutate({ bio: next }, { onSuccess: () => router.back() });
    };

    return (
        <EditorScreen
            title="Bio"
            onSave={save}
            saveEnabled={dirty}
            saving={update.isPending}
        >
            <Text style={[Type.caption, { color: palette.textMuted, marginTop: Spacing.lg }]}>
                Bio ({value.length}/160)
            </Text>
            <TextInput
                ref={inputRef}
                value={value}
                onChangeText={(t) => {
                    touched.current = true;
                    setValue(t.slice(0, 160));
                }}
                style={[styles.input, styles.bioInput, { color: palette.text, borderColor: palette.outlineVariant }]}
                multiline
                maxLength={160}
                returnKeyType="default"
                placeholder="A line about how you eat"
                placeholderTextColor={palette.textMuted}
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
    bioInput: {
        minHeight: 80,
        textAlignVertical: 'top',
    },
});
