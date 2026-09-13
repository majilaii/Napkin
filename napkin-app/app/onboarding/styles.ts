/** Shared setup grammar: paper insets, upright editorial type, clear controls. */
import { StyleSheet } from 'react-native';
import { Radius, Spacing, Type } from '@/constants/theme';

export const onboardingStyles = StyleSheet.create({
    root: { flex: 1 },
    body: {
        flexGrow: 1,
        paddingHorizontal: Spacing.lg,
        paddingTop: Spacing.lg,
        paddingBottom: Spacing.xl,
    },
    heading: { ...Type.displayLarge, marginBottom: Spacing.md },
    description: { ...Type.body, marginBottom: Spacing.xl },
    paper: { padding: Spacing.lg, borderRadius: Radius.xl },
    label: { ...Type.sectionKicker, marginBottom: Spacing.sm },
    input: {
        ...Type.listNameInput,
        minHeight: Spacing.xxl,
        paddingVertical: Spacing.sm,
        borderBottomWidth: 1,
    },
    skipButton: {
        minHeight: Spacing.hitTarget,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: Spacing.sm,
    },
    skip: { ...Type.body },
    footer: { paddingTop: Spacing.md, paddingHorizontal: Spacing.lg },
    primaryBtn: {
        minHeight: Spacing.hitTarget + Spacing.sm,
        borderRadius: Radius.full,
        paddingVertical: Spacing.md,
        paddingHorizontal: Spacing.lg,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryBtnText: { ...Type.titleMedium },
    completionError: { ...Type.metadata, marginBottom: Spacing.sm },
});
