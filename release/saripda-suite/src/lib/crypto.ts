import crypto from "node:crypto";

// App-level encryption for secrets stored at rest — currently just
// EmailIntakeConfig.encryptedPassword (Section 6/10 phase 14). Section 7
// describes "an app-level encryption key (for EmailIntakeConfig's
// encrypted_password and the session/auth secret) generated on first run
// and stored in a local .env file" — read as one key serving both roles,
// so this derives a dedicated AES subkey from AUTH_SECRET (via HKDF, with
// a fixed info string for domain separation) rather than introducing a
// second generated-on-first-run secret and the .env-writing machinery that
// would require, which nothing else in this app does today (AUTH_SECRET
// itself is hand-generated once at deploy time per .env.example).

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH_BYTES = 12;

function deriveKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET must be set to encrypt or decrypt stored secrets.");
  }
  return Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), "saripda-suite:email-intake-password", 32)
  );
}

// Stored as "<iv>.<authTag>.<ciphertext>", each base64 — self-contained so
// no separate column is needed for the IV/tag.
export function encryptSecret(plainText: string): string {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, ciphertext].map((buf) => buf.toString("base64")).join(".");
}

export function decryptSecret(stored: string): string {
  const [ivB64, tagB64, dataB64] = stored.split(".");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted value.");
  }
  const key = deriveKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
