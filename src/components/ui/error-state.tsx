import Link from 'next/link';
import { Button } from '@/components/ui/button';

type ErrorStateProps = {
  message?: string;
  retry?: {
    label: string;
    href?: string;
    onClick?: () => void;
  };
};

export function DashboardErrorState({ message = 'Gagal memuat data tiket.', retry }: ErrorStateProps) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-10 text-center dark:border-red-900 dark:bg-red-950/40">
      <p className="text-sm font-medium text-red-900 dark:text-red-100">{message}</p>
      {retry && (
        <div className="mt-4 flex justify-center">
          {retry.href ? (
            <Link href={retry.href} className="inline-flex items-center justify-center rounded-md bg-red-600 px-3 py-2 text-sm text-white hover:bg-red-500">
              {retry.label}
            </Link>
          ) : (
            <Button onClick={retry.onClick}>{retry.label}</Button>
          )}
        </div>
      )}
    </div>
  );
}
