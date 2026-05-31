import type { SpaceTheme } from '@agentx/shared';
import { resolveSpaceTheme } from '@agentx/shared';

// Forest theme — green/gold earthy tones
const FOREST_THEME: SpaceTheme = {
  primary: '#4ADE80',
  primaryDim: '#22C55E',
  accent: '#FBBF24',
  accentDim: '#F59E0B',
  background: '#0A0F0A',
  surface: '#121A12',
  surfaceHover: '#1A241A',
  text: '#E6EDE6',
  textDim: '#6B806B',
  textMuted: '#3D4F3D',
  border: '#2A3A2A',
  borderActive: '#4ADE80',
  success: '#4ADE80',
  warning: '#FBBF24',
  error: '#FB7185',
  info: '#60A5FA',
  tokenLow: '#4ADE80',
  tokenMedium: '#FBBF24',
  tokenHigh: '#FB7185',
  tokenGreen: '#4ADE80',
  tokenAmber: '#FBBF24',
  tokenRed: '#FB7185',
};

// Ocean theme — blue/teal aquatic tones
const OCEAN_THEME: SpaceTheme = {
  primary: '#38BDF8',
  primaryDim: '#0EA5E9',
  accent: '#34D399',
  accentDim: '#10B981',
  background: '#0B1320',
  surface: '#122031',
  surfaceHover: '#1A2D42',
  text: '#E0F2FE',
  textDim: '#6B8FA8',
  textMuted: '#3D5A70',
  border: '#1E3A5F',
  borderActive: '#38BDF8',
  success: '#34D399',
  warning: '#FDE047',
  error: '#F87171',
  info: '#38BDF8',
  tokenLow: '#34D399',
  tokenMedium: '#FDE047',
  tokenHigh: '#F87171',
  tokenGreen: '#34D399',
  tokenAmber: '#FDE047',
  tokenRed: '#F87171',
};

// Sunset theme — warm orange/pink tones
const SUNSET_THEME: SpaceTheme = {
  primary: '#FB923C',
  primaryDim: '#F97316',
  accent: '#E879F9',
  accentDim: '#D946EF',
  background: '#1A0F0A',
  surface: '#241812',
  surfaceHover: '#2E1F1A',
  text: '#FFEDE0',
  textDim: '#B08C78',
  textMuted: '#6B4F40',
  border: '#3D2A1E',
  borderActive: '#FB923C',
  success: '#34D399',
  warning: '#FBBF24',
  error: '#F87171',
  info: '#E879F9',
  tokenLow: '#34D399',
  tokenMedium: '#FBBF24',
  tokenHigh: '#F87171',
  tokenGreen: '#34D399',
  tokenAmber: '#FBBF24',
  tokenRed: '#F87171',
};

// Monochrome theme — grayscale subtle
const MONOCHROME_THEME: SpaceTheme = {
  primary: '#94A3B8',
  primaryDim: '#64748B',
  accent: '#CBD5E1',
  accentDim: '#94A3B8',
  background: '#0F0F12',
  surface: '#1A1A1E',
  surfaceHover: '#242428',
  text: '#E2E2E6',
  textDim: '#84848A',
  textMuted: '#4A4A50',
  border: '#2A2A30',
  borderActive: '#94A3B8',
  success: '#A3E635',
  warning: '#EAB308',
  error: '#EF4444',
  info: '#94A3B8',
  tokenLow: '#A3E635',
  tokenMedium: '#EAB308',
  tokenHigh: '#EF4444',
  tokenGreen: '#A3E635',
  tokenAmber: '#EAB308',
  tokenRed: '#EF4444',
};

// Retro theme — amber CRT terminal
const RETRO_THEME: SpaceTheme = {
  primary: '#FFB000',
  primaryDim: '#CC8400',
  accent: '#00FF00',
  accentDim: '#00CC00',
  background: '#0A0A00',
  surface: '#141400',
  surfaceHover: '#1E1E00',
  text: '#FFD700',
  textDim: '#9A8200',
  textMuted: '#554800',
  border: '#332800',
  borderActive: '#FFB000',
  success: '#00FF00',
  warning: '#FFB000',
  error: '#FF4500',
  info: '#00FF00',
  tokenLow: '#00FF00',
  tokenMedium: '#FFB000',
  tokenHigh: '#FF4500',
  tokenGreen: '#00FF00',
  tokenAmber: '#FFB000',
  tokenRed: '#FF4500',
};

// Colorblind-friendly theme — high-contrast, blue/orange palette
const COLORBLIND_THEME: SpaceTheme = {
  primary: '#0077BB',
  primaryDim: '#005588',
  accent: '#EE7733',
  accentDim: '#CC5500',
  background: '#0D1117',
  surface: '#161B22',
  surfaceHover: '#1C2128',
  text: '#E6EDF3',
  textDim: '#7D8590',
  textMuted: '#484F58',
  border: '#30363D',
  borderActive: '#0077BB',
  success: '#33BBEE',
  warning: '#EE7733',
  error: '#CC3311',
  info: '#0077BB',
  tokenLow: '#33BBEE',
  tokenMedium: '#EE7733',
  tokenHigh: '#CC3311',
  tokenGreen: '#33BBEE',
  tokenAmber: '#EE7733',
  tokenRed: '#CC3311',
};

const BUILTIN_THEMES: Record<string, SpaceTheme> = {
  space: resolveSpaceTheme('dark'),
  space_light: resolveSpaceTheme('light'),
  forest: FOREST_THEME,
  ocean: OCEAN_THEME,
  sunset: SUNSET_THEME,
  monochrome: MONOCHROME_THEME,
  retro: RETRO_THEME,
  colorblind: COLORBLIND_THEME,
};

export function getBuiltinTheme(name: string): SpaceTheme | undefined {
  return BUILTIN_THEMES[name];
}

export function listBuiltinThemes(): string[] {
  return Object.keys(BUILTIN_THEMES);
}

export function applyTheme(name: string): SpaceTheme {
  const theme = getBuiltinTheme(name);
  if (!theme) return getBuiltinTheme('space')!;
  return theme;
}
