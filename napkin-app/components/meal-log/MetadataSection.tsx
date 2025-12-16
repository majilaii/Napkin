import React from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface MetadataSectionProps {
    cookedBy: string;
    onCookedByChange: (value: string) => void;
    theme: {
        border: string;
        text: string;
        textSecondary: string;
    };
    children?: React.ReactNode; // For PlacePicker
}

export function MetadataSection({
    cookedBy,
    onCookedByChange,
    theme,
    children,
}: MetadataSectionProps) {
    return (
        <View style={[styles.metadataSection, { borderTopColor: theme.border }]}>
            {/* Place Picker (passed as children) */}
            {children}

            {/* Who Cooked */}
            <View style={[styles.metadataRow, { borderBottomColor: theme.border }]}>
                <View style={styles.metadataLeft}>
                    <Ionicons name="person" size={20} color={theme.textSecondary} />
                    <Text style={[styles.metadataLabel, { color: theme.textSecondary }]}>
                        Cooked by
                    </Text>
                </View>
                <TextInput
                    style={[styles.metadataInput, { color: theme.text }]}
                    placeholder="Me"
                    placeholderTextColor={theme.textSecondary}
                    value={cookedBy}
                    onChangeText={onCookedByChange}
                />
            </View>

            {/* Future: Tags */}
            <TouchableOpacity
                style={[styles.metadataRow, { borderBottomColor: theme.border, opacity: 0.5 }]}
                disabled
            >
                <View style={styles.metadataLeft}>
                    <Ionicons name="pricetag" size={20} color={theme.textSecondary} />
                    <Text style={[styles.metadataLabel, { color: theme.textSecondary }]}>
                        Tags
                    </Text>
                </View>
                <View style={styles.metadataRight}>
                    <Text style={[styles.metadataValue, { color: theme.textSecondary }]}>
                        Coming soon
                    </Text>
                </View>
            </TouchableOpacity>
        </View>
    );
}

const styles = StyleSheet.create({
    metadataSection: {
        marginTop: 16,
        borderTopWidth: 1,
    },
    metadataRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 14,
        paddingHorizontal: 20,
        borderBottomWidth: 1,
    },
    metadataLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    metadataLabel: {
        fontSize: 15,
    },
    metadataRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
    },
    metadataValue: {
        fontSize: 15,
    },
    metadataInput: {
        flex: 1,
        fontSize: 15,
        textAlign: 'right',
        paddingVertical: 0,
    },
});
