import React from 'react';
import {
    View,
    Text,
    TextInput,
    StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface CookedByRowProps {
    cookedBy: string;
    onCookedByChange: (value: string) => void;
    theme: {
        border: string;
        text: string;
        textSecondary: string;
    };
}

export function CookedByRow({
    cookedBy,
    onCookedByChange,
    theme,
}: CookedByRowProps) {
    return (
        <View style={[styles.row, { borderBottomColor: theme.border }]}>
            <View style={styles.left}>
                <Ionicons name="person" size={18} color={theme.textSecondary} />
                <Text style={[styles.label, { color: theme.textSecondary }]}>
                    Cooked by
                </Text>
            </View>
            <TextInput
                style={[styles.input, { color: theme.text }]}
                placeholder="e.g. Me, Mom..."
                placeholderTextColor={theme.textSecondary}
                value={cookedBy}
                onChangeText={onCookedByChange}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
    },
    left: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    label: {
        fontSize: 14,
    },
    input: {
        flex: 1,
        fontSize: 14,
        textAlign: 'right',
        paddingVertical: 0,
    },
});
