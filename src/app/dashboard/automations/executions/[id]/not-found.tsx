import Link from 'next/link';

export default function AutomationExecutionNotFound() {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-10 text-center dark:border-red-900 dark:bg-red-950/40">
      <p className="text-sm font-medium text-red-900 dark:text-red-100">
        Automation execution tidak ditemukan.
      </p>
      <div className="mt-4 flex justify-center">
        <Link
          href="/dashboard/automations/executions"
          className="inline-flex items-center justify-center rounded-md border border-neutral-300 px-3 py-2 text-sm hover:border-neutral-900 dark:border-neutral-700 dark:hover:border-neutral-100"
        >
          Back to execution history
        </Link>
      </div>
    </div>
  );
}
