import type { CustomerAttachmentView } from '@/lib/customer-portal/dto';

/**
 * Customer attachment list (Phase 9 Task 4).
 *
 * One component for both places an attachment appears in the portal: the files
 * a customer has selected but not yet sent, and the files stored on a
 * conversation entry. The difference is `state`, and only `state` — a download
 * link is present for stored attachments and absent for a pending selection,
 * because there is no authorized URL for a file the server has not received.
 *
 * The download link is the customer endpoint
 * `/api/portal/{slug}/attachments/{id}`, never the internal `/api/attachments/{id}`.
 * That is not a stylistic choice: the internal route authorizes a Better Auth
 * workspace membership, which a customer session cannot satisfy, so linking to
 * it would produce a `401` — and were it to succeed it would be the wrong
 * authorization domain entirely.
 *
 * The filename shown is whatever the DTO carries, already sanitized on the way
 * in and again on the way out. It is rendered as text by React, so it cannot
 * inject markup; there is no `dangerouslySetInnerHTML` anywhere in this path.
 */
export type CustomerAttachmentItem = Pick<
  CustomerAttachmentView,
  'id' | 'originalFilename' | 'mimeType' | 'sizeBytes'
> & { state?: 'pending' | 'stored' };

export function CustomerAttachmentList({
  attachments,
  workspaceSlug,
}: {
  attachments: readonly CustomerAttachmentItem[];
  /**
   * Omitted while composing: a selected file has no id yet, so there is no
   * authorized download URL to build.
   */
  workspaceSlug?: string;
}) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <ul className="flex flex-col gap-1">
      {attachments.map((attachment) => (
        <li
          key={`${attachment.state ?? 'stored'}-${attachment.id}`}
          className="flex flex-wrap items-center gap-2 rounded-md border border-neutral-200 bg-neutral-50 px-3 py-1.5 dark:border-neutral-700 dark:bg-neutral-800"
        >
          {attachment.state === 'pending' || !workspaceSlug ? (
            <span className="break-all text-xs font-medium text-neutral-800 dark:text-neutral-100">
              {attachment.originalFilename}
            </span>
          ) : (
            <a
              href={`/api/portal/${encodeURIComponent(workspaceSlug)}/attachments/${encodeURIComponent(attachment.id)}`}
              className="break-all text-xs font-medium text-blue-600 hover:underline dark:text-blue-400"
              download
            >
              {attachment.originalFilename}
            </a>
          )}
          <span className="text-xs text-neutral-500 dark:text-neutral-400">
            {formatCustomerFileSize(attachment.sizeBytes)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Human-readable size for the portal.
 *
 * Locale-independent by construction: the portal otherwise renders dates in a
 * fixed `en-US`/UTC format, and a size that changes shape with the reader's
 * locale makes a file's size ambiguous when quoted to support.
 */
export function formatCustomerFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return '';
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}