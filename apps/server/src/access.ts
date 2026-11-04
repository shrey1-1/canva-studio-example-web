import type { Queryable } from './db';
import type { SessionUser } from './auth';

export type Role = 'owner' | 'editor' | 'viewer';
export const ROLES: readonly Role[] = ['owner', 'editor', 'viewer'];
const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

export class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly details?: Record<string, unknown>) {
    super(message);
  }
}

export function requireUser(user: SessionUser | null): SessionUser {
  if (!user) throw new HttpError(401, 'Sign in to continue.');
  return user;
}

/**
 * The caller's role in a project, enforcing a minimum. Non-members get 404 (not 403), so ids of
 * other people's projects cannot be probed.
 */
export async function requireProject(db: Queryable, user: SessionUser, projectId: string, min: Role): Promise<Role> {
  // A token limited to one project cannot see any other.
  if (user.token?.projectId && user.token.projectId !== projectId) throw new HttpError(404, 'Project not found.');
  const { rows } = await db.query<{ role: Role }>('select role from project_members where project_id = $1 and user_id = $2', [projectId, user.id]);
  const role = rows[0]?.role;
  if (!role) throw new HttpError(404, 'Project not found.');
  if (RANK[role] < RANK[min]) throw new HttpError(403, min === 'owner' ? 'Only the project owner can do this.' : 'You can only view this project.');
  return role;
}

export async function requireFile(db: Queryable, user: SessionUser, fileId: string, min: Role): Promise<{ projectId: string; role: Role }> {
  const { rows } = await db.query<{ project_id: string }>('select project_id from files where id = $1', [fileId]);
  const projectId = rows[0]?.project_id;
  if (!projectId) throw new HttpError(404, 'File not found.');
  try {
    return { projectId, role: await requireProject(db, user, projectId, min) };
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) throw new HttpError(404, 'File not found.');
    throw error;
  }
}

export async function requireFolder(db: Queryable, user: SessionUser, folderId: string, min: Role): Promise<{ projectId: string; parentId: string | null }> {
  const { rows } = await db.query<{ project_id: string; parent_id: string | null }>('select project_id, parent_id from folders where id = $1', [folderId]);
  const folder = rows[0];
  if (!folder) throw new HttpError(404, 'Folder not found.');
  await requireProject(db, user, folder.project_id, min);
  return { projectId: folder.project_id, parentId: folder.parent_id };
}
