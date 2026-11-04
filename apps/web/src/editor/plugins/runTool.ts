import { create } from 'zustand';
import { BUILT_IN_TOOLS, selectionBounds, type ToolManifest } from '@canvas-studio/core';
import { useEditor } from '../../state/editorStore';
import { zoomToSelection } from '../commands';
import { rectsIntersect, visibleWorldRect } from '../placement';
import { useCustomTools } from '../../state/customToolsStore';
import { useUi } from '../../state/uiStore';
import { BUILTIN_TOOLS, type ParamValue, type ToolResult } from './builtinTools';
import { runInSandbox } from './sandbox';
import { PermissionError, ToolContext } from './toolHost';

/** Which tool dialog is open, and the player (slides / flipbook) if one is showing. */
interface ToolUiState {
  dialog: { kind: 'run'; toolId: string } | { kind: 'edit'; toolId: string | null } | null;
  player: NonNullable<ToolResult['player']> | null;
  openRun: (toolId: string) => void;
  openEditor: (toolId: string | null) => void;
  close: () => void;
  showPlayer: (player: ToolUiState['player']) => void;
}

export const useToolUi = create<ToolUiState>()((set) => ({
  dialog: null,
  player: null,
  openRun: (toolId) => set({ dialog: { kind: 'run', toolId } }),
  openEditor: (toolId) => set({ dialog: { kind: 'edit', toolId } }),
  close: () => set({ dialog: null }),
  showPlayer: (player) => set({ player }),
}));

/** Brings newly created/selected layers into view when the tool placed them off-screen. */
function revealResult() {
  const { doc, selection } = useEditor.getState();
  const bounds = selectionBounds(doc, selection);
  if (bounds && !rectsIntersect(bounds, visibleWorldRect())) zoomToSelection();
}

export function findManifest(id: string): ToolManifest | undefined {
  return BUILT_IN_TOOLS.find((t) => t.id === id) ?? useCustomTools.getState().tools.find((t) => t.manifest.id === id)?.manifest;
}

/**
 * Runs a tool: built-ins call their implementation, custom tools run in the sandbox. Both use
 * the same permission-checked context; all edits of the run are one undo step.
 */
export async function runTool(id: string, values: Record<string, ParamValue>, signal?: AbortSignal): Promise<ToolResult> {
  const manifest = findManifest(id);
  if (!manifest) throw new Error('This tool is not available.');
  if (useEditor.getState().readOnly) throw new Error('This file is view only, so tools cannot change it.');
  const ctx = new ToolContext(manifest);
  let result: ToolResult;
  try {
    if (manifest.source === 'built-in') {
      const impl = BUILTIN_TOOLS[id];
      if (!impl) throw new Error('This tool has no implementation.');
      result = await impl.run(ctx, values);
    } else {
      const custom = useCustomTools.getState().tools.find((t) => t.manifest.id === id);
      if (!custom) throw new Error('This tool was deleted.');
      await runInSandbox(custom.code, ctx, { signal });
      result = { message: ctx.createdIds.length ? `Done. Created ${ctx.createdIds.length} layer${ctx.createdIds.length === 1 ? '' : 's'}.` : 'Done.' };
    }
  } catch (error) {
    if (error instanceof PermissionError) throw new Error(`Permission denied: ${error.message}`);
    throw error;
  }
  useUi.getState().recordToolRun(id);
  revealResult();
  if (result.player) useToolUi.getState().showPlayer(result.player);
  return result;
}
