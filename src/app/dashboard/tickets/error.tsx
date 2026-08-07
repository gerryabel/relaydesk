'use client';

import { useEffect } from 'react';
import { DashboardErrorState } from '@/components/ui/error-state';

type TicketsErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function TicketsError({ error, reset }: TicketsErrorProps) {
  useEffect(() => {
    console.error('Tickets page failed to load', error);
  }, [error]);

  return (
    <DashboardErrorState
      message="Gagal memuat daftar tiket."
      retry={{
        label: 'Coba lagi',
        onClick: reset,
      }}
    />
  );
}
