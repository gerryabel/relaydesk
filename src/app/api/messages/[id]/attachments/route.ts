import { NextResponse } from 'next/server';
import { getCurrentMembership, ForbiddenError, UnauthorizedError } from '@/lib/workspace/server';
import { attachmentService, MessageNotFoundError, AttachmentValidationError, StorageError } from '@/lib/attachments/service';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await getCurrentMembership();
    const resolved = await params;

    const attachments = await attachmentService.getAttachmentsByMessage(resolved.id);
    return NextResponse.json(attachments);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof MessageNotFoundError) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }
    return NextResponse.json({ error: 'Failed to load attachments' }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await getCurrentMembership();
    const resolved = await params;

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return NextResponse.json({ error: 'File wajib diisi' }, { status: 400 });
    }

    const filename = file.name || 'unnamed';
    const mimeType = file.type || 'application/octet-stream';
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const attachment = await attachmentService.uploadAttachment(
      resolved.id,
      {
        filename,
        mimeType,
        sizeBytes: buffer.length,
      },
      buffer,
    );

    return NextResponse.json(attachment, { status: 201 });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof MessageNotFoundError) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }
    if (error instanceof AttachmentValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof StorageError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Failed to upload attachment' }, { status: 500 });
  }
}
