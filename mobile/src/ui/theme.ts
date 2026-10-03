/** Système visuel Folio (docs/design-tokens.json). */
export const color = {
  ink: '#14151F',
  inkPressed: '#2B2D3A',
  indigo: '#3B36E0',
  indigoPressed: '#2A25B8',
  indigoSoft: '#ECEBFF',
  indigoText: '#2E29B8',
  indigoDeep: '#241FA0',
  lime: '#D7F25C',
  paper: '#FAFAF7',
  surface: '#FFFFFF',
  muted: '#5C5E6B',
  placeholder: '#76788A',
  border: '#E6E5E0',
  borderStrong: '#DAD9D3',
  borderControl: '#E3E2DC',
  divider: '#ECEBE6',
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
  neutralSoft: '#ECECEF',
  neutralText: '#3D3E48',
  infoSoft: '#EEF0EC',
  readerPaper: '#F6F1E6',
  readerText: '#22201A',
  readerMuted: '#5F5A4C',
  readerBorder: '#E2DCCB',
  readerTrack: '#E6DFCC',
} as const;

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
