import { router } from 'expo-router';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  PressableProps,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  TextStyle,
  View,
  ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, IconName } from './icons';
import { color, font, gutter, radius, size } from './theme';

// ── Typographie ───────────────────────────────────────────────

export function T({ style, serif, muted, weight, ...rest }: React.ComponentProps<typeof Text> & { serif?: boolean; muted?: boolean; weight?: 'regular' | 'medium' | 'semibold' | 'bold' }) {
  return (
    <Text
      maxFontSizeMultiplier={2}
      style={[{ fontFamily: serif ? font.serif : font[weight ?? 'regular'], color: muted ? color.muted : color.ink, fontSize: 16 }, serif && { letterSpacing: -0.2 }, style]}
      {...rest}
    />
  );
}

export function H1({ children, style }: { children: ReactNode; style?: StyleProp<TextStyle> }) {
  return (
    <T serif accessibilityRole="header" style={[{ fontSize: 40, lineHeight: 42 }, style]}>
      {children}
    </T>
  );
}

// ── Boutons ───────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'accent' | 'ghost' | 'lime' | 'link' | 'danger';

export function Button({
  label, onPress, variant = 'primary', small, icon, iconRight, loading, disabled, style, accessibilityLabel,
}: {
  label: string; onPress?: () => void; variant?: ButtonVariant; small?: boolean; icon?: IconName; iconRight?: IconName;
  loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; accessibilityLabel?: string;
}) {
  const v = VARIANTS[variant];
  const off = disabled || loading;
  return (
    <Pressable
      onPress={off ? undefined : onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSm,
        { backgroundColor: pressed ? v.pressed : v.bg, borderColor: v.border, borderWidth: v.border ? 1.5 : 0 },
        off && { opacity: 0.6 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : icon ? <Icon name={icon} size={small ? 18 : 20} color={v.fg} /> : null}
      <T weight="semibold" style={{ color: v.fg, fontSize: small ? 14 : 16 }}>
        {label}
      </T>
      {iconRight && !loading && <Icon name={iconRight} size={18} color={v.fg} />}
    </Pressable>
  );
}

const VARIANTS: Record<ButtonVariant, { bg: string; pressed: string; fg: string; border?: string }> = {
  primary: { bg: color.ink, pressed: color.inkPressed, fg: '#FFFFFF' },
  accent: { bg: color.indigo, pressed: color.indigoPressed, fg: '#FFFFFF' },
  ghost: { bg: 'transparent', pressed: '#F0EFEA', fg: color.ink, border: '#D6D5CF' },
  lime: { bg: color.lime, pressed: '#C9E44A', fg: color.ink },
  link: { bg: 'transparent', pressed: 'transparent', fg: color.indigo },
  danger: { bg: 'transparent', pressed: color.dangerSoft, fg: color.dangerText, border: '#F0C4C6' },
};

export function IconButton({ icon, label, onPress, badge, tone = 'default', style }: { icon: IconName; label: string; onPress: () => void; badge?: number; tone?: 'default' | 'reader'; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={badge ? `${label}, ${badge} article${badge > 1 ? 's' : ''}` : label}
      hitSlop={4}
      style={({ pressed }) => [
        styles.ibtn,
        tone === 'reader' && { backgroundColor: 'transparent', borderColor: color.readerBorder },
        pressed && { backgroundColor: '#F3F2EE' },
        style,
      ]}
    >
      <Icon name={icon} />
      {!!badge && (
        <View style={[styles.badge, { top: -6, right: -6 }]}>
          <T weight="bold" style={styles.badgeText}>{badge}</T>
        </View>
      )}
    </Pressable>
  );
}

export function LinkButton({ label, onPress, style }: { label: string; onPress: () => void; style?: StyleProp<ViewStyle> }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" hitSlop={8} style={[{ minHeight: size.touch, justifyContent: 'center' }, style]}>
      {({ pressed }) => <T weight="semibold" style={{ fontSize: 14, color: pressed ? color.indigoPressed : color.indigo }}>{label}</T>}
    </Pressable>
  );
}

// ── Puces, étiquettes, pastilles ──────────────────────────────

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={[styles.chip, selected && { backgroundColor: color.ink, borderColor: color.ink }]}
    >
      <T weight="semibold" style={{ fontSize: 14, color: selected ? '#FFFFFF' : color.ink }}>{label}</T>
    </Pressable>
  );
}

export function Tag({ label, tone = 'indigo' }: { label: string; tone?: 'indigo' | 'lime' }) {
  return (
    <View style={[styles.tag, tone === 'lime' && { backgroundColor: color.lime }]}>
      <T weight="bold" style={{ fontSize: 12, letterSpacing: 0.2, color: tone === 'lime' ? color.ink : color.indigoText }}>{label}</T>
    </View>
  );
}

