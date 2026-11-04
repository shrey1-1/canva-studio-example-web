import { Plus, Trash } from 'lucide-react';
import { addPage, deletePage, renameDocument, renamePage } from '@canvas-studio/core';
import { useEditor } from '../../state/editorStore';
import { IconButton } from '../../ui/IconButton';
import { InlineEdit } from '../../ui/InlineEdit';
import { PanelHeader } from './UpcomingPanel';
import { LayersSection } from './LayersSection';

export function FilePanel() {
  const docName = useEditor((s) => s.doc.name);
  const dispatch = useEditor((s) => s.dispatch);

  return (
    <>
      <PanelHeader title="File" />
      <div className="flex items-center border-b border-edge px-3 py-2">
        <InlineEdit
          label="File name"
          value={docName}
          className="text-[13px] font-medium"
          onCommit={(name) => dispatch('Rename file', (d) => renameDocument(d, name))}
        />
      </div>
      <PagesSection />
      <LayersSection />
    </>
  );
}

function PagesSection() {
  const pages = useEditor((s) => s.doc.pages);
  const activePageId = useEditor((s) => s.activePageId);
  const dispatch = useEditor((s) => s.dispatch);
  const setActivePage = useEditor((s) => s.setActivePage);

  const onAdd = () => {
    let newId = '';
    dispatch('Add page', (d) => {
      newId = addPage(d).id;
    });
    if (newId) setActivePage(newId);
  };

  return (
    <section aria-label="Pages" className="border-b border-edge py-1">
      <div className="flex items-center justify-between px-3 py-1">
        <h3 className="text-2xs font-semibold uppercase tracking-wide text-fg-muted">Pages</h3>
        <IconButton label="Add page" onClick={onAdd}>
          <Plus size={14} />
        </IconButton>
      </div>
      <ul className="max-h-40 overflow-y-auto">
        {pages.map((page) => {
          const active = page.id === activePageId;
          return (
            <li key={page.id}>
              <div
                role="button"
                tabIndex={0}
                aria-current={active ? 'page' : undefined}
                onClick={() => setActivePage(page.id)}
                onKeyDown={(e) => e.key === 'Enter' && setActivePage(page.id)}
                className={`group flex h-7 cursor-default items-center gap-2 px-3 ${
                  active ? 'bg-hover font-medium text-fg' : 'text-fg-muted hover:bg-hover/60'
                }`}
              >
                <InlineEdit
                  label="Page name"
                  value={page.name}
                  onCommit={(name) => dispatch('Rename page', (d) => renamePage(d, page.id, name))}
                />
                {pages.length > 1 && (
                  <IconButton
                    label={`Delete ${page.name}`}
                    className="h-6 w-6 opacity-0 group-hover:opacity-100 focus:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      dispatch('Delete page', (d) => deletePage(d, page.id));
                    }}
                  >
                    <Trash size={13} />
                  </IconButton>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
