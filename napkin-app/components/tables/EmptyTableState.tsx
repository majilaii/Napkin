/**
 * EmptyTableState - Shown when user has no tables
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface EmptyTableStateProps {
    onCreateTable: () => void;
    theme: {
        text: string;
        textSecondary: string;
        primary: string;
        card: string;
    };
}

export function EmptyTableState({ onCreateTable, theme }: EmptyTableStateProps) {
    return (
        <View style={styles.container}>
            <View style={[styles.iconContainer, { backgroundColor: theme.primary + '15' }]}>
                <Ionicons name="people" size={48} color={theme.primary} />
            </View>

            <Text style={[styles.title, { color: theme.text }]}>No Tables Yet</Text>

            <Text style={[styles.description, { color: theme.textSecondary }]}>
                Tables are private groups for sharing dining experiences with friends. Start a &quot;Table Night&quot; to rate restaurants together!
            </Text>

            <TouchableOpacity
                style={[styles.createButton, { backgroundColor: theme.primary }]}
                onPress={onCreateTable}
            >
                <Ionicons name="add" size={20} color="white" />
                <Text style={styles.createButtonText}>Create Your First Table</Text>
            </TouchableOpacity>

            <View style={styles.featuresContainer}>
                <View style={styles.featureRow}>
                    <Ionicons name="star" size={18} color={theme.primary} />
                    <Text style={[styles.featureText, { color: theme.textSecondary }]}>
                        Rate restaurants together
                    </Text>
                </View>
                <View style={styles.featureRow}>
                    <Ionicons name="eye" size={18} color={theme.primary} />
                    <Text style={[styles.featureText, { color: theme.textSecondary }]}>
                        Reveal scores simultaneously
                    </Text>
                </View>
                <View style={styles.featureRow}>
                    <Ionicons name="stats-chart" size={18} color={theme.primary} />
                    <Text style={[styles.featureText, { color: theme.textSecondary }]}>
                        Track your group&apos;s stats
                    </Text>
                </View>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 32,
        paddingBottom: 60,
    },
    iconContainer: {
        width: 100,
        height: 100,
        borderRadius: 50,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 24,
    },
    title: {
        fontSize: 24,
        fontWeight: '700',
        marginBottom: 12,
    },
    description: {
        fontSize: 15,
        textAlign: 'center',
        lineHeight: 22,
        marginBottom: 28,
    },
    createButton: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 24,
        paddingVertical: 14,
        borderRadius: 30,
        gap: 8,
        marginBottom: 32,
    },
    createButtonText: {
        color: 'white',
        fontSize: 16,
        fontWeight: '600',
    },
    featuresContainer: {
        alignSelf: 'stretch',
        gap: 12,
    },
    featureRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    featureText: {
        fontSize: 14,
    },
});
