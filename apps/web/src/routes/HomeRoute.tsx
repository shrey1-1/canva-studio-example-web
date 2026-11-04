import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ChevronRight, Clock, Copy, File, Folder, FolderInput, FolderPlus, LogOut, Pencil, Plus, Trash2, Upload, Users } from 'lucide-react';
import { api, ApiError } from '../persistence/api';
import { localAssetStore, setAssetProject, assetStore } from '../persistence/assetStore';
import { LocalDocumentRepository } from '../persistence/localRepository';
import type { FileMeta, Role } from '../persistence/serverRepository';
import { useAuth } from '../state/authStore';
import { inputClass, Modal, primaryButton, secondaryButton } from '../ui/Modal';

interface ProjectSummary {
  id: string;
  name: string;
  role: Role;
  fileCount: number;
}
interface FolderRow {
  id: string;
  name: string;
  parentId: string | null;
}
interface Member {
  id: string;
  email: string;
  name: string;
  role: Role;
}
interface ProjectDetail {
  project: { id: string; name: string; role: Role };
  members: Member[];
  folders: FolderRow[];
  files: FileMeta[];
}

type Dialog =
  | { kind: 'name'; title: string; initial: string; submit: (name: string) => Promise<void> }
  | { kind: 'confirm'; title: string; text: string; action: string; submit: () => Promise<void> }
  | { kind: 'move'; file: FileMeta }
  | { kind: 'share' }
  | { kind: 'account' }
  | null;

const IMPORTED_KEY = 'canvas-studio:imported';
const roleSelect = 'h-8 w-24 shrink-0 rounded border border-edge bg-app px-1.5 text-fg outline-none focus:border-accent';
const local = new LocalDocumentRepository();

