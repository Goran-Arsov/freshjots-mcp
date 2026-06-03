// Minimal fetch-based client for the Fresh Jots REST API
// (https://freshjots.com/api/v1). Self-contained on purpose: the MCP server
// depends only on the MCP SDK + zod and owns its HTTP layer, so it can expose
// endpoints the published `freshjots` npm client doesn't (update, folder
// management) without coupling to that package's release cycle.

const DEFAULT_BASE_URL = "https://freshjots.com/api/v1";

export class FreshJotsApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(opts: { status: number; code: string; message: string; details?: unknown }) {
    super(opts.message);
    this.name = "FreshJotsApiError";
    this.status = opts.status;
    this.code = opts.code;
    this.details = opts.details;
  }
}

export interface NoteFields {
  title?: string | null;
  plain_body?: string;
  folder_id?: number | null;
  append_only?: boolean | null;
  append_deadline_hours?: number | null;
  alert_email?: string | null;
  webhook_url?: string | null;
  webhook_format?: string | null;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  format?: "plain" | "rich";
  folder_id?: number | "none";
  sort?: "created" | "updated" | "appended";
}

export interface ClientOptions {
  token: string;
  baseUrl?: string;
  userAgent?: string;
}

export class FreshJotsClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly userAgent: string;

  constructor({ token, baseUrl, userAgent }: ClientOptions) {
    if (!token) throw new Error("FreshJotsClient requires an API token");
    this.token = token;
    this.baseUrl = (baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.userAgent = userAgent ?? "freshjots-mcp";
  }

  private async request(method: string, path: string, body?: unknown): Promise<any> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
      "User-Agent": this.userAgent,
    };
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, init);
    } catch (e) {
      throw new FreshJotsApiError({
        status: 0,
        code: "network_error",
        message: `Could not reach Fresh Jots at ${this.baseUrl}: ${(e as Error).message}`,
      });
    }

    if (res.status === 204) return null;

    const text = await res.text();
    let json: any = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        // Non-JSON body (e.g. an HTML error page) — leave json null.
      }
    }

    if (!res.ok) {
      const err = json?.error ?? {};
      throw new FreshJotsApiError({
        status: res.status,
        code: err.code ?? "unknown",
        message: err.message ?? `HTTP ${res.status} from ${this.baseUrl}${path}`,
        details: err.details ?? err.failed,
      });
    }

    return json;
  }

  private seg(value: string): string {
    return encodeURIComponent(value);
  }

  private query(opts: ListOptions): string {
    const params = new URLSearchParams();
    if (opts.limit !== undefined) params.set("limit", String(opts.limit));
    if (opts.offset !== undefined) params.set("offset", String(opts.offset));
    if (opts.format !== undefined) params.set("format", opts.format);
    if (opts.folder_id !== undefined) params.set("folder_id", String(opts.folder_id));
    if (opts.sort !== undefined) params.set("sort", opts.sort);
    const s = params.toString();
    return s ? `?${s}` : "";
  }

  // Strip undefined keys so a PATCH only sends fields the caller set.
  private compact(fields: NoteFields): Record<string, unknown> {
    return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  }

  // --- Notes ---
  listNotes(opts: ListOptions = {}): Promise<{ notes: any[] }> {
    return this.request("GET", `/notes${this.query(opts)}`);
  }

  getNoteById(id: number): Promise<any> {
    return this.request("GET", `/notes/${id}`);
  }

  getNoteByFilename(filename: string): Promise<any> {
    return this.request("GET", `/notes/by-filename/${this.seg(filename)}`);
  }

  createNote(fields: NoteFields): Promise<any> {
    return this.request("POST", "/notes", { note: this.compact(fields) });
  }

  updateNoteById(id: number, fields: NoteFields): Promise<any> {
    return this.request("PATCH", `/notes/${id}`, { note: this.compact(fields) });
  }

  updateNoteByFilename(filename: string, fields: NoteFields): Promise<any> {
    return this.request("PATCH", `/notes/by-filename/${this.seg(filename)}`, { note: this.compact(fields) });
  }

  appendByFilename(
    filename: string,
    text: string,
    opts: { append_only?: boolean } = {},
  ): Promise<any> {
    const body: Record<string, unknown> = { text };
    if (opts.append_only !== undefined) body.append_only = opts.append_only;
    return this.request("POST", `/notes/by-filename/${this.seg(filename)}/append`, body);
  }

  deleteNote(id: number): Promise<null> {
    return this.request("DELETE", `/notes/${id}`);
  }

  moveNote(id: number, folderId: number | null): Promise<any> {
    return this.request("POST", `/notes/${id}/move`, { folder_id: folderId });
  }

  // --- Folders ---
  listFolders(): Promise<{ folders: any[] }> {
    return this.request("GET", "/folders");
  }

  createFolder(name: string): Promise<any> {
    return this.request("POST", "/folders", { folder: { name } });
  }

  renameFolder(id: number, name: string): Promise<any> {
    return this.request("PATCH", `/folders/${id}`, { folder: { name } });
  }

  deleteFolder(id: number): Promise<null> {
    return this.request("DELETE", `/folders/${id}`);
  }
}
