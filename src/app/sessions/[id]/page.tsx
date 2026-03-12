import { SessionDetailView } from '@/components/session-detail';

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="p-6">
      <SessionDetailView id={id} />
    </div>
  );
}
