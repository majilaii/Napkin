/**
 * /settings/name — edit display name.
 *
 * One warm note-card field, nothing else. Save commits { display_name } via
 * useUpdateProfile and pops back; armed only when the trimmed value is
 * 1–80 chars and actually changed.
 */
import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserProfile, useUpdateProfile } from '@/hooks/users';
import { EditorScreen, editorStyles, useFocusAfterTransition } from '@/components/settings';

export default function EditNameScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();

    const { data: result } = useUserProfile(user?.id);
    const profile = result?.data?.profile;
    const update = useUpdateProfile(user?.id);

    const [value, setValue] = useState('');
    // Keyboard rises only after the push settles — raising it mid-transition
    // reads as flicker (New-Arch InteractionManager fires too early).
    const inputRef = React.useRef<TextInput>(null);
    useFocusAfterTransition(inputRef);

    // Seed once; the touched guard stops a late profile fetch from clobbering
    // keystrokes typed into the focused field on a cold cache.
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
            title="name"
            onSave={save}
            saveEnabled={valid && dirty}
            saving={update.isPending}
        >
            <View style={[editorStyles.fieldCard, { backgroundColor: palette.card }]}>
                <TextInput
                    ref={inputRef}
                    value={value}
                    onChangeText={(t) => {
                        touched.current = true;
                        setValue(t);
                    }}
                    style={[editorStyles.fieldText, { color: palette.text }]}
                    maxLength={80}
                    placeholder="your name"
                    placeholderTextColor={palette.textMuted}
                    returnKeyType="done"
                    onSubmitEditing={save}
                />
            </View>
            {update.error ? (
                <Text style={[editorStyles.helper, { color: palette.error }]}>
                    {update.error.message}
                </Text>
            ) : null}
        </EditorScreen>
    );
}
