// Unit tests for the client-side encryption module (compiled to dist/).
import { test } from "node:test";
import assert from "node:assert/strict";

import { encrypt, decrypt, isEncrypted, decryptBody } from "../dist/crypto.js";

// A fixed known-answer vector, embedded verbatim in the JS, Python, Ruby, and
// shell client test suites. All of them decrypting this same token to the same
// plaintext is the cross-client interoperability guarantee for the fj1 format.
const KAT_PASSPHRASE = "test-passphrase-123";
const KAT_PLAINTEXT = "Fresh Jots ✔ interop\nline two";
const KAT_TOKEN =
  "fj1:n0zMBI1YWjNr84OlkYe1UZ6NQlez9Bre77p2CJe/BgmsOPFghVmAhriP+JEw0WXn7znpaiJHZrH42EgoZSTcp9pgDySf5dciijwvUVdUouwSC6ZyDpbIelOnvE+WFiUO";

test("decrypts the shared cross-client known-answer vector", () => {
  assert.equal(decrypt(KAT_TOKEN, KAT_PASSPHRASE), KAT_PLAINTEXT);
});

test("encrypt/decrypt round-trips arbitrary UTF-8", () => {
  for (const msg of ["", "hello", "línea ñ 日本語 🔐", "a\nb\nc"]) {
    const token = encrypt(msg, "pw");
    assert.ok(isEncrypted(token));
    assert.equal(decrypt(token, "pw"), msg);
  }
});

test("output is a single line with the fj1: prefix", () => {
  const token = encrypt("multi\nline", "pw");
  assert.ok(token.startsWith("fj1:"));
  assert.equal(token.includes("\n"), false);
});

test("wrong passphrase throws", () => {
  assert.throws(() => decrypt(encrypt("secret", "right"), "wrong"), /decryption failed/);
});

test("decryptBody decrypts fj1 lines and passes others through", () => {
  const body = `── 2026-01-01 00:00 UTC ──\n${encrypt("event one", "pw")}\n${encrypt("event two", "pw")}`;
  const out = decryptBody(body, "pw").split("\n");
  assert.equal(out[0], "── 2026-01-01 00:00 UTC ──");
  assert.equal(out[1], "event one");
  assert.equal(out[2], "event two");
});
