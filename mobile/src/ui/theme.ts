/**
 * Système visuel Kalam (docs/design-tokens.json). Le logo est recoloré dans cette charte :
 * livre en encre, plume en indigo. « gold » = l’accent lime, uniquement sur fond sombre.
 *
 * Deux palettes, choisies selon le réglage clair / sombre du téléphone (applyScheme, appelée par
 * le layout racine qui remonte l'arbre à chaque changement). `color` est muté en place : les écrans
 * lisent toujours la palette active au moment du rendu.
 */
const light = {
  ink: '#14151F',
  inkPressed: '#2B2D3A',
  onInk: '#FFFFFF',
  night: '#14151F',
  body: '#2E3040',
  accent: '#3B36E0',
  accentPressed: '#2A25B8',
  accentSoft: '#ECEBFF',
  accentText: '#2E29B8',
  accentDeep: '#241FA0',
  gold: '#D7F25C',
  goldPressed: '#C9E44A',
  onGold: '#14151F',
  paper: '#FAFAF7',
  surface: '#FFFFFF',
  muted: '#5C5E6B',
  placeholder: '#76788A',
  border: '#E6E5E0',
  borderStrong: '#DAD9D3',
  borderControl: '#E3E2DC',
  divider: '#ECEBE6',
  track: '#C9C8C2',
  success: '#1E7A4C',
  successSoft: '#E2F3E9',
  successText: '#1B6340',
  successRing: '#DDF0E5',
  warningSoft: '#FFF0D2',
  warningText: '#7A4E00',
  danger: '#B4232C',
  dangerSoft: '#FBE4E5',
  dangerText: '#9E1F27',
  dangerRing: '#F8DFE0',
  dangerBorder: '#F0C4C6',
  neutralSoft: '#ECECEF',
  neutralText: '#3D3E48',
  infoSoft: '#EEF0EC',
  focusRing: '#E3E2FF',
  glassFill: 'rgba(255,255,255,0.55)',
  glassBorder: 'rgba(255,255,255,0.75)',
  readerPaper: '#F6F1E6',
  readerText: '#22201A',
  readerMuted: '#5F5A4C',
  readerBorder: '#E2DCCB',
  readerTrack: '#E6DFCC',
};

const dark: typeof light = {
  ink: '#ECEBE6',
  inkPressed: '#D2D1CB',
  onInk: '#14151F',
  night: '#23253A',
  body: '#D4D5DE',
  accent: '#7C78FF',
  accentPressed: '#6A65F0',
  accentSoft: '#26244A',
  accentText: '#BDBAFF',
  accentDeep: '#CFCDFF',
  gold: '#D7F25C',
  goldPressed: '#C9E44A',
  onGold: '#14151F',
  paper: '#0F1017',
  surface: '#1A1B25',
  muted: '#A3A5B3',
  placeholder: '#7E8092',
  border: '#2C2E3B',
  borderStrong: '#3A3C4B',
  borderControl: '#34364A',
  divider: '#262836',
  track: '#3A3C4B',
  success: '#4CC38A',
  successSoft: '#173326',
  successText: '#7FDCAB',
  successRing: '#1B3A2B',
  warningSoft: '#3A2E12',
  warningText: '#F2C46B',
  danger: '#F0616B',
  dangerSoft: '#3A1A1D',
  dangerText: '#FF9AA1',
  dangerRing: '#401E22',
  dangerBorder: '#5A2A2F',
  neutralSoft: '#2A2B35',
  neutralText: '#C9CAD3',
  infoSoft: '#222430',
  focusRing: '#2E2B66',
  glassFill: 'rgba(30,31,44,0.55)',
  glassBorder: 'rgba(255,255,255,0.14)',
  // Le lecteur garde son papier sépia (confort de lecture), assombri.
  readerPaper: '#1C1A16',
  readerText: '#E8E2D2',
  readerMuted: '#A9A08C',
  readerBorder: '#3A352B',
  readerTrack: '#3A352B',
};

export type Scheme = 'light' | 'dark';
export const color: typeof light = { ...light };
export let scheme: Scheme = 'light';

export function applyScheme(next: Scheme) {
  scheme = next;
  Object.assign(color, next === 'dark' ? dark : light);
}

export const font = {
  serif: 'InstrumentSerif_400Regular',
  regular: 'HankenGrotesk_400Regular',
  medium: 'HankenGrotesk_500Medium',
  semibold: 'HankenGrotesk_600SemiBold',
  bold: 'HankenGrotesk_700Bold',
} as const;

export const size = { button: 52, buttonSm: 44, touch: 44, input: 52, chip: 40 } as const;
export const radius = { control: 12, button: 14, card: 18, hero: 24, tile: 28 } as const;
export const gutter = 20;

/** Mode « verre » (réglage de l'utilisateur) : surfaces translucides façon Liquid Glass. */
export let glass = false;
export function applyGlass(next: boolean) {
  glass = next;
}
