// Manual live smoke test: spawns the built server over stdio (as a real MCP
// client would) and exercises every tool against the live API, creating only
// clearly-marked [mcp-test] artifacts and deleting them in a finally block.
// Requires FRESHJOTS_TOKEN in the environment. Not part of `npm test`.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER = new URL("./dist/index.js", import.meta.url).pathname;
const ts = new Date().toISOString().replace(/[:.]/g, "-");

const transport = new StdioClientTransport({
  command: "node",
  args: [SERVER],
  env: { ...process.env },
  stderr: "inherit",
});
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(transport);

let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
};

async function call(name, args = {}) {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content?.[0]?.text ?? "";
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON */
  }
  return { isError: !!r.isError, text, json };
}

const created = { noteIds: [], folderIds: [] };
try {
  const tools = await client.listTools();
  check("lists 11 tools", tools.tools.length === 11, tools.tools.map((t) => t.name).join(","));

  check("list_folders read", !(await call("list_folders")).isError);
  check("list_notes read", !(await call("list_notes", { limit: 1 })).isError);

  const cf = await call("create_folder", { name: `[mcp-test ${ts}]` });
  check("create_folder", !cf.isError && !!cf.json?.id, cf.text.slice(0, 120));
  if (cf.json?.id) created.folderIds.push(cf.json.id);

  const rf = await call("rename_folder", { id: cf.json?.id, name: `[mcp-test ${ts} renamed]` });
  check("rename_folder", !rf.isError && /renamed/.test(rf.json?.name || ""));

  const cn = await call("create_note", { title: `[mcp-test ${ts}]`, body: "hello from smoke test" });
  check("create_note", !cn.isError && !!cn.json?.id, cn.text.slice(0, 120));
  if (cn.json?.id) created.noteIds.push(cn.json.id);

  const rn = await call("read_note", { id: cn.json?.id });
  check("read_note by id returns body", !rn.isError && /hello from smoke/.test(rn.json?.plain_body || ""));

  const un = await call("update_note", { id: cn.json?.id, body: "updated body" });
  check("update_note", !un.isError);
  check("update_note persisted", (await call("read_note", { id: cn.json?.id })).json?.plain_body === "updated body");

  const mv = await call("move_note", { id: cn.json?.id, folder_id: cf.json?.id });
  check("move_note into folder", !mv.isError && mv.json?.folder_id === cf.json?.id);

  const ap = await call("append_to_note", { filename: `mcp-test-stream-${ts}.txt`, text: "line 1", append_only: false });
  check("append_to_note creates stream", !ap.isError && ap.json?.created === true, ap.text.slice(0, 120));
  if (ap.json?.id) created.noteIds.push(ap.json.id);

  const ap2 = await call("append_to_note", { filename: `mcp-test-stream-${ts}.txt`, text: "line 2", append_only: false });
  check("append_to_note appends to existing", !ap2.isError && ap2.json?.created === false);

  const err = await call("read_note", { filename: `definitely-missing-${ts}.txt` });
  check("read_note missing surfaces not_found isError", err.isError && /not_found/.test(err.text), err.text.slice(0, 80));
} finally {
  for (const id of created.noteIds) {
    const d = await call("delete_note", { id });
    console.log(`cleanup delete_note ${id}: ${d.isError ? "ERR " + d.text.slice(0, 80) : "ok"}`);
  }
  for (const id of created.folderIds) {
    const d = await call("delete_folder", { id });
    console.log(`cleanup delete_folder ${id}: ${d.isError ? "ERR " + d.text.slice(0, 80) : "ok"}`);
  }
  await client.close();
}

console.log(failures === 0 ? "\nALL SMOKE CHECKS PASSED" : `\n${failures} SMOKE CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
