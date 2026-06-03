// Unit tests for the HTTP client — fetch is stubbed, so these run offline and
// in CI. The live end-to-end check against the real API lives in smoke.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";

import { FreshJotsClient, FreshJotsApiError } from "../dist/client.js";

function stubFetch(responder) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return responder({ url, init });
  };
  return calls;
}

function jsonResponse(status, body) {
  return new Response(body === undefined ? "" : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const client = () => new FreshJotsClient({ token: "mn_test", baseUrl: "https://example.test/api/v1" });

test("createNote sends Bearer auth, nests under 'note', strips undefined fields", async () => {
  const calls = stubFetch(() => jsonResponse(201, { id: 1 }));
  await client().createNote({ title: "x", plain_body: undefined, folder_id: 3 });
  const { url, init } = calls[0];
  assert.equal(url, "https://example.test/api/v1/notes");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.Authorization, "Bearer mn_test");
  assert.deepEqual(JSON.parse(init.body), { note: { title: "x", folder_id: 3 } });
});

test("listNotes builds the query string from options", async () => {
  const calls = stubFetch(() => jsonResponse(200, { notes: [] }));
  await client().listNotes({ limit: 5, folder_id: "none", sort: "created" });
  assert.equal(calls[0].url, "https://example.test/api/v1/notes?limit=5&folder_id=none&sort=created");
});

test("appendByFilename URL-encodes the filename and posts text + append_only", async () => {
  const calls = stubFetch(() => jsonResponse(201, { created: true }));
  await client().appendByFilename("a b/c.txt", "hi", { append_only: false });
  assert.equal(calls[0].url, "https://example.test/api/v1/notes/by-filename/a%20b%2Fc.txt/append");
  assert.deepEqual(JSON.parse(calls[0].init.body), { text: "hi", append_only: false });
});

test("moveNote sends folder_id: null to un-file a note", async () => {
  const calls = stubFetch(() => jsonResponse(200, { id: 1, folder_id: null }));
  await client().moveNote(1, null);
  assert.deepEqual(JSON.parse(calls[0].init.body), { folder_id: null });
});

test("a 204 No Content response resolves to null", async () => {
  stubFetch(() => new Response(null, { status: 204 }));
  assert.equal(await client().deleteNote(9), null);
});

test("an error envelope maps to FreshJotsApiError with its stable code", async () => {
  stubFetch(() => jsonResponse(404, { error: { code: "not_found", message: "nope" } }));
  await assert.rejects(
    () => client().getNoteById(7),
    (e) => e instanceof FreshJotsApiError && e.code === "not_found" && e.status === 404,
  );
});

test("a non-JSON error body still yields a FreshJotsApiError", async () => {
  stubFetch(() => new Response("<html>500</html>", { status: 500 }));
  await assert.rejects(
    () => client().listFolders(),
    (e) => e instanceof FreshJotsApiError && e.code === "unknown" && e.status === 500,
  );
});

test("can be constructed without a token — deferred auth so the server can start and introspect", () => {
  assert.doesNotThrow(() => new FreshJotsClient({ baseUrl: "https://example.test/api/v1" }));
});

test("a request without a token fails with a missing_token error and never calls fetch", async () => {
  let fetched = false;
  globalThis.fetch = async () => {
    fetched = true;
    return jsonResponse(200, {});
  };
  const tokenless = new FreshJotsClient({ baseUrl: "https://example.test/api/v1" });
  await assert.rejects(
    () => tokenless.listFolders(),
    (e) => e instanceof FreshJotsApiError && e.code === "missing_token" && e.status === 401,
  );
  assert.equal(fetched, false);
});
