import * as Linking from 'expo-linking';
import { ScrollView, View } from 'react-native';
import { useStore } from '@/lib/store';
import { Button, Card, Divider, ScreenHeader, T } from '@/ui/components';
import { gutter } from '@/ui/theme';

const FAQ = [
  ['Où sont mes e-books ?', 'Dans l’onglet Bibliothèque, dès que le paiement est confirmé. Connectez-vous avec le même compte sur tous vos appareils.'],
  ['Mon paiement est « en vérification »', 'Nous attendons la confirmation du prestataire de paiement. Vous recevrez un e-mail dès qu’elle arrive, et l’e-book apparaîtra automatiquement.'],
  ['Lire sans connexion', 'Dans la bibliothèque, touchez l’icône de téléchargement. Le contenu est chiffré et reste sur cet appareil.'],
  ['Mon paiement a échoué', 'Aucun montant n’est débité et votre panier est conservé. Vérifiez votre carte ou essayez un autre moyen de paiement.'],
  ['Changer la taille du texte', 'Dans le lecteur, touchez « Tт » : taille et interligne sont réglables.'],
];

export default function HelpScreen() {
  const { config } = useStore();
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
      <ScreenHeader back title="Aide" />
      <View style={{ paddingHorizontal: gutter, gap: 16, paddingTop: 8 }}>
        <Card style={{ paddingHorizontal: 16 }}>
          {FAQ.map(([q, a], i) => (
            <View key={q}>
              {i > 0 && <Divider />}
              <View style={{ paddingVertical: 14, gap: 4 }}>
                <T weight="bold" accessibilityRole="header" style={{ fontSize: 15 }}>{q}</T>
                <T muted style={{ fontSize: 14, lineHeight: 20 }}>{a}</T>
              </View>
            </View>
          ))}
        </Card>
        {config?.supportEmail ? (
          <Button label="Contacter le support" variant="accent" icon="mail" onPress={() => Linking.openURL(`mailto:${config.supportEmail}`)} />
        ) : (
          <T muted style={{ fontSize: 14 }}>Le contact du support sera indiqué ici.</T>
        )}
      </View>
    </ScrollView>
  );
}
