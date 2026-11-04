import { useCallback, useEffect, useState } from 'react';
import { History, Plus, RotateCcw } from 'lucide-react';
import { api } from '../../persistence/api';
import { restoreVersion, useOpenFile } from '../../persistence/serverRepository';
import { flushPendingSave } from '../../persistence/useAutosave';
import { useEditor } from '../../state/editorStore';
import { useToasts } from '../../state/toastStore';
import { inputClass, Modal, primaryButton, secondaryButton } from '../../ui/Modal';

interface Version {
  id: string;
  label: string | null;
  auto: boolean;
  createdAt: string;
  createdBy: string | null;
}

/** Version history: automatic snapshots while editing, named versions, and restore. */
export function VersionsSection() {
  const fileId = useOpenFile((s) => s.id);
  const role = useOpenFile((s) => s.role);
  const revision = useOpenFile((s) => s.revision);
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [naming, setNaming] = useState(false);
  const [confirm, setConfirm] = useState<Version | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canEdit = role === 'owner' || role === 'editor';

  const load = useCallback(async () => {
    if (!fileId) return;
    try {
      setVersions((await api<{ versions: Version[] }>('GET', `/files/${fileId}/versions`)).versions);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load versions');
    }
  }, [fileId]);

  // Refresh when opened and after saves (a save can add an automatic version).
  useEffect(() => {
    if (open) void load();
  }, [open, load, revision]);

  if (!fileId) return null;

  const restore = async (v: Version) => {
    setConfirm(null);
    try {
      const doc = await restoreVersion(fileId, v.id);
      useEditor.getState().loadDocument(doc);
      useToasts.getState().push(`Restored “${v.label ?? 'automatic version'}”. The previous state was kept as a version.`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Restore failed');
    }
  };

  return (
    <section aria-label="Version history" className="border-b border-edge py-1">
      <div className="flex items-center justify-between px-3 py-1">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex items-center gap-1.5 text-2xs font-semibold tracking-wide text-fg-muted uppercase hover:text-fg">
          <History size={12} /> Version history
        </button>
        {canEdit && (
          <button type="button" aria-label="Save version" title="Save a named version" onClick={() => setNaming(true)} className="rounded p-1 text-fg-muted hover:bg-hover hover:text-fg">
            <Plus size={14} />
          </button>
        )}
      </div>
      {open && (
        <ul className="max-h-56 overflow-y-auto pb-1">
          {error && <li role="alert" className="px-3 py-1 text-danger">{error}</li>}
          {versions.length === 0 && !error && <li className="px-3 py-1 text-fg-subtle">No versions yet. Versions are kept every 10 minutes while you edit.</li>}
          {versions.map((v) => (
            <li key={v.id} className="group flex items-center gap-2 px-3 py-1 hover:bg-hover">
              <div className="min-w-0 flex-1">
                <p className={`truncate ${v.auto ? 'text-fg-muted' : 'font-medium'}`}>{v.label ?? 'Autosave'}</p>
                <p className="truncate text-2xs text-fg-subtle">
                  {new Date(v.createdAt).toLocaleString()}
                  {v.createdBy ? ` · ${v.createdBy}` : ''}
                </p>
              </div>
              {canEdit && (
                <button type="button" aria-label={`Restore ${v.label ?? 'autosave'} from ${new Date(v.createdAt).toLocaleString()}`} title="Restore" onClick={() => setConfirm(v)} className="rounded p-1 text-fg-muted opacity-0 group-hover:opacity-100 hover:text-fg focus:opacity-100">
                  <RotateCcw size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {naming && <SaveVersionDialog fileId={fileId} onClose={() => setNaming(false)} onSaved={() => { setOpen(true); void load(); }} />}
      {confirm && (
        <Modal title="Restore version" onClose={() => setConfirm(null)}>
          <p className="text-fg-muted">
            Replace the file with “{confirm.label ?? 'Autosave'}” from {new Date(confirm.createdAt).toLocaleString()}? The current state is saved as a version first, so you can go back.
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={secondaryButton} onClick={() => setConfirm(null)}>Cancel</button>
            <button type="button" className={primaryButton} onClick={() => void restore(confirm)}>Restore</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function SaveVersionDialog({ fileId, onClose, onSaved }: { fileId: string; onClose: () => void; onSaved: () => void }) {
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Save version" onClose={onClose}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            // Save pending edits first so the version contains them.
            await flushPendingSave();
            await api('POST', `/files/${fileId}/versions`, { label: label.trim() });
            onSaved();
            onClose();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the version');
          }
        }}
      >
        <input aria-label="Version name" required maxLength={120} placeholder="e.g. Ready for review" value={label} onChange={(e) => setLabel(e.target.value)} className={inputClass} />
        {error && <p role="alert" className="text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className={secondaryButton} onClick={onClose}>Cancel</button>
          <button type="submit" className={primaryButton} disabled={!label.trim()}>Save version</button>
        </div>
      </form>
    </Modal>
  );
}
