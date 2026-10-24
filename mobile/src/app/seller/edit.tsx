import * as DocumentPicker from 'expo-document-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, View } from 'react-native';
import { api, BookCondition, errorMessage, ProductKind, SellerEbook, ShippingMode, uploadSellerFile } from '@/lib/api';
import { centsToInput, CONDITION_LABEL, CURRENCIES, LANGUAGES, parseMoney, SHIPPING_LABEL } from '@/lib/format';
import { Button, Card, Choice, ErrorBanner, InfoNote, KindBadge, ScreenHeader, Skeleton, Switch, T, TextField, useToast } from '@/ui/components';
import { Icon } from '@/ui/icons';
import { color, gutter } from '@/ui/theme';

type Picked = { uri: string; name: string; mimeType: string };
interface ShipForm { enabled: boolean; price: string; countries: string; delay: string }

const KINDS = [['PHYSICAL', 'Livre physique'], ['DIGITAL', 'Livre numérique']] as const;
const CONDITIONS = Object.entries(CONDITION_LABEL) as [BookCondition, string][];
const MODES = Object.keys(SHIPPING_LABEL) as ShippingMode[];
const emptyShipping = (): Record<ShippingMode, ShipForm> => ({
  HAND: { enabled: true, price: '0', countries: '', delay: '' },
  POST: { enabled: false, price: '', countries: '', delay: '' },
  COURIER: { enabled: false, price: '', countries: '', delay: '' },
});

/**
 * Création / modification d'une annonce. Formulaire dynamique : les champs physiques
 * (état, stock, livraison) ou numériques (fichier PDF / EPUB) selon le type choisi.
 * Tout est revérifié par le serveur (seller_save_ebook, book_problems).
 */
