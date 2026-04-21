/**
 * Icon — canonical Napkin icon wrapper.
 *
 * Wraps Ionicons with theme-aware colors and standardised IconSize tokens.
 * All icon usage across the app should go through this primitive to ensure
 * consistent sizing and color treatment.
 *
 * Sizes use the IconSize scale from the design system:
 *   xs=12  sm=16  md=20  lg=24  xl=28  xxl=32
 *
 * Canvas reference: design-system icon tokens.
 */
import React from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Colors, IconSize } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

type IoniconsName = keyof typeof Ionicons.glyphMap;
type SizeToken = keyof typeof IconSize;

interface Props {
  name: IoniconsName;
  /** Named size token from IconSize, or a raw number */
  size?: SizeToken | number;
  /** Theme-aware color key or raw color string */
  color?: keyof (typeof Colors)['light'] | string;
  /** Override to skip theme lookup and use raw color string */
  rawColor?: string;
}

export function Icon({ name, size = 'lg', color, rawColor }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const palette = Colors[scheme];

  const resolvedSize = typeof size === 'number' ? size : IconSize[size];

  let resolvedColor: string;
  if (rawColor) {
    resolvedColor = rawColor;
  } else if (color && color in palette) {
    resolvedColor = (palette as Record<string, string>)[color];
  } else if (color) {
    resolvedColor = color;
  } else {
    resolvedColor = palette.icon;
  }

  return <Ionicons name={name} size={resolvedSize} color={resolvedColor} />;
}

export default Icon;