const PILL = {
  PAID: ['Confirmée', color.successSoft, color.successText],
  PENDING: ['En attente', color.warningSoft, color.warningText],
  FAILED: ['Échouée', color.dangerSoft, color.dangerText],
  REFUNDED: ['Remboursée', color.neutralSoft, color.neutralText],
  CANCELED: ['Annulée', color.neutralSoft, color.neutralText],
  OK: ['Disponible', color.successSoft, color.successText],
  OFFLINE: ['Hors ligne', color.successSoft, color.successText],
} as const;

export function StatusPill({ status }: { status: keyof typeof PILL }) {
  const [label, bg, fg] = PILL[status];
  return (
    <View style={[styles.pill, { backgroundColor: bg }]} accessibilityLabel={`Statut : ${label}`}>
      <View style={[styles.dot, { backgroundColor: fg }]} />
      <T weight="bold" style={{ fontSize: 12, color: fg }}>{label}</T>
    </View>
  );
}

// ── Champs ────────────────────────────────────────────────────

export function TextField({ label, error, hint, password, ...input }: TextInputProps & { label: string; error?: string; hint?: ReactNode; password?: boolean }) {
  const [focus, setFocus] = useState(false);
  const [show, setShow] = useState(false);
  return (
    <View style={{ gap: 8 }}>
      <T weight="semibold" style={{ fontSize: 14 }} nativeID={`${label}-label`}>{label}</T>
      <View>
        <TextInput
          accessibilityLabel={label}
          accessibilityLabelledBy={`${label}-label`}
          placeholderTextColor={color.placeholder}
          secureTextEntry={password && !show}
          autoCapitalize={password ? 'none' : input.autoCapitalize}
          maxFontSizeMultiplier={2}
          onFocus={() => setFocus(true)}
          onBlur={() => setFocus(false)}
          style={[
            styles.input,
            focus && { borderColor: color.indigo, boxShadow: `0 0 0 4px ${'#E3E2FF'}` },
            !!error && { borderColor: color.danger },
            password && { paddingRight: 56 },
          ]}
          {...input}
        />
        {password && (
          <Pressable
            onPress={() => setShow(!show)}
            accessibilityRole="button"
            accessibilityLabel={show ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
            style={{ position: 'absolute', right: 4, top: 4, width: size.touch, height: size.touch, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name={show ? 'eyeOff' : 'eye'} color={color.muted} />
          </Pressable>
        )}
      </View>
      {error ? <T style={{ fontSize: 13, color: color.dangerText }} accessibilityLiveRegion="polite">{error}</T> : hint}
    </View>
  );
}

export function Rule({ ok, label }: { ok: boolean; label: string }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }} accessibilityLabel={`${label} : ${ok ? 'respecté' : 'non respecté'}`}>
      <Icon name={ok ? 'check' : 'close'} size={16} color={ok ? color.successText : color.muted} stroke={2.2} />
      <T style={{ fontSize: 13, color: ok ? color.successText : color.muted }}>{label}</T>
    </View>
  );
}

export function Checkbox({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <Pressable onPress={() => onChange(!checked)} accessibilityRole="checkbox" accessibilityState={{ checked }} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', minHeight: size.touch }}>
      <View style={[styles.box, checked && { backgroundColor: color.indigo, borderColor: color.indigo }]}>
        {checked && <Icon name="check" size={16} color="#FFFFFF" stroke={2.6} />}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Pressable>
  );
}

