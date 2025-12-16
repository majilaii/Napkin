import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    Platform,
    StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';

interface DatePickerRowProps {
    date: Date;
    onDateChange: (date: Date) => void;
    showPicker: boolean;
    onShowPickerChange: (show: boolean) => void;
    theme: {
        border: string;
        text: string;
        textSecondary: string;
        primary: string;
        background: string;
    };
    colorScheme?: 'light' | 'dark' | null;
}

export function DatePickerRow({
    date,
    onDateChange,
    showPicker,
    onShowPickerChange,
    theme,
    colorScheme,
}: DatePickerRowProps) {
    const formatDate = (d: Date) => {
        const today = new Date();
        const isToday = d.toDateString() === today.toDateString();
        if (isToday) return 'Today';

        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';

        return d.toLocaleDateString('en-US', {
            weekday: 'short',
            month: 'short',
            day: 'numeric'
        });
    };

    const handleDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
        if (Platform.OS === 'android') {
            onShowPickerChange(false);
        }
        if (selectedDate) {
            onDateChange(selectedDate);
        }
    };

    return (
        <View>
            <TouchableOpacity
                style={[styles.dateRow, { borderBottomColor: theme.border }]}
                onPress={() => onShowPickerChange(true)}
            >
                <View style={styles.dateLeft}>
                    <Ionicons name="calendar-outline" size={18} color={theme.textSecondary} />
                    <Text style={[styles.dateLabel, { color: theme.textSecondary }]}>Date</Text>
                </View>
                <View style={styles.dateRight}>
                    <Text style={[styles.dateValue, { color: theme.text }]}>
                        {formatDate(date)}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color={theme.textSecondary} />
                </View>
            </TouchableOpacity>

            {showPicker && (
                <View style={styles.pickerContainer}>
                    <TouchableOpacity
                        style={styles.closeIcon}
                        onPress={() => onShowPickerChange(false)}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                        <Ionicons name="close" size={22} color={theme.textSecondary} />
                    </TouchableOpacity>
                    <DateTimePicker
                        value={date}
                        mode="date"
                        display="spinner"
                        onChange={handleDateChange}
                        maximumDate={new Date()}
                        themeVariant={colorScheme ?? 'light'}
                        style={styles.picker}
                    />
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    dateRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 10,
        paddingHorizontal: 16,
        borderBottomWidth: 1,
    },
    dateLeft: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    dateLabel: {
        fontSize: 14,
    },
    dateRight: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
    },
    dateValue: {
        fontSize: 14,
        fontWeight: '500',
    },
    pickerContainer: {
        position: 'relative',
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: 8,
        paddingBottom: 8,
    },
    closeIcon: {
        position: 'absolute',
        top: 12,
        right: 16,
        zIndex: 1,
        padding: 4,
    },
    picker: {
        height: 140,
    },
});
