import { createHash } from 'node:crypto';

/**
 * Customer-facing ticket reference (Phase 9 Task 2).
 *
 * `Ticket` has no dedicated sequential public number, and adding one would
 * mean a global, concurrency-sensitive sequence plus a migration — well
 * outside Task 2 and a real source of duplicate-key bugs. The portal
 * therefore derives a short, stable reference from the existing opaque
 * ticket id instead.
 *
 * Properties this gives us:
 *
 *  - **Deterministic and stable**: the same ticket always renders the same
 *    reference, in the portal, in the API and in any future customer email.
 *  - **Non-sequential**: no ordering leaks, so a customer cannot infer how
 *    many tickets a workspace has processed.
 *  - **Fixed width and charset**: `0-9A-Z`, safe to read aloud, paste into a
 *    support conversation and put in an email subject.
 *  - **One-way**: the reference cannot be reversed into a ticket id, so it is
 *    not an additional lookup credential.
 *
 * The ticket id itself remains the route resource key
 * (`/portal/{slug}/tickets/{ticketId}`); only the *presentation* is the
 * reference.
 */

/**
 * Base-36 alphabet.
 *
 * The lookup table, not `Number.prototype.toString(36)`, because the fold
 * below needs each *digit* on its own: a `BigInt` renders in base 10, so
 * converting the remainder directly would emit `"35"` as two characters and
 * quietly produce a variable-width reference.
 */
const REFERENCE_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const REFERENCE_BASE = BigInt(REFERENCE_ALPHABET.length);

/**
 * `BigInt(36)` rather than the `36n` literal because this package compiles to
 * an ES2017 target, and BigInt *literals* are a syntax error below ES2020.
 * The `BigInt()` function has no such restriction.
 */

/** 8 base-36 characters — about 41 bits of the digest, ample for a support reference. */
const REFERENCE_LENGTH = 8;

/**
 * Derives the raw reference characters for a ticket id.
 *
 * The SHA-256 digest is read as one big integer and its **low** 8 base-36
 * digits are kept. Which end of the digest is used is arbitrary; what matters
 * is that it never changes, so a reference printed today still resolves to the
 * same ticket tomorrow.
 */
export function toTicketReferenceCode(ticketId: string): string {
  let remainder = BigInt(`0x${createHash('sha256').update(ticketId, 'utf8').digest('hex')}`);

  let code = '';

  for (let index = 0; index < REFERENCE_LENGTH; index += 1) {
    const digit = Number(remainder % REFERENCE_BASE);

    code = `${REFERENCE_ALPHABET[digit]}${code}`;
    remainder /= REFERENCE_BASE;
  }

  return code;
}

/** The display form, e.g. `AB12CD34` → `#AB12CD34`. */
export function formatTicketReference(ticketId: string): string {
  return `#${toTicketReferenceCode(ticketId)}`;
}
