import { Redirect, useLocalSearchParams } from 'expo-router';

/**
 * Lien profond folio://checkout/return?order=… (retour du prestataire, ex. si l'app a été fermée).
 * On ne lit pas `result` : seul le serveur fait foi.
 */
export default function CheckoutReturn() {
  const { order } = useLocalSearchParams<{ order?: string }>();
  if (!order) return <Redirect href="/" />;
  return <Redirect href={{ pathname: '/checkout/result', params: { order } }} />;
}
