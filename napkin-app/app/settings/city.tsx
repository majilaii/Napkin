/** /settings/city — edit the free-text home city. */
import React from 'react';
import { Text, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';

import { CitySuggestField } from '@/components/onboarding/CitySuggestField';
import { EditorScreen, editorStyles, useFocusAfterTransition } from '@/components/settings';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useUserProfile, useUpdateProfile } from '@/hooks/users';
import { useAuth } from '@/providers/AuthProvider';

export default function EditCityScreen() {
    const scheme = useColorScheme() ?? 'light';
    const palette = Colors[scheme];
    const router = useRouter();
    const { user } = useAuth();

    const { data: result } = useUserProfile(user?.id);
    const profile = result?.data?.profile;
    const homeCity = (profile as { home_city?: string | null } | undefined)?.home_city ?? null;
    const update = useUpdateProfile(user?.id);

    const [value, setValue] = React.useState('');
    const inputRef = React.useRef<TextInput>(null);
    useFocusAfterTransition(inputRef);

    const touched = React.useRef(false);
    React.useEffect(() => {
        if (profile && !touched.current) setValue(homeCity ?? '');
    }, [homeCity, profile?.user_id]);

    const next = value.trim() || null;
    const dirty = next !== homeCity;

    const save = () => {
        if (!dirty) return;
        update.mutate({ home_city: next }, { onSuccess: () => router.back() });
    };

    return (
        <EditorScreen
            title="home city"
            onSave={save}
            saveEnabled={dirty}
            saving={update.isPending}
        >
            <View style={[editorStyles.fieldCard, { backgroundColor: palette.card }]}>
                <CitySuggestField
                    ref={inputRef}
                    value={value}
                    onChangeText={(text) => {
                        touched.current = true;
                        setValue(text.slice(0, 120));
                    }}
                    style={[editorStyles.fieldText, { color: palette.text, fontSize: 16 }]}
                    maxLength={120}
                    placeholder="e.g. Hong Kong"
                    placeholderTextColor={palette.textMuted}
                    autoCapitalize="words"
                    autoCorrect={false}
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
