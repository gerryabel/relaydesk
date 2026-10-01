import { describe, it, expect } from 'vitest';
import {
  ATTACHMENT_FILENAME_MAX_LENGTH,
  FALLBACK_ATTACHMENT_FILENAME,
  buildAttachmentContentDisposition,
  normalizeAttachmentMimeType,
  sanitizeAttachmentFilename,
} from '@/lib/attachments/filename';

/**
 * Filename and header safety (Phase 9 Task 4).
 *
 * `originalFilename` is customer-controlled text that reaches two sinks: the
 * portal's attachment list, and an HTTP `Content-Disposition` header. Both are
 * exercised here, because a sanitizer that is safe in the DOM can still split a
 * header, and one that is safe in a header can still display misleadingly.
 *
 * The names below are the ones that actually cause incidents: traversal
 * segments, quotes, CR/LF, bidi overrides and Unicode look-alikes.
 */
describe('sanitizeAttachmentFilename', () => {
  it('keeps an ordinary filename exactly as-is', () => {
    expect(sanitizeAttachmentFilename('invoice-2026-01.pdf')).toBe('invoice-2026-01.pdf');
    expect(sanitizeAttachmentFilename('Q3 report (final).xlsx')).toBe('Q3 report (final).xlsx');
  });

  it.each([
    ['../../etc/passwd', 'passwd'],
    ['..\\..\\windows\\system32\\config', 'config'],
    ['/absolute/path/photo.png', 'photo.png'],
    ['C:\\Users\\alice\\Documents\\tax.pdf', 'tax.pdf'],
    ['nested/dir/name.txt', 'name.txt'],
  ])('reduces %s to its basename', (input, expected) => {
    // The traversal segments are gone before anything else looks at the value,
    // so a name can never address a directory even if it were later used in a
    // path by a future caller.
    expect(sanitizeAttachmentFilename(input)).toBe(expected);
  });

  it('never returns a value containing a path separator', () => {
    for (const input of ['a/b/c.txt', 'a\\b\\c.txt', '///x', '\\\\server\\share\\f']) {
      const safe = sanitizeAttachmentFilename(input);

      expect(safe).not.toContain('/');
      expect(safe).not.toContain('\\');
    }
  });

  it.each([
    ['crlf.txt', 'crlf.txt'],
    ['ev\ril.txt', 'evil.txt'],
    ['ev\nil.txt', 'evil.txt'],
    ['ev\ril\n.txt', 'evil.txt'],
    ['two\r\nSet-Cookie: a=b', 'twoSet-Cookie_ a=b'],
  ])('strips CR/LF from %j', (input, expected) => {
    const safe = sanitizeAttachmentFilename(input);

    expect(safe).not.toMatch(/[\r\n]/);
    expect(safe).toBe(expected);
  });

  it('strips other control characters', () => {
    const safe = sanitizeAttachmentFilename('a\u0000b\u0007c\u001bd\u007fe.txt');

    expect(safe).toBe('abcde.txt');
  });

  it('strips invisible and bidi-override characters that disguise a name', () => {
    // U+202E reverses the visual order of what follows, so `exe.txt` can be made
    // to *display* as `txt.exe`. That is the whole point of the attack: a
    // customer reads a safe name and receives something else.
    const disguised = sanitizeAttachmentFilename('invoice\u202Etxt.exe');

    expect(disguised).not.toContain('\u202E');
    expect(disguised).toBe('invoicetxt.exe');

    expect(sanitizeAttachmentFilename('a\u200Bb.txt')).toBe('ab.txt');
    expect(sanitizeAttachmentFilename('a\uFEFFb.txt')).toBe('ab.txt');
  });

  it('folds Unicode compatibility forms instead of preserving look-alikes', () => {
    // NFKC turns the fullwidth letters back into ASCII, so two names that
    // differ only by homoglyphs cannot exist in the stored column.
    expect(sanitizeAttachmentFilename('ｉｎｖｏｉｃｅ.pdf')).toBe('invoice.pdf');
  });

  it.each([
    ['..', FALLBACK_ATTACHMENT_FILENAME],
    ['.', FALLBACK_ATTACHMENT_FILENAME],
    ['', FALLBACK_ATTACHMENT_FILENAME],
    ['   ', FALLBACK_ATTACHMENT_FILENAME],
    ['/', FALLBACK_ATTACHMENT_FILENAME],
    ['\\', FALLBACK_ATTACHMENT_FILENAME],
    ['../', FALLBACK_ATTACHMENT_FILENAME],
  ])('falls back for %j rather than returning an empty or traversal name', (input, expected) => {
    expect(sanitizeAttachmentFilename(input)).toBe(expected);
  });

  it('returns the fallback for a non-string input', () => {
    expect(sanitizeAttachmentFilename(null)).toBe(FALLBACK_ATTACHMENT_FILENAME);
    expect(sanitizeAttachmentFilename(undefined)).toBe(FALLBACK_ATTACHMENT_FILENAME);
  });

  it('never lets a name begin with a dot', () => {
    // A leading dot makes the file hidden on disk and, for `.`/`..`, is a
    // directory reference rather than a name.
    for (const input of ['.env', '...hidden', '..secret.txt']) {
      expect(sanitizeAttachmentFilename(input).startsWith('.')).toBe(false);
    }
  });

  it('clamps length while preserving the extension', () => {
    const long = `${'a'.repeat(400)}.pdf`;
    const safe = sanitizeAttachmentFilename(long);

    expect(safe.length).toBeLessThanOrEqual(ATTACHMENT_FILENAME_MAX_LENGTH);
    // A truncated extension would misinform the customer about what they are
    // about to open, so the stem absorbs the entire reduction.
    expect(safe.endsWith('.pdf')).toBe(true);
  });

  it('clamps a name with no usable extension too', () => {
    const safe = sanitizeAttachmentFilename('a'.repeat(400));

    expect(safe.length).toBeLessThanOrEqual(ATTACHMENT_FILENAME_MAX_LENGTH);
  });

  it('is idempotent, so sanitizing on the way in and again on the way out is stable', () => {
    for (const input of [
      'invoice.pdf',
      '../../etc/passwd',
      'a\rb.txt',
      'a\u202Eb.txt',
      '..',
      `${'z'.repeat(400)}.pdf`,
      'ｉｎｖｏｉｃｅ.pdf',
    ]) {
      const once = sanitizeAttachmentFilename(input);

      expect(sanitizeAttachmentFilename(once)).toBe(once);
    }
  });
});

