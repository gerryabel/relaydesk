export interface EmptyStateProps {
  title: string;
  description: string;
  action?: React.ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-neutral-300 bg-white px-6 py-12 text-center dark:border-neutral-700 dark:bg-neutral-900">
      <h3 className="text-base font-medium text-neutral-900 dark:text-neutral-50">{title}</h3>
      <p className="mt-2 max-w-sm text-sm text-neutral-600 dark:text-neutral-300">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
