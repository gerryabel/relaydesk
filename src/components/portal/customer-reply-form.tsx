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
 * Customer reply form with attachments.
 *
 * Upload flow (Phase 9 Task 5 transport hardening):
 *
 *  1. Submit the reply text through the Server Action.
 *  2. On success, upload each selected file directly to the authenticated
 *     attachment API in individual bounded requests.
 *  3. Report per-file failures after all uploads complete.
 *
 * Splitting the flow avoids embedding large files inside a Server Action
 * request, which Next.js caps at 1 MB by default.
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
  const [uploading, setUploading] = useState(false);

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

  async function uploadFile(
    workspaceSlug: string,
    ticketId: string,
    messageId: string,
    file: File,
  ): Promise<{ filename: string; reason?: string }> {
    const form = new FormData();
    form.append('file', file);

    const response = await fetch(
      `/api/portal/${encodeURIComponent(workspaceSlug)}/tickets/${encodeURIComponent(ticketId)}/messages/${encodeURIComponent(messageId)}/attachments`,
      { method: 'POST', body: form },
    );

    if (response.ok) {
      return { filename: file.name };
    }

    let reason = 'Upload failed.';
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) {
        reason = body.error;
      }
    } catch {
      // keep generic reason
    }

    return { filename: file.name, reason };
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFailedFiles(null);

    const form = event.currentTarget;
    const body = (new FormData(form).get('body') as string | null)?.trim() ?? '';

    // Step 1: create the reply via Server Action.
    const actionResult = await createCustomerReplyWithAttachmentsAction(
      workspaceSlug,
      ticketId,
      { body },
    );

    if ('error' in actionResult) {
      setError(actionResult.error);
      setPending(false);
      return;
    }

    // Step 2: upload each file directly to the authenticated attachment API.
    setUploading(true);
    const failed: Array<{ filename: string; reason: string }> = [];

    for (const file of selected) {
      const result = await uploadFile(
        workspaceSlug,
        ticketId,
        actionResult.messageId,
        file,
      );

      if (result.reason) {
        failed.push({ filename: result.filename, reason: result.reason });
      }
    }

    form.reset();
    setSelected([]);
    resetFileInput();
    setPending(false);
    setUploading(false);

    if (failed.length > 0) {
      setFailedFiles(failed);
    }

    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} aria-busy={pending || uploading} className="flex flex-col gap-3">
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
          disabled={pending || uploading}
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
              id: `${index}-${file.name}`,
              originalFilename: file.name,
              mimeType: file.type || 'application/octet-stream',
              sizeBytes: file.size,
              state: uploading ? 'pending' : 'pending',
            }))}
          />
        ) : null}
      </div>

      <div>
        <Button type="submit" disabled={pending || uploading}>
          {pending || uploading ? 'Sending reply...' : 'Send reply'}
        </Button>
      </div>
    </form>
  );
}