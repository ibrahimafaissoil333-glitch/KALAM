import { PageHead } from '@/components/ui';
import { StatsView } from '@/components/stats-view';

export const metadata = { title: 'Tableau de bord' };

export default function Dashboard() {
  return (
    <>
      <PageHead title="Tableau de bord" sub="Vue d’ensemble des ventes et du catalogue" />
      <StatsView dashboard />
    </>
  );
}
