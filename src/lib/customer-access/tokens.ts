import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

/**
 * Opaque token primitives for the customer portal (Phase 9 Task 1).
 *
 * Two distinct token families share one shape:
 *
 *  - magic link  — single use, short lived, hashed on persistence;
 *  - session     — opaque, revocable, hashed on persistence.
 *
 * Only the SHA-256 digest of a token is ever written to the database. The raw
 * value exists in exactly two places: the sealed email payload handed to the
 * async email pipeline, and the customer's browser cookie.
 */

/** URL-safe, 256 bits of entropy. */
const TOKEN_BYTES = 32;

const TOKEN_ENCODING = 'base64url' as const;

const HASH_ALGORITHM = 'sha256';

const SEALED_TOKEN_VERSION = 'v1';

const SEAL_KEY_INFO = 'relaydesk:customer-access:sealed-token:v1';

/** AES-GCM nonce length. */
const SEAL_IV_BYTES = 12;

/** AES-256-GCM. */
const SEAL_CIPHER = 'aes-256-gcm';

export function generateCustomerToken(): string {
  return randomBytes(TOKEN_BYTES).toString(TOKEN_ENCODING);
}

/**
 * Stable, non-reversible digest used as the persisted lookup key for a token.
 *
 * The digest is safe to store: it cannot be reversed into the raw token, and
 * rate-limit keys are derived from it as well.
 */
export function hashCustomerToken(rawToken: string): string {
  return createHash(HASH_ALGORITHM).update(rawToken, 'utf8').digest('hex');
}

function sealKey(secret: string): Buffer {
  return Buffer.from(hkdfSync(HASH_ALGORITHM, secret, Buffer.alloc(0), SEAL_KEY_INFO, 32));
}

/**
 * Encrypts a short secret for transport through the transactional outbox.
 *
 * The outbox payload is a database row, so the raw magic-link token must not
 * be written there in plaintext. Only the async email worker can open the
 * sealed value, and it does so solely to build the sign-in link.
 */
export function sealToken(rawToken: string, secret: string): string {
  const iv = randomBytes(SEAL_IV_BYTES);
  const cipher = createCipheriv(SEAL_CIPHER, sealKey(secret), iv);

  const ciphertext = Buffer.concat([cipher.update(rawToken, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    SEALED_TOKEN_VERSION,
    iv.toString(TOKEN_ENCODING),
    tag.toString(TOKEN_ENCODING),
    ciphertext.toString(TOKEN_ENCODING),
  ].join('.');
}

export function unsealToken(sealed: string, secret: string): string {
  const parts = sealed.split('.');

  if (parts.length !== 4 || parts[0] !== SEALED_TOKEN_VERSION) {
    throw new Error('Malformed sealed token');
  }

  const decipher = createDecipheriv(SEAL_CIPHER, sealKey(secret), Buffer.from(parts[1], TOKEN_ENCODING));
  decipher.setAuthTag(Buffer.from(parts[2], TOKEN_ENCODING));

  return Buffer.concat([
    decipher.update(Buffer.from(parts[3], TOKEN_ENCODING)),
    decipher.final(),
  ]).toString('utf8');
}
