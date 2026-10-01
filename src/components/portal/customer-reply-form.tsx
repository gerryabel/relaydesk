'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createCustomerReplyWithAttachmentsAction } from '@/lib/customer-portal/actions';
import {
  CUSTOMER_ATTACHMENTS_PER_MESSAGE_LIMIT,
  CUSTOMER_REPLY_BODY_MAX_LENGTH,
} from '@/lib/customer-portal/schema';
import { attachmentConfig } from '@/lib/attachments/config';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { CustomerAttachmentList, type CustomerAttachmentItem } from '@/components/portal/customer-attachment-list';

/**
 * Customer reply form with attachments (Phase 9 Task 3; attachments in Task 4).
 *
 * One field, `body`, because that is the only thing a customer controls about
 * their own words. The action's schema is strict, so anything else this
 * component tried to send — a status, a customer id, an author — would be
 * rejected server-side rather than honoured.
 *
 * How a reply and its files are written (Phase 9 Task 4):
 *
 * ```text
 * 1. customer submits the reply
 * 2. the reply is stored, and is the customer-authored message
 * 3. each selected file is attached to that message
 * 4. the conversation re-renders with what actually landed
 * ```
 *
 * The order is chosen, not incidental. The reply is the record of what the
 * customer said and it is what they would be upset to lose, so it is committed
 * first; a file that cannot be stored is reported individually instead of
 * rolling the whole submission back. Doing the upload through the server action
 * rather than from the browser is what keeps the raw message id out of the
 * payload — the portal never exposes it (Task 3), and completing a round trip
 * from the client would have required it.
 *
 * Failure handling:
 *
 *  - A failed *reply* keeps the text and the selected files, because neither was
 *    accepted by the server. Losing a paragraph and an attachment to a transient
 *    error is what makes people stop replying.
 *  - A partially failed *upload* clears the form, because the reply was sent,
 *    and lists the files that did not land. Suppressing that would report
 *    "sent" for something that was not stored, and Task 4 has no customer delete
 *    path to fall back on.
 *  - Server messages are rendered verbatim; the action has already replaced
 *    anything internal with a fixed sentence before returning.
 *
 * The client-side size check is a courtesy — it saves a pointless round trip and
 * a confusing error — not a control. The server derives `sizeBytes` from the
 * received bytes and enforces the same limit.
 */
export function CustomerReplyForm({
  workspaceSlug,
  ticketId,
}: {
  workspaceSlug: string;
  ticketId: string;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [failedFiles, setFailedFiles] = useState<
    Array<{ filename: string; reason: string }> | null
  >(null);
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<File[]>([]);

  /** Largest number the server will accept, for the file input's own cap. */
  const maxFiles = CUSTOMER_ATTACHMENTS_PER_MESSAGE_LIMIT;

  /** Read from the shared config so the label cannot drift from the limit. */
  const maxFileSizeMb = attachmentConfig.maxFileSizeBytes / (1024 * 1024);

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    setError(null);
    setFailedFiles(null);

    const incoming = Array.from(event.target.files ?? []);

    if (incoming.length > maxFiles) {
      setError(`You can attach up to ${maxFiles} files to a reply.`);
      setSelected([]);
      resetFileInput();
      return;
    }

    const tooLarge = incoming.find((file) => file.size > attachmentConfig.maxFileSizeBytes);

    if (tooLarge) {
      setError(`${tooLarge.name} is larger than the ${maxFileSizeMb} MB limit.`);
      setSelected([]);
      resetFileInput();
      return;
    }

    setSelected(incoming);
  }

  function resetFileInput() {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    // Captured before the await: `event.currentTarget` is not guaranteed to
    // still be the form once the action resolves.
    const form = event.currentTarget;
    const body = (new FormData(form).get('body') as string | null)?.trim() ?? '';

    const result = await createCustomerReplyWithAttachmentsAction(
      workspaceSlug,
      ticketId,
      { body },
      selected,
    );

    if ('error' in result) {
      // Nothing was stored, so the text and the selection both survive.
      setError(result.error);
      setPending(false);
      return;
    }

    form.reset();
    setSelected([]);
    resetFileInput();
    setFailedFiles(result.failed.length > 0 ? result.failed : null);
    setPending(false);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={pending} className="flex flex-col gap-3">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
        >
          {error}
        </p>
      ) : null}

      {failedFiles ? (
        <div
          role="status"
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <p>Your reply was sent, but some files were not attached:</p>
          <ul className="mt-1 list-disc pl-5">
            {failedFiles.map((file, index) => (
              // Indexed too: two files can fail under the same name.
              <li key={`${index}-${file.filename}`}>
                {file.filename} — {file.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <Label htmlFor="customer-reply-body">Add a reply</Label>
        <Textarea
          id="customer-reply-body"
          name="body"
          rows={5}
          required
          maxLength={CUSTOMER_REPLY_BODY_MAX_LENGTH}
          aria-describedby="customer-reply-help"
        />
        <p id="customer-reply-help" className="text-xs text-neutral-600 dark:text-neutral-300">
          Your reply is added to the conversation and emailed to us. Up to{' '}
          {CUSTOMER_REPLY_BODY_MAX_LENGTH} characters.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="customer-reply-files">Attach files (optional)</Label>
        <input
          ref={fileInputRef}
          id="customer-reply-files"
          type="file"
          multiple
          disabled={pending}
          onChange={handleFileChange}
          aria-describedby="customer-reply-files-help"
          className="text-sm text-neutral-700 file:mr-3 file:rounded-md file:border file:border-neutral-300 file:bg-white file:px-3 file:py-2 file:text-sm file:font-medium file:text-neutral-700 dark:text-neutral-200 dark:file:border-neutral-700 dark:file:bg-neutral-900 dark:file:text-neutral-200"
        />
        <p
          id="customer-reply-files-help"
          className="text-xs text-neutral-600 dark:text-neutral-300"
        >
          Up to {maxFiles} files, {maxFileSizeMb} MB each. Images, PDF, Word, Excel,
          plain text, CSV or ZIP.
        </p>

        {selected.length > 0 ? (
          <CustomerAttachmentList
            attachments={selected.map<CustomerAttachmentItem>((file, index) => ({
              // Indexed rather than the bare name: selecting `notes.txt` twice
              // would otherwise produce duplicate React keys.
              id: `${index}-${file.name}`,
              originalFilename: file.name,
              mimeType: file.type || 'application/octet-stream',
              sizeBytes: file.size,
              state: 'pending',
            }))}
          />
        ) : null}
      </div>

      <div>
        <Button type="submit" disabled={pending}>
          {pending ? 'Sending reply...' : 'Send reply'}
        </Button>
      </div>
    </form>
  );
}