function readImported(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(IMPORTED_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const timeAgo = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
};

/** File browser: recent files, projects, folders, sharing, and importing files made in this browser. */
export function HomeRoute() {
  const navigate = useNavigate();
  const user = useAuth((s) => s.user)!;
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [view, setView] = useState<'recent' | string>('recent');
  const [folderId, setFolderId] = useState<string | null>(null);
  const [recent, setRecent] = useState<FileMeta[]>([]);
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<{ id: string; name: string }[]>([]);
  const [importing, setImporting] = useState(false);

  const reload = useCallback(async () => {
    try {
      const { projects } = await api<{ projects: ProjectSummary[] }>('GET', '/projects');
      setProjects(projects);
      if (view === 'recent') setRecent((await api<{ files: FileMeta[] }>('GET', '/files/recent')).files);
      else setDetail(await api<ProjectDetail>('GET', `/projects/${view}`));
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setView('recent');
      else setError(e instanceof Error ? e.message : 'Could not load your files');
    }
  }, [view]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void local.list().then((docs) => {
      const done = new Set(readImported());
      setPendingImport(docs.filter((d) => !done.has(d.id)).map((d) => ({ id: d.id, name: d.name })));
    });
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
    await reload();
  };

  const project = view === 'recent' ? null : detail?.project.id === view ? detail : null;
  const canEdit = project ? project.project.role !== 'viewer' : true;
  const defaultProject = projects.find((p) => p.role !== 'viewer');
  const targetProject = project && canEdit ? project.project.id : defaultProject?.id;

  const newFile = async () => {
    if (!targetProject) return setError('You need a project you can edit. Create one first.');
    try {
      const { file } = await api<{ file: FileMeta }>('POST', `/projects/${targetProject}/files`, { name: 'Untitled', folderId: project ? folderId : null });
      navigate(`/file/${file.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the file');
    }
  };

  const importLocal = async () => {
    if (!targetProject) return;
    setImporting(true);
    const done = readImported();
    try {
      for (const item of pendingImport) {
        const doc = await local.load(item.id).catch(() => null);
        if (!doc) continue;
        setAssetProject(targetProject);
        for (const node of Object.values(doc.nodes)) {
          if (node.type !== 'image') continue;
          const record = await localAssetStore.get(node.assetId);
          if (record) await assetStore.put(record);
        }
        await api('POST', `/projects/${targetProject}/files`, { document: doc as unknown as Record<string, unknown> });
        done.push(item.id);
        localStorage.setItem(IMPORTED_KEY, JSON.stringify(done));
      }
      setPendingImport([]);
    } catch (e) {
      setError(e instanceof Error ? `Import stopped: ${e.message}` : 'Import failed');
      setPendingImport((p) => p.filter((x) => !done.includes(x.id)));
    } finally {
      setImporting(false);
      await reload();
    }
  };

  // Breadcrumb from the current folder up to the project.
  const crumbs = useMemo(() => {
    if (!project) return [];
    const byId = new Map(project.folders.map((f) => [f.id, f]));
    const out: FolderRow[] = [];
    for (let cur = folderId ? byId.get(folderId) : undefined; cur && out.length < 50; cur = cur.parentId ? byId.get(cur.parentId) : undefined) out.unshift(cur);
    return out;
  }, [project, folderId]);

  const files = project ? project.files.filter((f) => f.folderId === folderId) : recent;
  const folders = project ? project.folders.filter((f) => f.parentId === folderId) : [];

  return (
    <div className="page-type flex h-full flex-col bg-ground text-fg min-[761px]:flex-row">
      <aside aria-label="Projects" className="flex max-h-60 w-full shrink-0 flex-col border-b border-edge bg-sidebar min-[761px]:max-h-none min-[761px]:w-60 min-[761px]:border-r min-[761px]:border-b-0">
        <div className="flex h-16 items-center gap-2 border-b border-edge px-4">
          <span className="font-display text-[17px] font-bold">Canvas Studio</span>
        </div>
        <nav className="flex-1 overflow-y-auto p-2">
          <SideItem active={view === 'recent'} icon={<Clock size={14} />} onClick={() => { setView('recent'); setFolderId(null); }}>
            Recent
          </SideItem>
          <div className="mt-3 mb-1 flex items-center justify-between px-2 text-2xs font-semibold tracking-wide text-fg-muted uppercase">
            Projects
            <button
              type="button"
              aria-label="New project"
              className="rounded p-0.5 hover:bg-hover hover:text-fg"
              onClick={() =>
                setDialog({
                  kind: 'name',
                  title: 'New project',
                  initial: '',
                  submit: async (name) => {
                    const { project } = await api<{ project: ProjectSummary }>('POST', '/projects', { name });
                    setView(project.id);
                    setFolderId(null);
                  },
                })
              }
            >
              <Plus size={13} />
            </button>
          </div>
          {projects.map((p) => (
            <SideItem key={p.id} active={view === p.id} icon={<Folder size={14} />} onClick={() => { setView(p.id); setFolderId(null); }}>
              <span className="flex-1 truncate">{p.name}</span>
              <span className="text-2xs text-fg-subtle">{p.role === 'owner' ? '' : p.role}</span>
            </SideItem>
          ))}
        </nav>
        <div className="flex items-center gap-2 border-t border-edge px-3 py-2">
          <button type="button" aria-label={`${user.name}, account settings`} className="min-w-0 flex-1 truncate text-left hover:underline" title={user.email} onClick={() => setDialog({ kind: 'account' })}>
            {user.name}
          </button>
          <button type="button" aria-label="Log out" title="Log out" onClick={() => void useAuth.getState().logout()} className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg">
            <LogOut size={14} />
          </button>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b border-edge bg-panel px-4 py-3 min-[761px]:px-6">
          <h1 className="flex min-w-[12rem] flex-1 items-center gap-1 truncate text-[22px] font-bold max-[480px]:text-[19px]">
            {project ? (
              <>
                <button type="button" className="hover:underline" onClick={() => setFolderId(null)}>{project.project.name}</button>
                {crumbs.map((c) => (
                  <span key={c.id} className="flex items-center gap-1">
                    <ChevronRight size={13} className="text-fg-subtle" />
                    <button type="button" className="hover:underline" onClick={() => setFolderId(c.id)}>{c.name}</button>
                  </span>
                ))}
              </>
            ) : (
              'Recent files'
            )}
          </h1>
          {project && project.project.role === 'owner' && (
            <button type="button" className={`${secondaryButton} flex items-center gap-1`} onClick={() => setDialog({ kind: 'share' })}>
              <Users size={13} /> Share
            </button>
          )}
          {project && canEdit && (
            <button
              type="button"
              className={`${secondaryButton} flex items-center gap-1`}
              onClick={() =>
                setDialog({
                  kind: 'name',
                  title: 'New folder',
                  initial: '',
                  submit: async (name) => void (await api('POST', `/projects/${project.project.id}/folders`, { name, parentId: folderId })),
                })
              }
            >
              <FolderPlus size={13} /> New folder
            </button>
          )}
          <button type="button" className={`${primaryButton} flex items-center gap-1`} onClick={newFile} disabled={!canEdit}>
            <Plus size={13} /> New file
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto bg-app p-4 min-[761px]:p-6">
          {error && <p role="alert" className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-danger">{error}</p>}
          {pendingImport.length > 0 && targetProject && (
            <div className="mb-6 flex items-center gap-3 rounded-panel border border-edge bg-panel px-4 py-3 shadow-card">
              <Upload size={15} className="text-accent-fg" />
              <p className="flex-1 text-fg-muted">
                {pendingImport.length} file{pendingImport.length === 1 ? '' : 's'} from before accounts are stored in this browser only. Import them to keep them in your account.
              </p>
              <button type="button" className={primaryButton} disabled={importing} onClick={importLocal}>
                {importing ? 'Importing…' : `Import into ${projects.find((p) => p.id === targetProject)?.name ?? 'project'}`}
              </button>
            </div>
          )}
          {project && project.project.role === 'viewer' && <p className="mb-3 text-fg-muted">You can view this project. Ask an owner for edit access.</p>}

          <ul aria-label="Files" className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 min-[1050px]:gap-6">
            {folders.map((f) => (
              <li key={f.id} className="group flex items-center gap-2 rounded-panel border border-edge bg-panel p-4 shadow-card">
                <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setFolderId(f.id)}>
                  <Folder size={16} className="shrink-0 text-amber-400" />
                  <span className="truncate font-medium">{f.name}</span>
                </button>
                {canEdit && (
                  <RowActions>
                    <Action label={`Rename ${f.name}`} icon={<Pencil size={13} />} onClick={() => setDialog({ kind: 'name', title: 'Rename folder', initial: f.name, submit: async (name) => void (await api('PATCH', `/folders/${f.id}`, { name })) })} />
                    <Action
                      label={`Delete ${f.name}`}
                      icon={<Trash2 size={13} />}
                      onClick={() =>
                        setDialog({ kind: 'confirm', title: 'Delete folder', text: `Delete "${f.name}" and its sub-folders? Files inside move to the top of the project.`, action: 'Delete folder', submit: async () => void (await api('DELETE', `/folders/${f.id}`)) })
                      }
                    />
                  </RowActions>
                )}
              </li>
            ))}
            {files.map((f) => {
              const editable = project ? canEdit : f.role !== 'viewer';
              return (
                <li key={f.id} className="group flex flex-col overflow-hidden rounded-panel border border-edge bg-panel shadow-card">
                  <button type="button" aria-label={`Open ${f.name}`} onClick={() => navigate(`/file/${f.id}`)} className="flex h-28 items-center justify-center border-b border-edge bg-canvas text-fg-subtle transition-colors duration-[160ms] ease-out hover:text-accent-fg">
                    <File size={26} />
                  </button>
                  <div className="flex items-center gap-1 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{f.name}</p>
                      <p className="truncate text-2xs text-fg-subtle">
                        {f.projectName ? `${f.projectName} · ` : ''}Edited {timeAgo(f.updatedAt)}
                      </p>
                    </div>
                    {editable && (
                      <RowActions>
                        <Action label={`Rename ${f.name}`} icon={<Pencil size={13} />} onClick={() => setDialog({ kind: 'name', title: 'Rename file', initial: f.name, submit: async (name) => void (await api('PATCH', `/files/${f.id}`, { name })) })} />
                        <Action label={`Move ${f.name}`} icon={<FolderInput size={13} />} onClick={() => setDialog({ kind: 'move', file: f })} />
                        <Action label={`Duplicate ${f.name}`} icon={<Copy size={13} />} onClick={() => void run(() => api('POST', `/files/${f.id}/duplicate`))} />
                        <Action
                          label={`Delete ${f.name}`}
                          icon={<Trash2 size={13} />}
                          onClick={() => setDialog({ kind: 'confirm', title: 'Delete file', text: `Delete "${f.name}" and its version history? This cannot be undone.`, action: 'Delete file', submit: async () => void (await api('DELETE', `/files/${f.id}`)) })}
                        />
                      </RowActions>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {folders.length === 0 && files.length === 0 && <p className="mt-8 text-center text-fg-muted">{project ? 'This folder is empty.' : 'No files yet. Create one with “New file”.'}</p>}
          {project && project.project.role === 'owner' && folderId === null && (
            <div className="mt-8 flex gap-2 border-t border-edge pt-4">
              <button type="button" className={secondaryButton} onClick={() => setDialog({ kind: 'name', title: 'Rename project', initial: project.project.name, submit: async (name) => void (await api('PATCH', `/projects/${project.project.id}`, { name })) })}>
                Rename project
              </button>
              <button
                type="button"
                className={`${secondaryButton} text-danger`}
                onClick={() =>
                  setDialog({
                    kind: 'confirm',
                    title: 'Delete project',
                    text: `Delete "${project.project.name}" with all its files, versions and images, for every member? This cannot be undone.`,
                    action: 'Delete project',
                    submit: async () => {
                      await api('DELETE', `/projects/${project.project.id}`);
                      setView('recent');
                    },
                  })
                }
              >
                Delete project
              </button>
            </div>
          )}
        </div>
      </main>

      {dialog?.kind === 'name' && <NameDialog {...dialog} onClose={() => setDialog(null)} after={reload} />}
      {dialog?.kind === 'confirm' && <ConfirmDialog {...dialog} onClose={() => setDialog(null)} after={reload} />}
      {dialog?.kind === 'move' && <MoveDialog file={dialog.file} projects={projects.filter((p) => p.role !== 'viewer')} onClose={() => setDialog(null)} after={reload} />}
      {dialog?.kind === 'account' && <AccountDialog email={user.email} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'share' && project && <ShareDialog detail={project} me={user.id} onClose={() => setDialog(null)} after={reload} />}
    </div>
  );
}

function SideItem({ active, icon, onClick, children }: { active: boolean; icon: ReactNode; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-current={active ? 'page' : undefined} onClick={onClick} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left ${active ? 'bg-hover text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg'}`}>
      {icon}
      {children}
    </button>
  );
}

const RowActions = ({ children }: { children: ReactNode }) => <div className="flex shrink-0 opacity-60 group-hover:opacity-100 focus-within:opacity-100">{children}</div>;

function Action({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg">
      {icon}
    </button>
  );
}

/** Shared busy/error handling for dialogs that call the server. */
function useSubmit(onClose: () => void, after: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
      await after();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

function NameDialog({ title, initial, submit, onClose, after }: { title: string; initial: string; submit: (name: string) => Promise<void>; onClose: () => void; after: () => Promise<void> }) {
  const [name, setName] = useState(initial);
  const s = useSubmit(onClose, after);
  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) void s.submit(() => submit(name.trim())); }} className="space-y-3">
        <input aria-label="Name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        {s.error && <p role="alert" className="text-danger">{s.error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButton} onClick={onClose}>Cancel</button>
          <button type="submit" className={primaryButton} disabled={s.busy || !name.trim()}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

function ConfirmDialog({ title, text, action, submit, onClose, after }: { title: string; text: string; action: string; submit: () => Promise<void>; onClose: () => void; after: () => Promise<void> }) {
  const s = useSubmit(onClose, after);
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-fg-muted">{text}</p>
      {s.error && <p role="alert" className="mt-2 text-danger">{s.error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className={secondaryButton} onClick={onClose}>Cancel</button>
        <button type="button" className={`${primaryButton} bg-red-600 hover:bg-red-500`} disabled={s.busy} onClick={() => void s.submit(submit)}>{action}</button>
      </div>
    </Modal>
  );
}

function MoveDialog({ file, projects, onClose, after }: { file: FileMeta; projects: ProjectSummary[]; onClose: () => void; after: () => Promise<void> }) {
  const [projectId, setProjectId] = useState(file.projectId);
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [folderId, setFolderId] = useState<string>(file.folderId ?? '');
  const s = useSubmit(onClose, after);
  useEffect(() => {
    void api<ProjectDetail>('GET', `/projects/${projectId}`).then((d) => setFolders(d.folders), () => setFolders([]));
  }, [projectId]);
  return (
    <Modal title={`Move “${file.name}”`} onClose={onClose}>
      <div className="space-y-3">
        <label className="block space-y-1 text-fg-muted">
          <span>Project</span>
          <select value={projectId} onChange={(e) => { setProjectId(e.target.value); setFolderId(''); }} className={inputClass}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="block space-y-1 text-fg-muted">
          <span>Folder</span>
          <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className={inputClass}>
            <option value="">Top of project</option>
            {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
          </select>
        </label>
        {s.error && <p role="alert" className="text-danger">{s.error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButton} onClick={onClose}>Cancel</button>
          <button
            type="button"
            className={primaryButton}
            disabled={s.busy}
            onClick={() => void s.submit(async () => void (await api('PATCH', `/files/${file.id}`, { folderId: folderId || null, ...(projectId !== file.projectId ? { projectId } : {}) })))}
          >
            Move
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ShareDialog({ detail, me, onClose, after }: { detail: ProjectDetail; me: string; onClose: () => void; after: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('editor');
  const [members, setMembers] = useState(detail.members);
  const [error, setError] = useState<string | null>(null);
  const pid = detail.project.id;
  const refresh = async () => {
    setMembers((await api<ProjectDetail>('GET', `/projects/${pid}`)).members);
    await after();
  };
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      setError(null);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  };
  return (
    <Modal title={`Share “${detail.project.name}”`} onClose={onClose}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void act(async () => {
            await api('POST', `/projects/${pid}/members`, { email, role });
            setEmail('');
          });
        }}
      >
        <input aria-label="Email to invite" type="email" required placeholder="Email of an existing account" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} />
        <select aria-label="Role for invite" value={role} onChange={(e) => setRole(e.target.value as Role)} className={roleSelect}>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
          <option value="owner">Owner</option>
        </select>
        <button type="submit" className={primaryButton}>Add</button>
      </form>
      {error && <p role="alert" className="mt-2 text-danger">{error}</p>}
      <ul aria-label="Members" className="mt-4 space-y-2">
        {members.map((m) => (
          <li key={m.id} className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate">{m.name}{m.id === me ? ' (you)' : ''}</p>
              <p className="truncate text-2xs text-fg-subtle">{m.email}</p>
            </div>
            <select aria-label={`Role of ${m.name}`} value={m.role} onChange={(e) => void act(() => api('PATCH', `/projects/${pid}/members/${m.id}`, { role: e.target.value }))} className={roleSelect}>
              <option value="owner">Owner</option>
              <option value="editor">Editor</option>
              <option value="viewer">Viewer</option>
            </select>
            <button type="button" aria-label={`Remove ${m.name}`} onClick={() => void act(() => api('DELETE', `/projects/${pid}/members/${m.id}`))} className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg">
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-2xs text-fg-subtle">Viewers can open and present files. Editors can change them. Owners also manage members and can delete the project.</p>
    </Modal>
  );
}

/** Your data: download it, or delete the account. */
function AccountDialog({ email, onClose }: { email: string; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await api('DELETE', '/account', { password });
      useAuth.setState({ status: 'signed-out', user: null, error: 'Your account was deleted.' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete the account');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Account" onClose={onClose}>
      <p className="text-fg-muted">Signed in as {email}.</p>
      <h3 className="mt-4 font-semibold">Your data</h3>
      <p className="mt-1 text-fg-muted">Download your profile, projects, the files you own, your comments and access tokens as JSON.</p>
      <a href="/api/account/export" download className={`${secondaryButton} mt-2 inline-block`}>Download my data</a>
      <h3 className="mt-5 font-semibold text-danger">Delete account</h3>
      <p className="mt-1 text-fg-muted">
        Deletes your account, sign-ins and tokens, and every project only you belong to (with its files, versions and images). Projects with other owners stay with them. This cannot be undone.
      </p>
      {!confirming ? (
        <button type="button" className={`${secondaryButton} mt-2 text-danger`} onClick={() => setConfirming(true)}>Delete my account…</button>
      ) : (
        <form className="mt-2 space-y-2" onSubmit={(e) => { e.preventDefault(); void remove(); }}>
          <input aria-label="Current password" type="password" required autoComplete="current-password" placeholder="Your password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          {error && <p role="alert" className="text-danger">{error}</p>}
          <button type="submit" disabled={busy || !password} className={`${primaryButton} bg-red-600 hover:bg-red-500`}>Permanently delete account</button>
        </form>
      )}
    </Modal>
  );
}
