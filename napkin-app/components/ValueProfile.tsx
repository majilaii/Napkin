import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polygon, Line, Circle } from 'react-native-svg';
import { Colors } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

export interface ValueProfileProps {
    values: {
        flavor: number;
        ambience: number;
        value: number;
        service: number;
    };
    setValues: (values: any) => void;
    readOnly?: boolean;
}

const CATEGORIES = [
    { key: 'flavor', label: 'Flavor' },
    { key: 'ambience', label: 'Ambience' },
    { key: 'value', label: 'Value' },
    { key: 'service', label: 'Service' },
];

const TOTAL_POINTS = 40;
const MAX_PER_CATEGORY = 20;

export default function ValueProfile({ values, setValues, readOnly = false }: ValueProfileProps) {
    const colorScheme = useColorScheme();
    const theme = Colors[colorScheme ?? 'light'];

    const currentTotal = Object.values(values).reduce((a, b) => a + b, 0);
    const pointsRemaining = TOTAL_POINTS - currentTotal;

    const handleIncrement = (key: string) => {
        if (pointsRemaining > 0 && values[key as keyof typeof values] < MAX_PER_CATEGORY) {
            setValues({ ...values, [key]: values[key as keyof typeof values] + 1 });
        }
    };

    const handleDecrement = (key: string) => {
        if (values[key as keyof typeof values] > 0) {
            setValues({ ...values, [key]: values[key as keyof typeof values] - 1 });
        }
    };

    // Radar Chart Logic
    const size = 200;
    const center = size / 2;
    const radius = 80;
    const angleStep = (Math.PI * 2) / CATEGORIES.length;

    const points = useMemo(() => {
        return CATEGORIES.map((cat, index) => {
            const value = values[cat.key as keyof typeof values];
            // Normalize value (0-20) to radius (0-80)
            const r = (value / MAX_PER_CATEGORY) * radius;
            const x = center + r * Math.cos(index * angleStep - Math.PI / 2);
            const y = center + r * Math.sin(index * angleStep - Math.PI / 2);
            return `${x},${y}`;
        }).join(' ');
    }, [values]);

    const axisPoints = useMemo(() => {
        return CATEGORIES.map((_, index) => {
            const x = center + radius * Math.cos(index * angleStep - Math.PI / 2);
            const y = center + radius * Math.sin(index * angleStep - Math.PI / 2);
            return { x, y };
        });
    }, []);

    return (
        <View style={styles.container}>
            {/* Radar Chart */}
            <View style={styles.chartContainer}>
                <Svg height={size} width={size}>
                    {/* Background Web */}
                    {[0.25, 0.5, 0.75, 1].map((scale) => (
                        <Polygon
                            key={scale}
                            points={CATEGORIES.map((_, index) => {
                                const r = radius * scale;
                                const x = center + r * Math.cos(index * angleStep - Math.PI / 2);
                                const y = center + r * Math.sin(index * angleStep - Math.PI / 2);
                                return `${x},${y}`;
                            }).join(' ')}
                            stroke={theme.icon}
                            strokeWidth="0.5"
                            fill="none"
                            opacity={0.3}
                        />
                    ))}

                    {/* Axes */}
                    {axisPoints.map((p, i) => (
                        <Line
                            key={i}
                            x1={center}
                            y1={center}
                            x2={p.x}
                            y2={p.y}
                            stroke={theme.icon}
                            strokeWidth="0.5"
                            opacity={0.5}
                        />
                    ))}

                    {/* Data Polygon */}
                    <Polygon
                        points={points}
                        fill={theme.tint}
                        fillOpacity="0.2"
                        stroke={theme.tint}
                        strokeWidth="2"
                    />

                    {/* Dots */}
                    {CATEGORIES.map((cat, index) => {
                        const value = values[cat.key as keyof typeof values];
                        const r = (value / MAX_PER_CATEGORY) * radius;
                        const x = center + r * Math.cos(index * angleStep - Math.PI / 2);
                        const y = center + r * Math.sin(index * angleStep - Math.PI / 2);
                        return (
                            <Circle
                                key={cat.key}
                                cx={x}
                                cy={y}
                                r="4"
                                fill={theme.tint}
                            />
                        );
                    })}
                </Svg>
            </View>

            {!readOnly && (
                <View style={styles.controlsContainer}>
                    <Text style={[styles.budget, { color: theme.text }]}>
                        Points Remaining: <Text style={{ color: pointsRemaining < 0 ? 'red' : theme.tint }}>{pointsRemaining}</Text>
                    </Text>

                    {CATEGORIES.map((cat) => (
                        <View key={cat.key} style={styles.row}>
                            <Text style={[styles.label, { color: theme.text }]}>{cat.label}</Text>
                            <View style={styles.stepper}>
                                <TouchableOpacity onPress={() => handleDecrement(cat.key)} style={styles.button}>
                                    <Ionicons name="remove-circle-outline" size={28} color={theme.icon} />
                                </TouchableOpacity>
                                <Text style={[styles.value, { color: theme.text }]}>{values[cat.key as keyof typeof values]}</Text>
                                <TouchableOpacity onPress={() => handleIncrement(cat.key)} style={styles.button}>
                                    <Ionicons name="add-circle-outline" size={28} color={pointsRemaining > 0 && values[cat.key as keyof typeof values] < MAX_PER_CATEGORY ? theme.tint : theme.icon} />
                                </TouchableOpacity>
                            </View>
                        </View>
                    ))}
                </View>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        width: '100%',
        alignItems: 'center',
    },
    chartContainer: {
        marginBottom: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    controlsContainer: {
        width: '100%',
        paddingHorizontal: 20,
    },
    budget: {
        fontSize: 16,
        fontWeight: 'bold',
        textAlign: 'center',
        marginBottom: 15,
    },
    row: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 12,
    },
    label: {
        fontSize: 16,
        fontWeight: '500',
    },
    stepper: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    button: {
        padding: 4,
    },
    value: {
        fontSize: 16,
        fontWeight: 'bold',
        width: 24,
        textAlign: 'center',
    },
});
