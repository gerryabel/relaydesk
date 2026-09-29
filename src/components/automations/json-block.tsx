const MAX_RENDERED_LENGTH = 4000;

/**
 * Readable, bounded rendering of stored JSON (action configs, outbox payloads).
 *
 * Payloads are arbitrary and can be large, so the value is pretty-printed,
 * wrapped, and truncated with an explicit note instead of letting it break the
 * surrounding layout. `break-all` keeps long single-token values (ids, URLs)
 * inside the block.
 */
export function JsonBlock({ value, label }: { value: unknown; label?: string }) {
  let text: string;

  try {
    text = JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    text = String(value);
  }

  const truncated = text.length > MAX_RENDERED_LENGTH;
  const rendered = truncated ? `${text.slice(0, MAX_RENDERED_LENGTH)}\n…` : text;

  return (
    <div className="flex flex-col gap-1">
      {label ? (
        <span className="text-xs font-medium text-neutral-600 dark:text-neutral-300">{label}</span>
      ) : null}
      <pre
        className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-neutral-100 p-3 text-xs text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
        data-truncated={truncated ? 'true' : 'false'}
      >
        {rendered}
      </pre>
      {truncated ? (
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          Output truncated to {MAX_RENDERED_LENGTH} characters.
        </span>
      ) : null}
    </div>
  );
}
