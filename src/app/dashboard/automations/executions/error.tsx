'use client';

import { useEffect } from 'react';
import { DashboardErrorState } from '@/components/ui/error-state';

type AutomationExecutionsErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function AutomationExecutionsError({
  error,
  reset,
}: AutomationExecutionsErrorProps) {
  useEffect(() => {
    console.error('Automation execution history failed to load', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <DashboardErrorState
        message="Gagal memuat riwayat eksekusi otomasi."
        retry={{ label: 'Coba lagi', onClick: reset }}
      />
    </div>
  );
}
