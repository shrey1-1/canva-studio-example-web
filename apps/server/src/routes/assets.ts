import { createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { HttpError, requireProject, requireUser } from '../access';
import type { Db } from '../db';

export const MAX_ASSET_BYTES = 20 * 1024 * 1024;
const MAX_SIDE = 16_384;
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const;

/** Real file type from the first bytes; the declared Content-Type must agree. SVG is never accepted. */
export function sniff(bytes: Uint8Array): (typeof IMAGE_TYPES)[number] | null {
  const at = (i: number, ...sig: number[]) => sig.every((b, k) => bytes[i + k] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  return null;
}

const shaParam = { type: 'string', pattern: '^[0-9a-f]{64}$' } as const;

export const assetRoutes: FastifyPluginAsync<{ db: Db }> = async (app, { db }) => {
  app.addContentTypeParser([...IMAGE_TYPES], { parseAs: 'buffer', bodyLimit: MAX_ASSET_BYTES }, (_req, body, done) => done(null, body));

  /** Uploads an image into a project. The id is the SHA-256 of the bytes, so uploads are idempotent. */
  app.put<{ Params: { projectId: string; sha: string }; Querystring: { width: number; height: number }; Body: Buffer }>(
    '/api/projects/:projectId/assets/:sha',
    {
      schema: {
        params: { type: 'object', required: ['projectId', 'sha'], properties: { projectId: { type: 'string', format: 'uuid' }, sha: shaParam } },
        querystring: {
          type: 'object',
          required: ['width', 'height'],
          properties: { width: { type: 'integer', minimum: 1, maximum: MAX_SIDE }, height: { type: 'integer', minimum: 1, maximum: MAX_SIDE } },
        },
      },
    },
    async (req, reply) => {
      const user = requireUser(req.user);
      await requireProject(db, user, req.params.projectId, 'editor');
      const body = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(415, 'Send the image bytes with an image Content-Type.');
      const mime = sniff(body);
      if (!mime || mime !== req.headers['content-type']) throw new HttpError(415, 'Only PNG, JPEG, GIF and WebP images are accepted.');
      if (createHash('sha256').update(body).digest('hex') !== req.params.sha) throw new HttpError(400, 'Image content does not match its id.');
      await db.query(
        `insert into assets (project_id, id, mime, size, width, height, data) values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (project_id, id) do nothing`,
        [req.params.projectId, req.params.sha, mime, body.length, req.query.width, req.query.height, body],
      );
      return reply.status(201).send({ id: req.params.sha });
    },
  );

  /** Downloads an image from any project the user belongs to. */
  app.get<{ Params: { sha: string } }>('/api/assets/:sha', { schema: { params: { type: 'object', required: ['sha'], properties: { sha: shaParam } } } }, async (req, reply) => {
    const user = requireUser(req.user);
    const { rows } = await db.query<{ mime: string; width: number; height: number; data: Uint8Array; created_at: Date }>(
      `select a.mime, a.width, a.height, a.data, a.created_at from assets a
       join project_members m on m.project_id = a.project_id and m.user_id = $2
       where a.id = $1 and ($3::uuid is null or a.project_id = $3) limit 1`,
      // A token limited to one project only sees that project's images.
      [req.params.sha, user.id, user.token?.projectId ?? null],
    );
    const asset = rows[0];
    if (!asset) throw new HttpError(404, 'Image not found.');
    return reply
      .header('Content-Type', asset.mime)
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .header('Content-Security-Policy', "default-src 'none'")
      .header('X-Image-Width', String(asset.width))
      .header('X-Image-Height', String(asset.height))
      .header('X-Created-At', new Date(asset.created_at).toISOString())
      .send(Buffer.from(asset.data));
  });
};
