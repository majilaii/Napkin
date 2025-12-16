import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    Modal,
    StyleSheet,
    Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type LogType = 'meal' | 'restaurant' | 'table';

interface LogTypeActionSheetProps {
    visible: boolean;
    onClose: () => void;
    onSelect: (type: LogType) => void;
}

export function LogTypeActionSheet({
    visible,
    onClose,
    onSelect,
}: LogTypeActionSheetProps) {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    const options: { type: LogType; icon: keyof typeof Ionicons.glyphMap; title: string; subtitle: string; disabled?: boolean }[] = [
        {
            type: 'meal',
            icon: 'restaurant-outline',
            title: 'Log a Meal',
            subtitle: 'Rate what you ate at home or anywhere',
        },
        {
            type: 'restaurant',
            icon: 'storefront-outline',
            title: 'Log a Restaurant',
            subtitle: 'Rate a dining out experience',
        },
        {
            type: 'table',
            icon: 'people-outline',
            title: 'Table Event',
            subtitle: 'Log with your dining group',
            disabled: true,
        },
    ];

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            onRequestClose={onClose}
        >
            <Pressable style={styles.overlay} onPress={onClose}>
                <View style={[styles.sheet, { backgroundColor: theme.background }]}>
                    <Text style={[styles.title, { color: theme.text }]}>
                        What are you logging?
                    </Text>

                    {options.map((option) => (
                        <TouchableOpacity
                            key={option.type}
                            style={[
                                styles.option,
                                { borderColor: theme.border },
                                option.disabled && styles.optionDisabled,
                            ]}
                            onPress={() => {
                                if (!option.disabled) {
                                    onSelect(option.type);
                                    onClose();
                                }
                            }}
                            disabled={option.disabled}
                        >
                            <Ionicons
                                name={option.icon}
                                size={28}
                                color={option.disabled ? theme.textSecondary : theme.text}
                                style={styles.optionIcon}
                            />
                            <View style={styles.optionText}>
                                <Text
                                    style={[
                                        styles.optionTitle,
                                        { color: option.disabled ? theme.textSecondary : theme.text },
                                    ]}
                                >
                                    {option.title}
                                    {option.disabled && ' (coming soon)'}
                                </Text>
                                <Text style={[styles.optionSubtitle, { color: theme.textSecondary }]}>
                                    {option.subtitle}
                                </Text>
                            </View>
                            {!option.disabled && (
                                <Ionicons
                                    name="chevron-forward"
                                    size={20}
                                    color={theme.textSecondary}
                                />
                            )}
                        </TouchableOpacity>
                    ))}

                    <TouchableOpacity
                        style={[styles.cancelButton, { borderColor: theme.border }]}
                        onPress={onClose}
                    >
                        <Text style={[styles.cancelText, { color: theme.text }]}>
                            Cancel
                        </Text>
                    </TouchableOpacity>
                </View>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    overlay: {
        flex: 1,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        justifyContent: 'flex-end',
    },
    sheet: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        padding: 20,
        paddingBottom: 40,
    },
    title: {
        fontSize: 18,
        fontWeight: '600',
        textAlign: 'center',
        marginBottom: 20,
    },
    option: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 16,
        borderWidth: 1,
        borderRadius: 12,
        marginBottom: 12,
    },
    optionDisabled: {
        opacity: 0.5,
    },
    optionIcon: {
        marginRight: 16,
    },
    optionText: {
        flex: 1,
    },
    optionTitle: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 2,
    },
    optionSubtitle: {
        fontSize: 13,
    },
    cancelButton: {
        padding: 16,
        borderWidth: 1,
        borderRadius: 12,
        alignItems: 'center',
        marginTop: 8,
    },
    cancelText: {
        fontSize: 16,
        fontWeight: '500',
    },
});
