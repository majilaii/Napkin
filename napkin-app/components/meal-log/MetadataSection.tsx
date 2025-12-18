import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface MetadataSectionProps {
    theme: {
        border: string;
        text: string;
        textSecondary: string;
    };
    children?: React.ReactNode; // For Location row
}

export function MetadataSection({
    theme,
    children,
}: MetadataSectionProps) {
    return (
        <View style={[styles.metadataSection, { borderTopColor: theme.border }]}>
            {/* Location (passed as children) */}
            {children}

            {/* Future: Tags (will open a modal) */}
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
});
