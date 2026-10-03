import { PageHead } from '@/components/ui';
import { StatsView } from '@/components/stats-view';

export const metadata = { title: 'Statistiques' };

export default function StatsPage() {
  return (
    <>
      <PageHead title="Statistiques" sub="Les indicateurs reposent uniquement sur les commandes enregistrées" />
      <StatsView />
    </>
  );
}
