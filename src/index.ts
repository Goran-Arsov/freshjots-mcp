#!/usr/bin/env node
// freshjots-mcp — a Model Context Protocol server for Fresh Jots.
// Exposes the Fresh Jots REST API as MCP tools so any MCP client (Claude
// Desktop, Claude Code, Cursor, …) can read and write your notes. Talks to
// the server over stdio, so stdout is the protocol channel — all human-facing
// diagnostics go to stderr.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { FreshJotsClient, FreshJotsApiError, type NoteFields } from "./client.js";

const VERSION: string = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
).version;

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

// Runs a tool body, turning a successful value into pretty JSON text and any
// thrown error into an isError result (so the model sees the failure but the
// session keeps going). API errors surface their stable `code` for branching.
async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    const data = await fn();
    const text = data === null || data === undefined ? "OK" : JSON.stringify(data, null, 2);
    return { content: [{ type: "text", text }] };
  } catch (e) {
    if (e instanceof FreshJotsApiError) {
      const detail = e.details ? `\nDetails: ${JSON.stringify(e.details)}` : "";
      return {
        content: [{ type: "text", text: `Fresh Jots API error [${e.code}] (HTTP ${e.status}): ${e.message}${detail}` }],
        isError: true,
      };
    }
    return { content: [{ type: "text", text: `Error: ${(e as Error).message}` }], isError: true };
  }
}

const token = process.env.FRESHJOTS_TOKEN ?? process.env.FRESHJOTS_API_TOKEN;
if (!token) {
  console.error(
    "freshjots-mcp: missing FRESHJOTS_TOKEN. Create an API token at " +
      "https://freshjots.com/settings/api_tokens and set FRESHJOTS_TOKEN in the server's environment.",
  );
  process.exit(1);
}

const client = new FreshJotsClient({
  token,
  baseUrl: process.env.FRESHJOTS_BASE_URL,
  userAgent: `freshjots-mcp/${VERSION}`,
});

const server = new McpServer({ name: "freshjots", version: VERSION });

// ---- Notes ----

server.registerTool(
  "list_notes",
  {
    title: "List notes",
    description:
      "List the account's notes (most-recently-updated first by default) as summaries: id, filename, title, format, timestamps, and a body excerpt. Filter by folder or format. Both plain and rich notes are listed, but only plain notes can be created or edited through this server.",
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional().describe("Max notes to return (default 50, max 200)."),
      offset: z.number().int().min(0).optional().describe("Pagination offset (default 0)."),
      format: z.enum(["plain", "rich"]).optional().describe("Filter by note format."),
      folder_id: z
        .union([z.number().int(), z.literal("none")])
        .optional()
        .describe('Folder id to filter by, or "none" for notes in no folder.'),
      sort: z.enum(["created", "updated", "appended"]).optional().describe('Sort order (default "updated").'),
    },
    annotations: { readOnlyHint: true },
  },
  async (args) => run(() => client.listNotes(args)),
);

server.registerTool(
  "read_note",
  {
    title: "Read a note",
    description:
      'Read a single note in full (including its complete plain_body) by exact filename (e.g. "ai-sessions.txt") or numeric id. Provide exactly one of filename or id.',
    inputSchema: {
      filename: z.string().optional().describe("Exact filename of the note (preferred addressing)."),
      id: z.number().int().optional().describe("Numeric note id (e.g. from list_notes)."),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ filename, id }) =>
    run(() => {
      if (filename && id != null) throw new Error("Provide only one of filename or id, not both.");
      if (filename) return client.getNoteByFilename(filename);
      if (id != null) return client.getNoteById(id);
      throw new Error("Provide a filename or an id.");
    }),
);

server.registerTool(
  "create_note",
  {
    title: "Create a note",
    description:
      "Create a new plain-text note. The server derives the filename from the title. To create a note you can address later by an exact filename of your choosing, use append_to_note instead (it creates the note on first write). Plain text only.",
    inputSchema: {
      title: z.string().min(1).describe("Title of the note. The server derives the filename from it."),
      body: z.string().optional().describe("Plain-text body of the note."),
      folder_id: z.number().int().optional().describe("Optional folder id to file the note under."),
    },
  },
  async ({ title, body, folder_id }) => run(() => client.createNote({ title, plain_body: body, folder_id })),
);

