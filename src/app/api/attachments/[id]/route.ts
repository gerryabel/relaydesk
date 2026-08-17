import { NextResponse } from 'next/server';
import { attachmentService, AttachmentNotFoundError, StorageError } from '@/lib/attachments/service';
import { UnauthorizedError, ForbiddenError } from '@/lib/workspace/server';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const resolved = await params;
    const result = await attachmentService.downloadAttachment(resolved.id);

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        'Content-Type': result.mimeType,
        'Content-Disposition': `attachment; filename="${encodeURIComponent(result.originalFilename)}"`,
        'Cache-Control': 'private, no-cache',
      },
    });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof AttachmentNotFoundError) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }
    if (error instanceof StorageError) {
      return NextResponse.json({ error: 'File retrieval failed' }, { status: 500 });
    }
    return NextResponse.json({ error: 'Failed to download attachment' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const resolved = await params;
    await attachmentService.deleteAttachment(resolved.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof AttachmentNotFoundError) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });
    }
    if (error instanceof StorageError) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Failed to delete attachment' }, { status: 500 });
  }
}