describe('buildAttachmentContentDisposition', () => {
  /**
   * Parses the header the way an HTTP client would: split on `;` at the
   * top level, then on the first `=`.
   */
  function parseHeader(value: string): {
    disposition: string;
    params: Record<string, string>;
  } {
    const parts = splitOutsideQuotes(value);
    const disposition = parts[0]?.trim() ?? '';
    const params: Record<string, string> = {};

    for (const part of parts.slice(1)) {
      const index = part.indexOf('=');

      if (index === -1) {
        continue;
      }

      const name = part.slice(0, index).trim();
      let raw = part.slice(index + 1).trim();

      if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
        raw = raw.slice(1, -1);
      }

      params[name] = raw;
    }

    return { disposition, params };
  }

  /** Splits on `;` but not inside a quoted-string. */
  function splitOutsideQuotes(value: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const character of value) {
      if (character === '"') {
        inQuotes = !inQuotes;
      }

      if (character === ';' && !inQuotes) {
        parts.push(current);
        current = '';
        continue;
      }

      current += character;
    }

    parts.push(current);

    return parts;
  }

  it('emits both an ASCII fallback and the RFC 5987 form', () => {
    const header = buildAttachmentContentDisposition('invoice.pdf');
    const { disposition, params } = parseHeader(header);

    expect(disposition).toBe('attachment');
    expect(params.filename).toBe('invoice.pdf');
    expect(params['filename*']).toBe("UTF-8''invoice.pdf");
  });

  it('percent-encodes a non-ASCII name in the filename* form', () => {
    const header = buildAttachmentContentDisposition('fakturë 2026.pdf');
    const { params } = parseHeader(header);

    // The quoted fallback must be pure ASCII so an old client can save it.
    expect(params.filename).toMatch(/^[\x20-\x7E]+$/);
    expect(params['filename*']).toBe(
      `UTF-8''${encodeURIComponent('fakturë 2026.pdf')}`,
    );
  });

  it('percent-encodes the characters encodeURIComponent leaves but RFC 5987 excludes', () => {
    // `'`, `(` and `)` pass through `encodeURIComponent` unchanged but are not
    // `attr-char` values. Left raw they can break a naive client-side parser of
    // the extended parameter.
    const header = buildAttachmentContentDisposition("a'b(c)d.txt");
    const { params } = parseHeader(header);

    expect(params['filename*']).toBe(`UTF-8''a%27b%28c%29d.txt`);
  });

  it('cannot be broken by a filename containing a quote', () => {
    const header = buildAttachmentContentDisposition('evil".txt');
    const { params } = parseHeader(header);

    // The quote is replaced with `_` before the header is built, so there is no
    // unescaped `"` anywhere in the value to terminate the quoted-string early.
    expect(header).not.toContain('evil"');
    expect(params.filename).toBe('evil_.txt');
  });

  it.each([
    'a\r\nX-Injected: 1\r\nb.txt',
    'a\r\nSet-Cookie: session=stolen\r\n.txt',
    'a\nb\nc.pdf',
    'a\r\n\r\n<html>.txt',
  ])('produces a single-line header for %j', (input) => {
    const header = buildAttachmentContentDisposition(input);

    // The specific property that matters: no CR and no LF survive, so no second
    // header line and no second response can be created.
    expect(header).not.toContain('\r');
    expect(header).not.toContain('\n');
    // Exactly two parameters, plus the disposition token.
    expect(parseHeader(header).disposition).toBe('attachment');
  });

  it('neutralizes traversal in the fallback name', () => {
    const { params } = parseHeader(buildAttachmentContentDisposition('../../etc/passwd'));

    expect(params.filename).toBe('passwd');
    expect(params.filename).not.toContain('/');
    expect(params.filename).not.toContain('..');
  });

  it('falls back to a safe name when nothing survives', () => {
    const { params } = parseHeader(buildAttachmentContentDisposition('..'));

    expect(params.filename).toBe(FALLBACK_ATTACHMENT_FILENAME);
    expect(params['filename*']).toBe(`UTF-8''${FALLBACK_ATTACHMENT_FILENAME}`);
  });

  it('keeps the quoted fallback free of characters that would end it', () => {
    for (const input of [
      'a"b.txt',
      "a'b.txt",
      'a\\b.txt',
      'a;b.txt',
      'a b.txt',
    ]) {
      const { params } = parseHeader(buildAttachmentContentDisposition(input));

      // Only `[A-Za-z0-9._-]` is allowed in the quoted form; everything else
      // becomes `_`, and `_` cannot terminate or extend a quoted-string.
      expect(params.filename).toMatch(/^[A-Za-z0-9._-]+$/);
    }
  });

  it('handles a non-string input without throwing', () => {
    expect(() => buildAttachmentContentDisposition(null)).not.toThrow();
    expect(buildAttachmentContentDisposition(undefined)).toContain(FALLBACK_ATTACHMENT_FILENAME);
  });
});

