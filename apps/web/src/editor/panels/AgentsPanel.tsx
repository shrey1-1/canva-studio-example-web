import { useCallback, useEffect, useState } from 'react';
import { Bot, Copy, KeyRound, Trash2 } from 'lucide-react';
import { api } from '../../persistence/api';
import { PanelHeader } from './PanelHeader';

interface Token {
  id: string;
  name: string;
  scopes: 'read' | 'write';
  projectId: string | null;
  projectName: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

const field = 'h-7 w-full rounded border border-edge bg-app px-2 text-fg outline-none focus:border-accent';

function mcpConfig(token: string) {
  return JSON.stringify(
    {
      mcpServers: {
        'canvas-studio': {
          command: 'node',
          args: ['PATH/TO/canvas-studio/node_modules/tsx/dist/cli.mjs', 'PATH/TO/canvas-studio/apps/server/src/mcp.ts'],
          env: { CANVAS_STUDIO_URL: 'http://127.0.0.1:8787', CANVAS_STUDIO_TOKEN: token },
        },
      },
    },
    null,
    2,
  );
}

/** Agents workspace: access tokens for AI agents and how to connect them over MCP. */
export function AgentsPanel() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState('My agent');
  const [scopes, setScopes] = useState<'read' | 'write'>('read');
  const [projectId, setProjectId] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [t, p] = await Promise.all([api<{ tokens: Token[] }>('GET', '/tokens'), api<{ projects: { id: string; name: string }[] }>('GET', '/projects')]);
      setTokens(t.tokens);
      setProjects(p.projects);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load tokens');
    }
  }, []);
  useEffect(() => void load(), [load]);

  const create = async () => {
    try {
      const r = await api<{ secret: string }>('POST', '/tokens', { name: name.trim() || 'Agent', scopes, projectId: projectId || null });
      setSecret(r.secret);
      setCopied(false);
      setError(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the token');
    }
  };

  return (
    <>
      <PanelHeader title="Agents" />
      <div className="space-y-4 overflow-y-auto p-3">
        <p className="text-fg-muted">
          Let AI agents (any MCP client, e.g. Claude Desktop or Claude Code) read and edit your files. Each agent uses its own access token; revoke it any time.
        </p>

        <section aria-label="New access token" className="space-y-2 rounded border border-edge p-2">
          <h3 className="flex items-center gap-1.5 text-2xs font-semibold text-fg uppercase"><KeyRound size={12} /> New access token</h3>
          <input aria-label="Token name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} className={field} />
          <select aria-label="Token access" value={scopes} onChange={(e) => setScopes(e.target.value as 'read' | 'write')} className={field}>
            <option value="read">Read only (view files, comments, export)</option>
            <option value="write">Read and edit (change layers, comment)</option>
          </select>
          <select aria-label="Token project" value={projectId} onChange={(e) => setProjectId(e.target.value)} className={field}>
            <option value="">All my projects</option>
            {projects.map((p) => <option key={p.id} value={p.id}>Only “{p.name}”</option>)}
          </select>
          <button type="button" onClick={create} className="h-7 w-full rounded bg-accent font-medium text-white hover:bg-accent-hover">Create token</button>
          <p className="text-2xs text-fg-subtle">Tokens can never change your account, other tokens, sharing, or delete projects.</p>
        </section>

        {secret && (
          <section aria-label="New token" className="space-y-2 rounded border border-accent/60 bg-accent/10 p-2">
            <p className="font-medium text-fg">Copy this token now — it will not be shown again.</p>
            <div className="flex gap-1">
              <code data-testid="new-token" className="min-w-0 flex-1 truncate rounded bg-app px-2 py-1 font-mono text-2xs">{secret}</code>
              <button
                type="button"
                aria-label="Copy token"
                onClick={() => void navigator.clipboard.writeText(secret).then(() => setCopied(true), () => setCopied(false))}
                className="rounded border border-edge p-1 hover:bg-hover"
              >
                <Copy size={13} />
              </button>
            </div>
            {copied && <p role="status" className="text-2xs text-fg-subtle">Copied.</p>}
            <p className="text-2xs text-fg-muted">MCP client configuration (replace PATH/TO/canvas-studio with this project’s folder; the API server must be running):</p>
            <pre className="max-h-48 overflow-auto rounded bg-app p-2 font-mono text-[10px] leading-snug text-fg">{mcpConfig(secret)}</pre>
            <button type="button" onClick={() => setSecret(null)} className="text-2xs text-accent-fg hover:underline">I’ve saved it</button>
          </section>
        )}

        {error && <p role="alert" className="text-danger">{error}</p>}

        <section aria-label="Access tokens">
          <h3 className="mb-1 text-2xs font-semibold text-fg-muted uppercase">Active tokens</h3>
          {tokens.length === 0 && <p className="text-fg-subtle">No agents connected yet.</p>}
          <ul className="space-y-1">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-2 rounded px-1 py-1 hover:bg-hover">
                <Bot size={14} className="shrink-0 text-fg-muted" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-fg">{t.name}</p>
                  <p className="truncate text-2xs text-fg-subtle">
                    {t.scopes === 'write' ? 'Read & edit' : 'Read only'} · {t.projectName ?? 'All projects'} · {t.lastUsedAt ? `used ${new Date(t.lastUsedAt).toLocaleString()}` : 'never used'}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Revoke ${t.name}`}
                  title="Revoke"
                  onClick={() => void api('DELETE', `/tokens/${t.id}`).then(load, (e: unknown) => setError(e instanceof Error ? e.message : 'Could not revoke'))}
                  className="rounded p-1 text-fg-muted hover:text-fg"
                >
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section aria-label="Agent tools" className="text-2xs text-fg-muted">
          <h3 className="mb-1 font-semibold text-fg-muted uppercase">What agents can do</h3>
          <p>list_projects, list_files, get_file_outline, get_nodes, create_nodes, update_nodes, delete_nodes, export_svg, list_comments, add_comment. Edits appear live for everyone with the file open, and each one can be found in version history.</p>
        </section>
      </div>
    </>
  );
}
