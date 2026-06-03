# freshjots-mcp

A [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server for [Fresh Jots](https://freshjots.com). It exposes your Fresh Jots notes as MCP tools, so any MCP client — Claude Desktop, Claude Code, Cursor, and others — can read and write them directly. Point your AI agent's output at a Fresh Jots note, log your coding sessions, or let an assistant search and update your notebook, all through the API.

MCP is an open standard for connecting AI assistants to external tools and data — think of it as a universal adapter, so one integration works across every compatible client.

## What you can do

The server talks to the [Fresh Jots REST API](https://freshjots.com/docs) over a bearer token and exposes these tools:

**Notes** — `list_notes`, `read_note`, `create_note`, `append_to_note`, `update_note`, `delete_note`, `move_note`

**Folders** — `list_folders`, `create_folder`, `rename_folder`, `delete_folder`

The standout is **`append_to_note`**: it appends to a note addressed by an exact filename (e.g. `ai-sessions.txt`) and creates the note on first write. Call it repeatedly to accumulate a log — AI session transcripts, cron output, a running journal — in one place.

Notes are **plain text** through the API: rich (Trix) notes can be listed and read, but only plain notes can be created or edited here.

## Requirements

- Node.js 18 or newer
- A Fresh Jots API token (Pro or Team plan). Create one at <https://freshjots.com/settings/api_tokens>. Tokens look like `mn_…`.

## Install

Until this is published to npm, build it from source:

```bash
git clone https://github.com/Goran-Arsov/freshjots-mcp.git
cd freshjots-mcp
npm install        # also builds via the prepare script
npm run build      # or build explicitly
```

The runnable server is then `dist/index.js`.

## Configuration

The server reads its token from the environment:

- `FRESHJOTS_TOKEN` (required) — your `mn_…` API token. `FRESHJOTS_API_TOKEN` is also accepted.
- `FRESHJOTS_BASE_URL` (optional) — defaults to `https://freshjots.com/api/v1`. Override for a self-hosted or staging instance.

### Claude Desktop

Add to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "freshjots": {
      "command": "node",
      "args": ["/absolute/path/to/freshjots-mcp/dist/index.js"],
      "env": { "FRESHJOTS_TOKEN": "mn_your_token_here" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add freshjots --scope user \
  -e FRESHJOTS_TOKEN='${FRESHJOTS_TOKEN}' \
  -- node /absolute/path/to/freshjots-mcp/dist/index.js
```

Using `'${FRESHJOTS_TOKEN}'` (single-quoted) stores the *reference*, not the secret — Claude Code expands it from your shell environment at launch, so keep `export FRESHJOTS_TOKEN=mn_…` in your shell profile. Or pass the literal token with `-e FRESHJOTS_TOKEN=mn_…` if you prefer it in the config.

### Cursor

Add to `~/.cursor/mcp.json` (or a project `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "freshjots": {
      "command": "node",
      "args": ["/absolute/path/to/freshjots-mcp/dist/index.js"],
      "env": { "FRESHJOTS_TOKEN": "mn_your_token_here" }
    }
  }
}
```

Once published to npm, `command: "npx"`, `args: ["-y", "freshjots-mcp"]` will replace the local path in any of the above.

## Development

```bash
npm run build   # compile TypeScript to dist/
npm test        # unit tests (fetch stubbed; no network)
node smoke.mjs  # live end-to-end test against the real API — needs FRESHJOTS_TOKEN;
                # creates only clearly-marked [mcp-test] notes/folders and deletes them
```

## License

MIT © Goran Arsov
