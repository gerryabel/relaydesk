/**
 * Attachment filename safety (Phase 9 Task 4).
 *
 * `Attachment.originalFilename` is customer-controlled text that ends up in two
 * places a customer can observe: the portal's attachment list, and an HTTP
 * `Content-Disposition` header. Neither is a safe sink for an arbitrary string.
 *
 * The stored file itself is never affected: `StorageProvider` keys are opaque
 * UUIDs (`attachments/<uuid>`), so a hostile filename cannot influence where a
 * file lands on disk. This module is about the *name*, not the path.
 *
 * Three classes of problem are handled:
 *
 *  1. **Path semantics.** Browsers and older clients send whatever the local
 *     filesystem called the file. `../../etc/passwd`, `C:\Users\x\a.pdf` and
 *     `a/b/c.pdf` are all "basename" values as far as the server is concerned.
 *  2. **Control and invisible characters.** CR/LF can terminate a header line
 *     and inject a second response header. Zero-width and bidi-override
 *     characters (`U+202E` reverses the visual order of what follows) make a
 *     filename *display* as something it is not, which matters here because the
 *     portal shows the name to a person deciding whether to open it.
 *  3. **Header quoting.** `"` would end the quoted-string in
 *     `Content-Disposition`, and non-ASCII bytes in a header value are not
 *     reliably transportable.
 *
 * The transformation is intentionally lossy. A name that cannot be made safe
 * becomes `attachment` rather than being rejected outright: refusing an upload
 * because of an odd character teaches a customer nothing useful, and the
 * original bytes are irrelevant since the file is stored under an opaque key.
 * It is also idempotent, so applying it on the way in (upload) and again on the
 * way out (download header, portal DTO) converges on the same value.
 */

/** Matches the `originalFilename` column bound and the existing upload schema. */
export const ATTACHMENT_FILENAME_MAX_LENGTH = 255;

/** Used when nothing safe survives sanitization. */
export const FALLBACK_ATTACHMENT_FILENAME = 'attachment';

/**
 * Characters that are either control characters (`Cc` — C0, DEL, C1) or
 * format characters (`Cf` — zero-width joiners, bidi overrides, BOM, soft
 * hyphen). Explicit ranges rather than a `u`-flagged property escape so the
 * behaviour is identical on every runtime the build targets.
 */
const INVISIBLE_CHARACTERS = /[\u0000-\u001F\u007F-\u009F\u00AD\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** Characters that are structurally unsafe in a filename on common filesystems. */
const PATH_UNSAFE = /[<>:"|?*]/g;

/** Path separators, in both POSIX and Windows form. */
const SEPARATORS = /[/\\]/;

/**
 * Normalizes a customer-supplied filename into something safe to store,
 * display and place in a header.
 *
 * Order matters:
 *
 *  1. NFKC-folds the input, so fullwidth and other compatibility forms collapse
 *     to their ASCII equivalents instead of surviving as look-alike characters.
 *  2. Reduces to a basename — the segment after the last separator, which is
 *     what removes `../` traversal semantics.
 *  3. Strips control, format and separator-adjacent characters.
 *  4. Substitutes filesystem-reserved punctuation, then trims whitespace and
 *     leading/trailing dots (which hide a file and read as traversal).
 *  5. Clamps the length while preserving the extension.
 *
 * Idempotent: `sanitize(sanitize(x)) === sanitize(x)`.
 */
export function sanitizeAttachmentFilename(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw.length === 0) {
    return FALLBACK_ATTACHMENT_FILENAME;
  }

  const folded = raw.normalize('NFKC');
  const basename = folded.split(SEPARATORS).pop() ?? '';
  const stripped = basename.replace(INVISIBLE_CHARACTERS, '').replace(PATH_UNSAFE, '_');
  const trimmed = stripped.trim().replace(/^\.+/, '').replace(/[.\s]+$/, '');

  if (trimmed.length === 0) {
    return FALLBACK_ATTACHMENT_FILENAME;
  }

  return clampFilenameLength(trimmed);
}

/**
 * Clamps to {@link ATTACHMENT_FILENAME_MAX_LENGTH}, keeping the extension.
 *
 * A truncated extension (`report.pd`) is worse than useless — it misleads the
 * customer about what they are about to open — so the extension is taken first
 * and the stem absorbs the entire reduction.
 */
function clampFilenameLength(filename: string): string {
  if (filename.length <= ATTACHMENT_FILENAME_MAX_LENGTH) {
    return filename;
  }

  const lastDot = filename.lastIndexOf('.');
  // A "dot" at position 0 was already removed as a leading dot; anything else
  // counts as an extension.
  const hasExtension = lastDot > 0 && filename.length - lastDot <= 16;
  const extension = hasExtension ? filename.slice(lastDot) : '';
  const stem = hasExtension ? filename.slice(0, lastDot) : filename;
  const stemBudget = Math.max(1, ATTACHMENT_FILENAME_MAX_LENGTH - extension.length);

  const clamped = `${stem.slice(0, stemBudget)}${extension}`;

  return clamped.replace(/[.\s]+$/, '') || FALLBACK_ATTACHMENT_FILENAME;
}

/**
 * Reduces a sanitized filename to printable ASCII for the quoted-string form of
 * `Content-Disposition`.
 *
 * Only `[A-Za-z0-9._-]` survives; everything else — including spaces, quotes
 * and backslashes — becomes `_`. The UTF-8 form in `filename*` carries the real
 * name for clients that support it, so nothing is lost for a human.
 */
function toAsciiFallbackFilename(safeFilename: string): string {
  const ascii = safeFilename.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, ATTACHMENT_FILENAME_MAX_LENGTH);

  // A leading dot would produce `.`, `..` or a hidden file if the stem vanished
  // entirely.
  const guarded = ascii.replace(/^\.+/, '');

  return guarded.length > 0 ? guarded : FALLBACK_ATTACHMENT_FILENAME;
}

