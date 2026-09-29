export default function AutomationExecutionsLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <div className="h-7 w-48 rounded-md bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-4 w-72 rounded-md bg-neutral-200 dark:bg-neutral-700" />
        </div>
        <ul className="flex flex-col gap-3" aria-label="Loading automation executions">
          {Array.from({ length: 5 }).map((_, index) => (
            <li
              key={index}
              className="h-28 animate-pulse rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900"
            />
          ))}
        </ul>
      </div>
    </div>
  );
}
