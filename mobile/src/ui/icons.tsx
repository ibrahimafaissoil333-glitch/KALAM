import Svg, { Circle, Path, Rect } from 'react-native-svg';

/** Icônes du prototype (trait 1,8, coins arrondis). Décoratives : masquées aux lecteurs d'écran. */
export type IconName =
  | 'user' | 'search' | 'arrow' | 'back' | 'chevron' | 'cart' | 'trash' | 'info' | 'eye' | 'eyeOff' | 'shield'
  | 'lock' | 'check' | 'close' | 'books' | 'mail' | 'download' | 'home' | 'grid' | 'sort' | 'alert' | 'clock'
  | 'list' | 'text' | 'logout' | 'help' | 'doc' | 'device' | 'bell' | 'offline';

export function Icon({ name, size = 22, color = '#14151F', stroke = 1.8 }: { name: IconName; size?: number; color?: string; stroke?: number }) {
  const p = { fill: 'none', stroke: color, strokeWidth: stroke, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  const paths: Record<IconName, React.ReactNode> = {
    user: <><Circle cx="12" cy="8" r="4" {...p} /><Path d="M4 21a8 8 0 0 1 16 0" {...p} /></>,
    search: <><Circle cx="11" cy="11" r="7" {...p} /><Path d="m20 20-3.5-3.5" {...p} /></>,
    arrow: <><Path d="M5 12h14" {...p} /><Path d="m13 6 6 6-6 6" {...p} /></>,
    back: <Path d="m15 18-6-6 6-6" {...p} />,
    chevron: <Path d="m9 18 6-6-6-6" {...p} />,
    cart: <><Path d="M5 8h14l-1.2 12.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8z" {...p} /><Path d="M9 8V6.5a3 3 0 0 1 6 0V8" {...p} /></>,
    trash: <><Path d="M4 7h16" {...p} /><Path d="M9 7V4h6v3" {...p} /><Path d="M6 7l1 13h10l1-13" {...p} /></>,
    info: <><Circle cx="12" cy="12" r="9" {...p} /><Path d="M12 11v5.5" {...p} /><Path d="M12 7.5v.01" {...p} /></>,
    eye: <><Path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" {...p} /><Circle cx="12" cy="12" r="3" {...p} /></>,
    eyeOff: <><Path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" {...p} /><Path d="M4 4l16 16" {...p} /></>,
    shield: <><Path d="M12 3 4.5 6v6c0 4.5 3.2 7.7 7.5 9 4.3-1.3 7.5-4.5 7.5-9V6z" {...p} /><Path d="m9 12 2 2 4-4" {...p} /></>,
    lock: <><Rect x="5" y="10.5" width="14" height="10" rx="2" {...p} /><Path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" {...p} /></>,
    check: <Path d="m5 12.5 4.5 4.5L19 7.5" {...p} />,
    close: <><Path d="M6 6l12 12" {...p} /><Path d="M18 6 6 18" {...p} /></>,
    books: <><Path d="M4 4h4v16H4z" {...p} /><Path d="M10 4h4v16h-4z" {...p} /><Path d="m16 5 3.6-.9 2.4 15.5-3.6.9z" {...p} /></>,
    mail: <><Rect x="3" y="5" width="18" height="14" rx="2" {...p} /><Path d="m3.5 6 8.5 7 8.5-7" {...p} /></>,
    download: <><Path d="M12 4v11" {...p} /><Path d="m7 10 5 5 5-5" {...p} /><Path d="M5 20h14" {...p} /></>,
    home: <><Path d="M3 10.5 12 3l9 7.5" {...p} /><Path d="M5 9.5V21h14V9.5" {...p} /><Path d="M10 21v-6h4v6" {...p} /></>,
    grid: <><Rect x="3.5" y="3.5" width="7" height="7" rx="1.5" {...p} /><Rect x="13.5" y="3.5" width="7" height="7" rx="1.5" {...p} /><Rect x="3.5" y="13.5" width="7" height="7" rx="1.5" {...p} /><Rect x="13.5" y="13.5" width="7" height="7" rx="1.5" {...p} /></>,
    sort: <><Path d="M7 4v16" {...p} /><Path d="m3 8 4-4 4 4" {...p} /><Path d="M17 20V4" {...p} /><Path d="m21 16-4 4-4-4" {...p} /></>,
    alert: <><Circle cx="12" cy="12" r="9" {...p} /><Path d="M12 7.5v5.5" {...p} /><Path d="M12 16.5v.01" {...p} /></>,
    clock: <><Circle cx="12" cy="12" r="9" {...p} /><Path d="M12 7v5l3 2" {...p} /></>,
    list: <><Path d="M8 6h12" {...p} /><Path d="M8 12h12" {...p} /><Path d="M8 18h12" {...p} /><Path d="M4 6h.01" {...p} /><Path d="M4 12h.01" {...p} /><Path d="M4 18h.01" {...p} /></>,
    text: <><Path d="M4 7V5h11v2" {...p} /><Path d="M9.5 5v14" {...p} /><Path d="M14 12v-1.5h7V12" {...p} /><Path d="M17.5 10.5V19" {...p} /></>,
    logout: <><Path d="M15 4h4v16h-4" {...p} /><Path d="M10 8l-4 4 4 4" {...p} /><Path d="M6 12h10" {...p} /></>,
    help: <><Circle cx="12" cy="12" r="9" {...p} /><Path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6" {...p} /><Path d="M12 17v.01" {...p} /></>,
    doc: <><Path d="M6 3h8l4 4v14H6z" {...p} /><Path d="M14 3v4h4" {...p} /><Path d="M9 12h6" {...p} /><Path d="M9 16h6" {...p} /></>,
    device: <><Rect x="7" y="3" width="10" height="18" rx="2" {...p} /><Path d="M11 18h2" {...p} /></>,
    bell: <><Path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" {...p} /><Path d="M10 20a2 2 0 0 0 4 0" {...p} /></>,
    offline: <><Path d="M2 8.5a15 15 0 0 1 20 0" {...p} /><Path d="M5.5 12a10 10 0 0 1 13 0" {...p} /><Path d="M9 15.5a5 5 0 0 1 6 0" {...p} /><Path d="M3 3l18 18" {...p} /></>,
  };
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" color={color} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {paths[name]}
    </Svg>
  );
}
