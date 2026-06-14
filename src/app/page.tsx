import { Suspense } from 'react';
import { SessionList } from '@/components/session-list';

export default function Home() {
  return (
    <div className="p-6">
      <Suspense>
        <SessionList />
      </Suspense>
    </div>
  );
}