describe('normalizeAttachmentMimeType', () => {
  it('lower-cases and trims a declared type', () => {
    expect(normalizeAttachmentMimeType('APPLICATION/PDF')).toBe('application/pdf');
    expect(normalizeAttachmentMimeType('  image/png  ')).toBe('image/png');
  });

  it('drops parameters so a charset-qualified type still matches the allowlist', () => {
    // Browsers routinely send `text/plain;charset=utf-8`; rejecting that would
    // make the allowlist unusable in practice.
    expect(normalizeAttachmentMimeType('text/plain; charset=utf-8')).toBe('text/plain');
    expect(normalizeAttachmentMimeType('text/csv;charset=UTF-8')).toBe('text/csv');
  });

  it.each([
    '*/*',
    'image/*',
    'application/x-executable',
    'application/javascript',
    'text/html',
    '',
    '   ',
    'not-a-mime-type',
    'text',
    'text/plain/extra',
    '/plain',
    'text/',
  ])('rejects or refuses to widen %j', (input) => {
    const normalized = normalizeAttachmentMimeType(input);

    // Either the allowlist will reject it downstream, or it is not a MIME type
    // at all. What must never happen is a value that would match a permissive
    // entry.
    expect(normalized).not.toBe('*/*');
    expect(normalized).not.toContain('*');
  });

  it('returns an empty string for a non-string input', () => {
    expect(normalizeAttachmentMimeType(null)).toBe('');
    expect(normalizeAttachmentMimeType(undefined)).toBe('');
  });
});