export function Switch({ value, onChange, disabled, label, sub }: { value: boolean; onChange?: (v: boolean) => void; disabled?: boolean; label: string; sub?: string }) {
  return (
    <Pressable
      onPress={disabled ? undefined : () => onChange?.(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={sub ? `${label}. ${sub}` : label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 12, minHeight: size.touch }}
    >
      <View style={{ flex: 1 }}>
        <T weight="semibold" style={{ fontSize: 15 }}>{label}</T>
        {sub && <T muted style={{ fontSize: 13 }}>{sub}</T>}
      </View>
      <View style={[styles.switch, value && { backgroundColor: color.indigo }, disabled && { opacity: 0.55 }]}>
        <View style={[styles.knob, { left: value ? 24 : 4 }]} />
      </View>
    </Pressable>
  );
}

// ── Couverture générée (secours si aucune image) ──────────────

export interface CoverData {
  bg: string;
  fg: string;
  tint?: string;
  url: string | null;
}

export function Cover({ title, author, cover, width, style }: { title: string; author: string; cover: CoverData; width: number; style?: StyleProp<ViewStyle> }) {
  const height = Math.round(width * 1.48);
  const s = width / 132;
  const base: ViewStyle = { width, height, borderTopLeftRadius: 4, borderBottomLeftRadius: 4, borderTopRightRadius: 10, borderBottomRightRadius: 10, overflow: 'hidden', boxShadow: '0 10px 22px -10px rgba(20,21,31,.55)' };
  if (cover.url) {
    return <Image source={{ uri: cover.url }} style={[base, style] as never} accessibilityRole="image" accessibilityLabel={`Couverture : ${title}`} />;
  }
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={`Couverture : ${title}`} style={[base, { backgroundColor: cover.bg, padding: 12 * s, paddingLeft: 15 * s, justifyContent: 'space-between' }, style]}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: Math.max(3, 5 * s), backgroundColor: 'rgba(0,0,0,.16)' }} />
      <T weight="bold" allowFontScaling={false} numberOfLines={1} style={{ color: cover.fg, opacity: 0.85, fontSize: Math.max(5, 9 * s), letterSpacing: 1.3 * s, textTransform: 'uppercase' }}>{author}</T>
      <View style={{ width: 55 * s, height: 55 * s, borderRadius: 999, borderWidth: 1.5, borderColor: cover.fg, opacity: 0.55, alignSelf: 'flex-end' }} />
      <T serif allowFontScaling={false} numberOfLines={3} style={{ color: cover.fg, fontSize: Math.max(8, 20 * s), lineHeight: Math.max(8, 20 * s) * 1.04 }}>{title}</T>
    </View>
  );
}

// ── Mise en page et états ─────────────────────────────────────

export function ScreenHeader({ title, back, right, sub }: { title?: string; back?: boolean; right?: ReactNode; sub?: string }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingTop: insets.top + 12, paddingHorizontal: gutter, paddingBottom: 8, gap: 12 }}>
      {(back || right) && (
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          {back ? <IconButton icon="back" label="Retour" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} /> : <View />}
          {right}
        </View>
      )}
      {title && <H1>{title}</H1>}
      {sub && <T muted style={{ fontSize: 14 }}>{sub}</T>}
    </View>
  );
}

export function EmptyState({ icon, title, text, children }: { icon: IconName; title: string; text?: string; children?: ReactNode }) {
  return (
    <View style={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, paddingVertical: 32, gap: 16 }}>
      <View style={styles.iconTile}>
        <Icon name={icon} size={44} color={color.indigo} stroke={1.6} />
      </View>
      <T serif accessibilityRole="header" style={{ fontSize: 30, lineHeight: 33, textAlign: 'center' }}>{title}</T>
      {text && <T muted style={{ textAlign: 'center', lineHeight: 24 }}>{text}</T>}
      {children && <View style={{ alignSelf: 'stretch', gap: 10 }}>{children}</View>}
    </View>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View style={styles.err} accessibilityRole="alert">
      <Icon name="alert" size={18} color={color.dangerText} />
      <T weight="semibold" style={{ flex: 1, fontSize: 14, color: color.dangerText }}>{message}</T>
      {onRetry && <LinkButton label="Réessayer" onPress={onRetry} />}
    </View>
  );
}

export function InfoNote({ icon = 'info', children, tone = 'muted' }: { icon?: IconName; children: ReactNode; tone?: 'muted' | 'box' | 'indigo' }) {
  const box = tone === 'box' ? { backgroundColor: color.infoSoft, padding: 14, paddingHorizontal: 16, borderRadius: 14 } : tone === 'indigo' ? { backgroundColor: color.indigoSoft, padding: 14, paddingHorizontal: 16, borderRadius: 14 } : {};
  const fg = tone === 'indigo' ? color.indigoDeep : tone === 'box' ? '#2E3040' : color.muted;
  return (
    <View style={[{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }, box]}>
      <Icon name={icon} size={18} color={fg} />
      <T weight={tone === 'indigo' ? 'semibold' : 'regular'} style={{ flex: 1, fontSize: 13, lineHeight: 19, color: fg }}>{children}</T>
    </View>
  );
}

export function Skeleton({ w, h, style }: { w?: number | `${number}%`; h: number; style?: StyleProp<ViewStyle> }) {
  const op = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (reduce) return;
      loop = Animated.loop(Animated.sequence([Animated.timing(op, { toValue: 0.5, duration: 600, useNativeDriver: true }), Animated.timing(op, { toValue: 1, duration: 600, useNativeDriver: true })]));
      loop.start();
    });
    return () => loop?.stop();
  }, [op]);
  return <Animated.View style={[{ width: w ?? '100%', height: h, borderRadius: 10, backgroundColor: color.divider, opacity: op }, style]} />;
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function RowLink({ icon, label, sub, onPress, danger }: { icon: IconName; label: string; sub?: string; onPress: () => void; danger?: boolean } & Pick<PressableProps, 'accessibilityHint'>) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={sub ? `${label}. ${sub}` : label} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, minHeight: 52 }, pressed && { opacity: 0.6 }]}>
      <Icon name={icon} color={danger ? color.dangerText : color.ink} />
      <View style={{ flex: 1 }}>
        <T weight="semibold" style={{ fontSize: 15, color: danger ? color.dangerText : color.ink }}>{label}</T>
        {sub && <T muted style={{ fontSize: 13 }}>{sub}</T>}
      </View>
      <Icon name="chevron" size={20} color={color.muted} />
    </Pressable>
  );
}