/**
 * Builds an RFC 6266 / RFC 5987 `Content-Disposition` value.
 *
 * Two forms are emitted, which is what the RFC prescribes for a filename that
 * is not pure ASCII:
 *
 * ```text
 * attachment; filename="invoice_2026_01.pdf"; filename*=UTF-8''invoice%202026%2001.pdf
 * ```
 *
 * The quoted form is the sanitized ASCII fallback, so a client that ignores
 * `filename*` still gets something it can write to disk without interpreting a
 * quote or a separator. The `filename*` form carries the real name.
 *
 * Both parameters are derived from an already-sanitized value, and the
 * `filename*` value additionally percent-encodes the characters
 * `encodeURIComponent` leaves alone but RFC 5987's `attr-char` set excludes
 * (`'`, `(`, `)`, `*`). No attacker-controlled substring reaches the header
 * unescaped.
 */
export function buildAttachmentContentDisposition(rawFilename: string | null | undefined): string {
  const safe = sanitizeAttachmentFilename(rawFilename);
  const fallback = toAsciiFallbackFilename(safe);
  const encoded = encodeURIComponent(safe).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

/**
 * The neutral type substituted whenever a stored MIME type cannot be normalized.
 *
 * Lives here, next to {@link normalizeAttachmentMimeType}, rather than in the
 * customer service: this module is pure and imports nothing, so both the
 * server-only download path and the client-safe customer DTO can share one
 * definition. Two copies of the same literal would eventually disagree.
 *
 * `application/octet-stream` is inert by construction — it is not in the
 * attachment allowlist, browsers never render it inline, and it carries no
 * parameters an attacker could have smuggled through a legacy row.
 *
 * The rule it exists to enforce: **a value that failed normalization must never
 * be republished.** Falling back to the raw stored string re-introduces exactly
 * what normalization rejected.
 */
export const ATTACHMENT_FALLBACK_MIME_TYPE = 'application/octet-stream';

/**
 * Narrows a declared MIME type to its bare essence.
 *
 * `text/plain; charset=utf-8` and `TEXT/PLAIN` are the same type; comparing the
 * raw string against an allowlist would reject a perfectly ordinary browser
 * upload. A type with parameters that disagree about its own base (`text;foo`)
 * yields an empty string, which fails the allowlist rather than matching
 * something permissive.
 *
 * The result is *still only a claim by the client*. Task 4 deliberately does not
 * add content sniffing: the allowlist plus the size bound are the controls, and
 * every download is served as an `attachment` from an authorized endpoint rather
 * than executed or rendered in place.
 */
export function normalizeAttachmentMimeType(declared: string | null | undefined): string {
  if (typeof declared !== 'string') {
    return '';
  }

  const base = declared.split(';', 1)[0]?.trim().toLowerCase() ?? '';

  // Guard the shape as well as the length: `text/plain/x` would otherwise be
  // accepted as `text/plain`.
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(base)) {
    return '';
  }

  return base;
}