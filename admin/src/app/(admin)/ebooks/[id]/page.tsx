import { EbookEditor } from '@/components/ebook-editor';

export const metadata = { title: 'Livre' };

export default async function EditEbook({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EbookEditor id={id} />;
}
