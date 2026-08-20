// Client-side encryption for Fresh Jots notes — format "fj1".
//
// The server encrypts/decrypts locally with a passphrase from its own
// environment (FRESHJOTS_PASSPHRASE), so the AI client works in plaintext while
// Fresh Jots only ever stores ciphertext it cannot read. Wire format:
//
//   "fj1:" + base64( salt[16] | iv[16] | ciphertext | mac[32] )
//
// PBKDF2-HMAC-SHA256 (210000 iterations) derives 64 bytes: the first 32 are the
// AES-256-CBC key, the last 32 the HMAC-SHA256 key. Encrypt-then-MAC over
// iv|ciphertext. Identical to the Fresh Jots JS, Python, Ruby, and shell
// clients — a note encrypted by any decrypts with the others. Uses only Node's
// built-in crypto.

import { pbkdf2Sync, createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const PREFIX = "fj1:";
const ITERATIONS = 210000;
const SALT_LEN = 16;
const IV_LEN = 16;
const MAC_LEN = 32;

function deriveKeys(passphrase: string, salt: Buffer): { encKey: Buffer; macKey: Buffer } {
  const dk = pbkdf2Sync(Buffer.from(passphrase, "utf8"), salt, ITERATIONS, 64, "sha256");
  return { encKey: dk.subarray(0, 32), macKey: dk.subarray(32, 64) };
}

export function isEncrypted(text: unknown): boolean {
  return typeof text === "string" && text.startsWith(PREFIX);
}

export function encrypt(plaintext: string, passphrase: string): string {
  if (!passphrase) throw new Error("encryption requires a passphrase (set FRESHJOTS_PASSPHRASE)");
  const salt = randomBytes(SALT_LEN);
  const iv = randomBytes(IV_LEN);
  const { encKey, macKey } = deriveKeys(passphrase, salt);
  const cipher = createCipheriv("aes-256-cbc", encKey, iv);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext, "utf8")), cipher.final()]);
  const mac = createHmac("sha256", macKey).update(iv).update(ciphertext).digest();
  return PREFIX + Buffer.concat([salt, iv, ciphertext, mac]).toString("base64");
}

export function decrypt(token: string, passphrase: string): string {
  if (!passphrase) throw new Error("decryption requires a passphrase (set FRESHJOTS_PASSPHRASE)");
  if (!isEncrypted(token)) throw new Error("not a Fresh Jots ciphertext (missing 'fj1:' prefix)");
  const blob = Buffer.from(token.slice(PREFIX.length), "base64");
  if (blob.length < SALT_LEN + IV_LEN + MAC_LEN + 16) throw new Error("ciphertext is truncated or corrupted");
  const salt = blob.subarray(0, SALT_LEN);
  const iv = blob.subarray(SALT_LEN, SALT_LEN + IV_LEN);
  const mac = blob.subarray(blob.length - MAC_LEN);
  const ciphertext = blob.subarray(SALT_LEN + IV_LEN, blob.length - MAC_LEN);
  const { encKey, macKey } = deriveKeys(passphrase, salt);
  const expected = createHmac("sha256", macKey).update(iv).update(ciphertext).digest();
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) {
    throw new Error("decryption failed — wrong passphrase or corrupted ciphertext");
  }
  const decipher = createDecipheriv("aes-256-cbc", encKey, iv);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("decryption failed — wrong passphrase or corrupted ciphertext");
  }
}

// Decrypt a note body line by line: fj1: lines are decrypted, any other line
// (e.g. a webhook timestamp header) passes through. Handles a whole-body
// ciphertext (one line) and an append stream (one ciphertext line per entry).
export function decryptBody(body: string, passphrase: string): string {
  return body
    .split("\n")
    .map((line) => (isEncrypted(line) ? decrypt(line, passphrase) : line))
    .join("\n");
}
