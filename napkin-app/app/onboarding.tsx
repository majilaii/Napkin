import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Button, SafeAreaView, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import ValueProfile from '@/components/ValueProfile';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export default function OnboardingScreen() {
    const router = useRouter();
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];
    const [loading, setLoading] = useState(false);
    const [values, setValues] = useState({
        flavor: 0,
        ambience: 0,
        value: 0,
        service: 0,
    });

    const handleSave = async () => {
        const total = Object.values(values).reduce((a, b) => a + b, 0);
        if (total !== 40) {
            Alert.alert('Budget Error', `You must use exactly 40 points. You have used ${total}.`);
            return;
        }

        setLoading(true);
        try {
            const { error } = await supabase.functions.invoke('user-profile', {
                method: 'PUT',
                body: values,
            });

            if (error) throw error;

            // Navigate to main app
            router.replace('/(tabs)/explore');
        } catch (error) {
            console.error('Error saving profile:', error);
            Alert.alert('Error', 'Failed to save profile. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <SafeAreaView style={[styles.container, { backgroundColor: theme.background }]}>
            <View style={styles.content}>
                <Text style={[styles.title, { color: theme.text }]}>Welcome to Napkin</Text>
                <Text style={[styles.subtitle, { color: theme.text }]}>
                    Define your dining DNA. Allocate 40 points across these categories to help us understand what matters to you.
                </Text>

                <ValueProfile values={values} setValues={setValues} />

                <View style={styles.buttonContainer}>
                    <Button
                        title={loading ? "Saving..." : "Start Exploring"}
                        onPress={handleSave}
                        disabled={loading}
                        color={theme.tint}
                    />
                </View>
            </View>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    content: {
        flex: 1,
        padding: 20,
        alignItems: 'center',
    },
    title: {
        fontSize: 28,
        fontWeight: 'bold',
        marginBottom: 10,
        marginTop: 20,
    },
    subtitle: {
        fontSize: 16,
        textAlign: 'center',
        marginBottom: 30,
        opacity: 0.8,
    },
    buttonContainer: {
        marginTop: 30,
        width: '100%',
    },
});
