import { router } from 'expo-router';

/** Après connexion ou inscription, on reprend l'action interrompue (paiement, bibliothèque…). */
export function continueAfterAuth(after: string | null, setAfter: (a: string | null) => void) {
  setAfter(null);
  if (after === 'pay') router.replace('/checkout/pay');
  else if (after === 'library') router.dismissTo('/library');
  else if (router.canGoBack()) router.back();
  else router.replace('/account');
}