export function Divider() {
  return <View style={{ height: 1, backgroundColor: color.divider }} />;
}

/** Barre d'étapes du tunnel d'achat (Panier · Paiement · Confirmation). */
export function StepBar({ step }: { step: 1 | 2 | 3 }) {
  const steps = ['Panier', 'Paiement', 'Confirmation'];
  return (
    <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: gutter, paddingVertical: 8 }} accessibilityLabel={`Étape ${step} sur 3 : ${steps[step - 1]}`}>
      {steps.map((s, i) => (
        <View key={s} style={{ flex: 1, gap: 6 }} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <View style={{ height: 4, borderRadius: 2, backgroundColor: i < step ? color.indigo : color.border }} />
          <T weight={i === step - 1 ? 'bold' : 'semibold'} style={{ fontSize: 12, color: i < step ? color.ink : color.muted }}>{s}</T>
        </View>
      ))}
    </View>
  );
}

export function OfflineBanner() {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: color.ink, paddingVertical: 8, paddingHorizontal: gutter }} accessibilityRole="alert">
      <Icon name="offline" size={16} color={color.lime} />
      <T weight="semibold" style={{ color: '#FFFFFF', fontSize: 13 }}>Hors ligne · seuls les e-books téléchargés sont disponibles</T>
    </View>
  );
}

// ── Toast ─────────────────────────────────────────────────────

const ToastCtx = createContext<(msg: string) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((m: string) => {
    clearTimeout(timer.current);
    setMsg(m);
    AccessibilityInfo.announceForAccessibility(m);
    timer.current = setTimeout(() => setMsg(null), 2200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <View pointerEvents="none" style={styles.toast} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Icon name="check" size={18} color="#FFFFFF" stroke={2.2} />
          <T weight="semibold" style={{ color: '#FFFFFF', fontSize: 14, flex: 1 }}>{msg}</T>
        </View>
      )}
    </ToastCtx.Provider>
  );
}

const styles = StyleSheet.create({
  btn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, minHeight: size.button, paddingHorizontal: 20, borderRadius: radius.button },
  btnSm: { minHeight: size.buttonSm, paddingHorizontal: 16, borderRadius: radius.control },
  ibtn: { width: size.touch, height: size.touch, borderRadius: radius.control, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: color.borderControl, backgroundColor: color.surface },
  badge: { position: 'absolute', minWidth: 18, height: 18, borderRadius: 9, backgroundColor: color.indigo, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  badgeText: { color: '#FFFFFF', fontSize: 11 },
  chip: { minHeight: size.chip, paddingHorizontal: 16, borderRadius: 999, borderWidth: 1.5, borderColor: color.borderControl, backgroundColor: color.surface, justifyContent: 'center' },
  tag: { alignSelf: 'flex-start', minHeight: 26, paddingHorizontal: 10, borderRadius: 999, backgroundColor: color.indigoSoft, justifyContent: 'center' },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 26, paddingHorizontal: 10, borderRadius: 999, alignSelf: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3 },
  input: { minHeight: size.input, borderRadius: radius.button, borderWidth: 1.5, borderColor: color.borderStrong, backgroundColor: color.surface, paddingHorizontal: 16, fontSize: 16, fontFamily: font.regular, color: color.ink },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: color.borderStrong, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  switch: { width: 50, height: 30, borderRadius: 999, backgroundColor: '#C9C8C2' },
  knob: { position: 'absolute', top: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFFFFF' },
  iconTile: { width: 96, height: 96, borderRadius: radius.tile, backgroundColor: color.indigoSoft, alignItems: 'center', justifyContent: 'center' },
  err: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: color.dangerSoft, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 14, minHeight: 44 },
  card: { backgroundColor: color.surface, borderWidth: 1, borderColor: color.border, borderRadius: radius.card },
  toast: { position: 'absolute', left: 16, right: 16, bottom: 110, backgroundColor: color.ink, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 16, flexDirection: 'row', gap: 10, alignItems: 'center', boxShadow: '0 14px 30px -10px rgba(20,21,31,.6)' },
});