server.registerTool(
  "append_to_note",
  {
    title: "Append to a note (creates it if missing)",
    description:
      'Append text to the note with the given exact filename, creating the note if it does not exist yet (find-or-create). This is the primitive for logging: call it repeatedly to accumulate entries (AI session logs, cron output, journal lines) in one note addressed by a stable filename like "ai-sessions.txt". Plain text only.',
    inputSchema: {
      filename: z.string().min(1).describe('Exact filename to append to / create, e.g. "ai-sessions.txt".'),
      text: z.string().min(1).describe("The text to append (added as a new entry)."),
      append_only: z
        .boolean()
        .optional()
        .describe("On first-touch creation only: lock the note append-only (default true). Ignored if the note already exists."),
    },
  },
  async ({ filename, text, append_only }) => run(() => client.appendByFilename(filename, text, { append_only })),
);

server.registerTool(
  "update_note",
  {
    title: "Update a note",
    description:
      "Update a plain-text note's title, body, and/or folder, addressed by exact filename or numeric id. Only the fields you supply change; omitted fields are left untouched. Rich-format and append-only notes reject body/title edits. Provide exactly one of filename or id.",
    inputSchema: {
      filename: z.string().optional().describe("Exact filename of the note to update."),
      id: z.number().int().optional().describe("Numeric id of the note to update."),
      title: z.string().optional().describe("New title (omit to leave unchanged)."),
      body: z
        .string()
        .optional()
        .describe("New full plain-text body (replaces the existing body; omit to leave unchanged)."),
      folder_id: z
        .union([z.number().int(), z.null()])
        .optional()
        .describe("New folder id, or null to remove from its folder. Omit to leave unchanged."),
    },
  },
  async ({ filename, id, title, body, folder_id }) =>
    run(() => {
      if (filename && id != null) throw new Error("Provide only one of filename or id, not both.");
      const fields: NoteFields = {};
      if (title !== undefined) fields.title = title;
      if (body !== undefined) fields.plain_body = body;
      if (folder_id !== undefined) fields.folder_id = folder_id;
      if (Object.keys(fields).length === 0)
        throw new Error("Provide at least one field to update (title, body, or folder_id).");
      if (filename) return client.updateNoteByFilename(filename, fields);
      if (id != null) return client.updateNoteById(id, fields);
      throw new Error("Provide a filename or an id.");
    }),
);

server.registerTool(
  "delete_note",
  {
    title: "Delete a note",
    description:
      "Delete a note by its numeric id. Append-only notes cannot be deleted via the API. This cannot be undone through this server.",
    inputSchema: { id: z.number().int().describe("Numeric id of the note to delete.") },
    annotations: { destructiveHint: true },
  },
  async ({ id }) =>
    run(async () => {
      await client.deleteNote(id);
      return { deleted: true, id };
    }),
);

server.registerTool(
  "move_note",
  {
    title: "Move a note to a folder",
    description:
      "Move a note (by numeric id) into a folder, or out of any folder. Pass a folder_id to file it there, or null to un-file it.",
    inputSchema: {
      id: z.number().int().describe("Numeric id of the note to move."),
      folder_id: z
        .union([z.number().int(), z.null()])
        .describe("Target folder id, or null to remove the note from its folder."),
    },
  },
  async ({ id, folder_id }) => run(() => client.moveNote(id, folder_id)),
);

// ---- Folders ----

server.registerTool(
  "list_folders",
  {
    title: "List folders",
    description: "List all folders in the account (id, name, timestamps), ordered alphabetically.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  async () => run(() => client.listFolders()),
);

server.registerTool(
  "create_folder",
  {
    title: "Create a folder",
    description: "Create a new folder. Folder names are unique (case-insensitive) within the account.",
    inputSchema: { name: z.string().min(1).describe("Name of the new folder.") },
  },
  async ({ name }) => run(() => client.createFolder(name)),
);

server.registerTool(
  "rename_folder",
  {
    title: "Rename a folder",
    description: "Rename an existing folder, addressed by its numeric id.",
    inputSchema: {
      id: z.number().int().describe("Numeric id of the folder."),
      name: z.string().min(1).describe("New folder name."),
    },
  },
  async ({ id, name }) => run(() => client.renameFolder(id, name)),
);

server.registerTool(
  "delete_folder",
  {
    title: "Delete a folder",
    description:
      "Delete a folder by its numeric id. Notes inside it are NOT deleted — they are moved out of the folder (un-filed).",
    inputSchema: { id: z.number().int().describe("Numeric id of the folder to delete.") },
    annotations: { destructiveHint: true },
  },
  async ({ id }) =>
    run(async () => {
      await client.deleteFolder(id);
      return { deleted: true, id };
    }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`freshjots-mcp ${VERSION} ready — ${client.baseUrl}`);
