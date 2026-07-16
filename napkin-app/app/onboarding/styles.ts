/**
 * Shared onboarding styles (TICKET-107) — Heirloom Journal grammar.
 * Labels in Manrope (functional text, real contrast); serif italic reserved for
 * brand/content moments only — never for prompts or field labels.
 */
import { StyleSheet } from 'react-native';
import { Colors, Spacing } from '@/constants/theme';

export const onboardingStyles = StyleSheet.create({
    root: {
        flex: 1,
    },
    body: {
        flex: 1,
        paddingHorizontal: 24,
    },
    kicker: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 11,
        letterSpacing: 1.8,
        textTransform: 'uppercase',
        marginBottom: 8,
    },
    // The ONE serif-italic brand moment per screen.
    brandLine: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 32,
        lineHeight: 38,
        letterSpacing: -0.5,
        marginBottom: Spacing.xl,
    },
    label: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 12,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
        marginBottom: 8,
    },
    input: {
        fontFamily: 'Newsreader_400Regular_Italic',
        fontSize: 22,
        paddingVertical: 8,
        borderBottomWidth: 1,
    },
    skip: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
        marginTop: Spacing.lg,
        alignSelf: 'flex-start',
    },
    footer: {
        paddingHorizontal: 24,
    },
    primaryBtn: {
        height: 52,
        borderRadius: 999,
        alignItems: 'center',
        justifyContent: 'center',
    },
    primaryBtnText: {
        fontFamily: 'Manrope_700Bold',
        fontSize: 15,
        letterSpacing: 0.3,
        color: Colors.light.textInverse,
    },
    completionError: {
        fontFamily: 'Manrope_600SemiBold',
        fontSize: 13,
        lineHeight: 18,
        marginBottom: Spacing.sm,
    },
});
