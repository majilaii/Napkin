/**
 * /settings/bio — edit bio (≤160 chars).
 *
 * One multiline note-card, quiet count beneath. Save commits { bio } via
 * useUpdateProfile (empty → null) and pops back; armed only when changed.
 */
import React, { useState } from 'react';
import { Text, TextInput, View, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useAuth } from '@/providers/AuthProvider';
import { useUserProfile, useUpdateProfile } from '@/hooks/users';
import { EditorScreen, editorStyles, useFocusAfterTransition } from '@/components/settings';

export default function EditBioScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();

    const { data: result } = useUserProfile(user?.id);
    const profile = result?.data?.profile;
    const update = useUpdateProfile(user?.id);

    const [value, setValue] = useState('');
    // Keyboard rises only after the push settles (see useFocusAfterTransition).
    const inputRef = React.useRef<TextInput>(null);
    useFocusAfterTransition(inputRef);

    // Seed once; the touched guard stops a late profile fetch from clobbering
    // keystrokes typed into the focused field on a cold cache.
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
            title="bio"
            onSave={save}
            saveEnabled={dirty}
            saving={update.isPending}
        >
            <View style={[editorStyles.fieldCard, { backgroundColor: palette.card }]}>
                <TextInput
                    ref={inputRef}
                    value={value}
                    onChangeText={(t) => {
                        touched.current = true;
                        setValue(t.slice(0, 160));
                    }}
                    style={[editorStyles.fieldText, styles.bioInput, { color: palette.text }]}
                    multiline
                    maxLength={160}
                    returnKeyType="default"
                    placeholder="a line about how you eat"
                    placeholderTextColor={palette.textMuted}
                />
            </View>
            <Text style={[editorStyles.helper, styles.count, { color: palette.textMuted }]}>
                {value.length}/160
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
    bioInput: {
        minHeight: 96,
        textAlignVertical: 'top',
    },
    count: {
        textAlign: 'right',
    },
});