export default function SellerEdit() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const toast = useToast();
  const [book, setBook] = useState<SellerEbook | null>(null);
  const [loading, setLoading] = useState(!!id);
  const [kind, setKind] = useState<ProductKind | null>(null);
  const [f, setF] = useState({ title: '', author: '', description: '', category: '', language: 'fr', price: '', currency: 'KMF', stock: '1' });
  const [condition, setCondition] = useState<BookCondition | null>(null);
  const [shipping, setShipping] = useState(emptyShipping);
  const [cover, setCover] = useState<Picked | null>(null);
  const [file, setFile] = useState<Picked | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api<SellerEbook>(`seller/ebooks/${id}`)
      .then((b) => {
        setBook(b);
        setKind(b.kind);
        setF({ title: b.title, author: b.author, description: b.description, category: b.category?.name ?? '', language: b.language, price: centsToInput(b.priceCents), currency: b.currency, stock: String(b.stock ?? 1) });
        setCondition(b.condition);
        const s = emptyShipping();
        if (b.shipping.length) MODES.forEach((m) => (s[m].enabled = false));
        b.shipping.forEach((o) => (s[o.mode] = { enabled: true, price: centsToInput(o.priceCents), countries: o.countries.join(', '), delay: o.delayDays === null ? '' : String(o.delayDays) }));
        setShipping(s);
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [id]);

  const set = (k: keyof typeof f) => (v: string) => {
    setF({ ...f, [k]: v });
    setErrors({ ...errors, [k]: '' });
  };
  const setShip = (m: ShippingMode, patch: Partial<ShipForm>) => setShipping({ ...shipping, [m]: { ...shipping[m], ...patch } });
  const hasMainFile = !!file || !!book?.files.some((x) => x.kind === 'MAIN');
  const locked = (book?.sales ?? 0) > 0;

  const pickCover = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', allowsEditing: true, aspect: [2, 3], quality: 0.8 });
    if (!r.canceled && r.assets[0]) {
      // Couverture réduite (900 px de large, JPEG) : affichage rapide dans le catalogue.
      const img = await (await ImageManipulator.manipulate(r.assets[0].uri).resize({ width: 900 }).renderAsync()).saveAsync({ compress: 0.75, format: SaveFormat.JPEG });
      setCover({ uri: img.uri, name: 'couverture.jpg', mimeType: 'image/jpeg' });
    }
  };
  const pickFile = async () => {
    const r = await DocumentPicker.getDocumentAsync({ type: ['application/pdf', 'application/epub+zip'], copyToCacheDirectory: true });
    if (!r.canceled && r.assets[0]) {
      const a = r.assets[0];
      const pdf = a.name.toLowerCase().endsWith('.pdf');
      if (!pdf && !a.name.toLowerCase().endsWith('.epub')) return setErrors({ ...errors, file: 'Choisissez un fichier PDF ou EPUB.' });
      setFile({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? (pdf ? 'application/pdf' : 'application/epub+zip') });
      setErrors({ ...errors, file: '' });
    }
  };

  /** Validation côté app (le serveur revérifie tout). */
  const validate = (forPublish: boolean) => {
    const e: Record<string, string> = {};
    if (!kind) e.kind = 'Choisissez « Livre physique » ou « Livre numérique ».';
    if (!f.title.trim()) e.title = 'Le titre est obligatoire.';
    if (!f.author.trim()) e.author = 'L’auteur est obligatoire.';
    if (f.price.trim() && parseMoney(f.price) === null) e.price = 'Prix invalide (ex. 2500 ou 12,50).';
    if (forPublish) {
      if (!f.price.trim()) e.price = 'Indiquez un prix.';
      if (!f.description.trim()) e.description = 'Ajoutez une description.';
      if (!f.category.trim()) e.category = 'Indiquez une catégorie.';
    }
    if (kind === 'PHYSICAL') {
      if (!/^\d+$/.test(f.stock)) e.stock = 'Stock : nombre entier.';
      if (forPublish && !condition) e.condition = 'Indiquez l’état du livre.';
      const on = MODES.filter((m) => shipping[m].enabled);
      if (on.length === 0) e.shipping = 'Choisissez au moins un mode de livraison.';
      on.forEach((m) => {
        if (parseMoney(shipping[m].price || '0') === null) e.shipping = `Frais invalides pour « ${SHIPPING_LABEL[m]} ».`;
      });
    }
    if (kind === 'DIGITAL' && forPublish && !hasMainFile) e.file = 'Ajoutez le fichier du livre (PDF ou EPUB).';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const save = async (publish: boolean) => {
    setError(null);
    if (!validate(publish)) return setError('Corrigez les champs indiqués.');
    setBusy(publish ? 'publish' : 'save');
    try {
      const payload = {
        kind, title: f.title.trim(), author: f.author.trim(), description: f.description.trim(), category: f.category.trim(),
        language: f.language, currency: f.currency, priceCents: f.price.trim() ? parseMoney(f.price) : null,
        ...(kind === 'PHYSICAL' && { condition, stock: Number(f.stock) }),
      };
      let b = await api<SellerEbook>(book ? `seller/ebooks/${book.id}` : 'seller/ebooks', { method: book ? 'PATCH' : 'POST', body: payload });
      if (kind === 'PHYSICAL') {
        const options = MODES.filter((m) => shipping[m].enabled).map((m) => ({
          mode: m,
          priceCents: parseMoney(shipping[m].price || '0'),
          countries: shipping[m].countries.split(/[\s,;]+/).map((c) => c.trim().toUpperCase()).filter(Boolean),
          delayDays: shipping[m].delay.trim() ? Number(shipping[m].delay) : null,
        }));
        b = await api<SellerEbook>(`seller/ebooks/${b.id}/shipping`, { method: 'PUT', body: { options } });
      }
      if (cover) b = await uploadSellerFile(b.id, 'cover', cover);
      if (file && kind === 'DIGITAL') b = await uploadSellerFile(b.id, 'main', file);
      setCover(null);
      setFile(null);
      if (publish) b = await api<SellerEbook>(`seller/ebooks/${b.id}/status`, { method: 'POST', body: { action: 'publish' } });
      setBook(b);
      toast(publish ? 'Votre livre est en vente' : 'Annonce enregistrée');
      if (!id) router.replace({ pathname: '/seller/edit', params: { id: b.id } });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const status = async (action: 'pause' | 'publish' | 'archive') => {
    if (!book) return;
    setBusy(action);
    setError(null);
    try {
      setBook(await api<SellerEbook>(`seller/ebooks/${book.id}/status`, { method: 'POST', body: { action } }));
      toast(action === 'pause' ? 'Annonce mise en pause' : action === 'publish' ? 'Votre livre est en vente' : 'Annonce retirée');
      if (action === 'archive') router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = () => {
    if (!book) return;
    Alert.alert('Supprimer l’annonce ?', 'Cette action est définitive.', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Supprimer', style: 'destructive', onPress: async () => {
          setBusy('delete');
          try {
            await api(`seller/ebooks/${book.id}`, { method: 'DELETE' });
            toast('Annonce supprimée');
            router.back();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(null);
          }
        },
      },
    ]);
  };

  if (loading) return <View style={{ flex: 1 }}><ScreenHeader back /><View style={{ padding: gutter, gap: 12 }}><Skeleton h={52} /><Skeleton h={52} /><Skeleton h={200} /></View></View>;

  const coverUri = cover?.uri ?? book?.cover.url ?? null;

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader back title={book ? 'Modifier l’annonce' : 'Mettre en vente'} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        {book && (
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <KindBadge kind={book.kind} />
            <T muted style={{ fontSize: 14 }}>{{ PUBLISHED: 'En vente', PAUSED: 'En pause', DRAFT: 'Brouillon', ARCHIVED: 'Retirée' }[book.status]} · {book.sales} vendu{book.sales > 1 ? 's' : ''}</T>
          </View>
        )}

        <Choice label="Type de livre *" value={kind} options={KINDS} onChange={(v) => { if (!locked) { setKind(v); setErrors({ ...errors, kind: '' }); } }} error={errors.kind} />
        {locked && <InfoNote>Le type ne peut plus changer : ce livre a déjà été vendu.</InfoNote>}

        {kind && (
          <>
            <TextField label="Titre *" value={f.title} onChangeText={set('title')} error={errors.title} maxLength={200} />
            <TextField label="Auteur *" value={f.author} onChangeText={set('author')} error={errors.author} maxLength={120} />
            <TextField label="Description" value={f.description} onChangeText={set('description')} error={errors.description} multiline style={{ minHeight: 110, textAlignVertical: 'top', paddingTop: 14 }} />
            <TextField label="Catégorie" value={f.category} onChangeText={set('category')} error={errors.category} placeholder="Roman, Jeunesse, Scolaire…" maxLength={60} />
            <Choice label="Langue" value={f.language} options={LANGUAGES} onChange={set('language')} />
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
              <View style={{ flex: 1 }}>
                <TextField label="Prix" value={f.price} onChangeText={set('price')} error={errors.price} keyboardType="decimal-pad" placeholder="0" />
              </View>
            </View>
            <Choice label="Devise" value={f.currency} options={CURRENCIES.map((c) => [c, c] as const)} onChange={set('currency')} />
            <InfoNote>Mobile Money est proposé aux acheteurs pour les prix en KMF (Comores) et en MGA (Madagascar). Une commission de la plateforme est déduite de vos gains.</InfoNote>

            <T weight="bold" style={{ fontSize: 17, marginTop: 4 }}>Couverture</T>
            <Pressable onPress={pickCover} accessibilityRole="button" accessibilityLabel="Choisir une image de couverture" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: color.borderStrong, backgroundColor: color.surface }}>
              {coverUri ? <Image source={{ uri: coverUri }} style={{ width: 56, height: 84, borderRadius: 6 }} /> : <Icon name="plus" color={color.accent} />}
              <T weight="semibold" style={{ flex: 1, fontSize: 15 }}>{coverUri ? 'Changer la couverture' : 'Ajouter une photo de couverture'}</T>
            </Pressable>

            {kind === 'PHYSICAL' ? (
              <>
                <Choice label="État du livre *" value={condition} options={CONDITIONS} onChange={(v) => { setCondition(v); setErrors({ ...errors, condition: '' }); }} error={errors.condition} />
                <TextField label="Quantité en stock *" value={f.stock} onChangeText={set('stock')} error={errors.stock} keyboardType="number-pad" />
                <T weight="bold" style={{ fontSize: 17, marginTop: 4 }}>Livraison *</T>
                {MODES.map((m) => (
                  <Card key={m} style={{ paddingHorizontal: 16, paddingVertical: 4, gap: 10 }}>
                    <Switch value={shipping[m].enabled} onChange={(v) => { setShip(m, { enabled: v }); setErrors({ ...errors, shipping: '' }); }} label={SHIPPING_LABEL[m]} />
                    {shipping[m].enabled && (
                      <View style={{ gap: 12, paddingBottom: 14 }}>
                        <TextField label={`Frais (${f.currency})`} value={shipping[m].price} onChangeText={(v) => setShip(m, { price: v })} keyboardType="decimal-pad" placeholder="0 = gratuit" />
                        <TextField label="Pays desservis (facultatif)" value={shipping[m].countries} onChangeText={(v) => setShip(m, { countries: v })} placeholder="KM, MG — vide = partout" autoCapitalize="characters" />
                        <TextField label="Délai en jours (facultatif)" value={shipping[m].delay} onChangeText={(v) => setShip(m, { delay: v.replace(/\D/g, '') })} keyboardType="number-pad" />
                      </View>
                    )}
                  </Card>
                ))}
                {errors.shipping && <T style={{ fontSize: 13, color: color.dangerText }}>{errors.shipping}</T>}
              </>
            ) : (
              <>
                <T weight="bold" style={{ fontSize: 17, marginTop: 4 }}>Fichier du livre *</T>
                <Pressable onPress={pickFile} accessibilityRole="button" accessibilityLabel="Choisir le fichier PDF ou EPUB" style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: errors.file ? color.danger : color.borderStrong, backgroundColor: color.surface }}>
                  <Icon name="doc" color={color.accent} />
                  <View style={{ flex: 1 }}>
                    <T weight="semibold" style={{ fontSize: 15 }}>{file?.name ?? book?.files.find((x) => x.kind === 'MAIN')?.originalName ?? 'Choisir un PDF ou un EPUB'}</T>
                    <T muted style={{ fontSize: 13 }}>100 Mo maximum · lisible uniquement dans l’app par les acheteurs</T>
                  </View>
                </Pressable>
                {errors.file && <T style={{ fontSize: 13, color: color.dangerText }}>{errors.file}</T>}
              </>
            )}

            {book && book.publishable.length > 0 && book.status !== 'PUBLISHED' && (
              <InfoNote icon="alert" tone="accent">À compléter avant la mise en vente : {book.publishable.join(', ')}.</InfoNote>
            )}
          </>
        )}
        {error && <ErrorBanner message={error} />}
      </ScrollView>

      {kind && (
        <View style={{ padding: gutter, gap: 8, borderTopWidth: 1, borderTopColor: color.border, backgroundColor: color.surface }}>
          {book?.status === 'PUBLISHED' ? (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button label="Mettre en pause" variant="ghost" small loading={busy === 'pause'} onPress={() => status('pause')} style={{ flex: 1 }} />
              <Button label="Enregistrer" small loading={busy === 'save'} onPress={() => save(false)} style={{ flex: 1 }} />
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Button label="Brouillon" variant="ghost" small loading={busy === 'save'} onPress={() => save(false)} style={{ flex: 1 }} />
              <Button label="Mettre en vente" variant="accent" small icon="tag" loading={busy === 'publish'} onPress={() => save(true)} style={{ flex: 2 }} />
            </View>
          )}
          {book && (book.sales > 0 ? (
            <Button label="Retirer de la vente" variant="danger" small loading={busy === 'archive'} onPress={() => status('archive')} />
          ) : (
            <Button label="Supprimer l’annonce" variant="danger" small loading={busy === 'delete'} onPress={remove} />
          ))}
        </View>
      )}
    </View>
  );
}
