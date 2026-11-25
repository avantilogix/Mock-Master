import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants, copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fail, pageCount, renderPage } from './documents.js';

const videoTypes = new Set(['video/mp4', 'video/webm', 'video/quicktime']);
const limits = { pdf: 12 * 1024 * 1024, video: 300 * 1024 * 1024 };

export function currentAffairs(api, { db, directory, text, processDocument, looksLikeVideo }) {
  const one = (sql, ...args) => db.prepare(sql).get(...args);
  const filePath = (id, kind) => join(directory, id, kind);
  const mediaPath = (id, kind, item) => filePath(id, item?.file || kind);
  const removeFile = (id, name) => {
    rmSync(filePath(id, name), { force: true });
    const dir = join(directory, id);
    if (existsSync(dir) && !readdirSync(dir).length) rmdirSync(dir);
  };
  const secret = randomBytes(32);
  const signature = (id, uid, expires, download) => createHmac('sha256', secret)
    .update(`${id}|${uid}|${expires}|${download}`).digest('base64url');
  const resource = id => {
    const item = one("SELECT * FROM resources WHERE id=? AND kind IN ('current-affairs','pyqs','syllabus')", id);
    if (!item) fail(404, 'Learning resource not found.');
    return item;
  };
  const publicResource = item => ({
    id: item.id, kind: item.kind, title: item.title, summary: item.summary, body: item.body,
    createdAt: item.created_at, publishedAt: item.published_at, downloadsEnabled: Boolean(item.downloads_enabled),
    media: JSON.parse(item.media),
  });
  const checkDraft = (id, uid) => {
    if (typeof id !== 'string' || !id) fail(422, 'Choose files to upload.');
    const draft = one('SELECT * FROM resource_uploads WHERE id=? AND uid=?', id, uid);
    if (!draft) fail(404, 'Resource upload not found.');
    if (draft.expires < Date.now()) fail(410, 'This upload expired. Choose the files and upload again.');
    return draft;
  };
  api.get('/resource-files/:id', (req, res) => {
    const { uid, expires, download, token } = req.query;
    if (![uid, expires, download, token].every(value => typeof value === 'string')) fail(403, 'Invalid video link.');
    const expected = Buffer.from(signature(req.params.id, uid, expires, download));
    const given = Buffer.from(token);
    if (given.length !== expected.length || !timingSafeEqual(expected, given) || Number(expires) < Date.now()) {
      fail(403, 'This video link expired or is invalid. Open the resource again.');
    }
    const student = one('SELECT disabled FROM students WHERE uid=?', uid);
    if (!student || student.disabled) fail(403, 'Sign in with an active account.');
    const item = resource(req.params.id);
    const video = JSON.parse(item.media).video;
    if (!video) fail(404, 'Video not found.');
    if (download === '1') fail(403, 'Save this video inside the app instead.');
    res.sendFile(video.file || 'video', { root: join(directory, item.id), headers: { 'Content-Type': video.type } });
  });
  return {
    publicResource,
    routes() {
      api.get('/resources/:id', (req, res) => res.json(publicResource(resource(req.params.id))));
      api.get('/resources/:id/pdf/pages/:page', async (req, res) => {
        const item = resource(req.params.id);
        const pdf = JSON.parse(item.media).pdf;
        const page = Number(req.params.page);
        if (!pdf || !Number.isInteger(page) || page < 1 || page > pdf.pages) fail(404, 'Page not found.');
        res.type('png').send(await processDocument(() => renderPage(readFileSync(mediaPath(item.id, 'pdf', pdf)), page, req.user.phone)));
      });
      api.get('/resources/:id/pdf/download', () => fail(403, 'Save this resource inside the app instead.'));
      api.get('/resources/:id/video/link', (req, res) => {
        const item = resource(req.params.id);
        if (!JSON.parse(item.media).video) fail(404, 'Video not found.');
        const download = req.query.download === '1' ? '1' : '0';
        if (download === '1') fail(403, 'Save this video inside the app instead.');
        const expires = String(Date.now() + (download === '1' ? 10 : 60) * 60_000);
        const uid = req.user.uid;
        res.json({ url: `/api/resource-files/${item.id}?${new URLSearchParams({
          uid, expires, download, token: signature(item.id, uid, expires, download),
        })}` });
      });
    },
    adminRoutes() {
      api.post('/admin/current-affairs/uploads', (req, res) => {
        const files = {};
        for (const kind of ['pdf', 'video']) {
          const item = req.body?.[kind];
          if (!item) continue;
          if (!Number.isSafeInteger(item.size) || item.size < (kind === 'pdf' ? 1 : 12) || item.size > limits[kind] ||
              (kind === 'pdf' ? item.type !== 'application/pdf' : !videoTypes.has(item.type))) {
            fail(422, 'Choose a PDF up to 12 MB and/or an MP4, WebM, or MOV video up to 300 MB.');
          }
          files[kind] = { size: item.size, type: item.type };
        }
        if (!Object.keys(files).length) fail(422, 'Choose a PDF or video to publish.');
        const id = randomUUID();
        db.prepare('INSERT INTO resource_uploads VALUES (?, ?, ?, ?)').run(id, req.user.uid, JSON.stringify(files), Date.now() + 30 * 60_000);
        res.status(201).json({ id, direct: true });
      });
      api.put('/admin/current-affairs/uploads/:id/:kind', async (req, res) => {
        const draft = checkDraft(req.params.id, req.user.uid);
        const kind = req.params.kind;
        const expected = JSON.parse(draft.files)[kind];
        if (!['pdf', 'video'].includes(kind) || !expected) fail(404, 'Upload file not found.');
        if (Number(req.get('Content-Length')) > expected.size) fail(413, 'The file exceeds the selected upload size.');
        mkdirSync(join(directory, draft.id), { recursive: true, mode: 0o700 });
        const path = filePath(draft.id, kind);
        let size = 0;
        try {
          await pipeline(req, new Transform({
            transform(chunk, _encoding, done) {
              size += chunk.length;
              done(size > expected.size ? Object.assign(new Error('File exceeds the upload size.'), { status: 413 }) : null, chunk);
            },
          }), createWriteStream(path, { mode: 0o600 }));
          if (size !== expected.size) fail(422, 'The file did not finish uploading. Try again.');
        } catch (error) {
          rmSync(path, { force: true });
          throw error;
        }
        res.sendStatus(204);
      });
    },
    async publish(req, kind = 'current-affairs') {
      const { uploadId, publishedAt, downloadsEnabled } = req.body;
      const title = text(req.body.title, 'Resource title', 120);
      if (!['current-affairs', 'pyqs', 'syllabus'].includes(kind)) fail(422, 'Choose a valid content section.');
      const summary = kind === 'current-affairs' || req.body.summary === undefined ? '' : text(req.body.summary, 'Summary', 300);
      const body = kind === 'current-affairs' || req.body.body === undefined ? '' : text(req.body.body, 'Content', 10_000);
      if (typeof publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt) ||
          Number.isNaN(Date.parse(publishedAt)) || new Date(publishedAt).toISOString().slice(0, 10) !== publishedAt) {
        fail(422, 'Enter a valid publish date.');
      }
      if (typeof downloadsEnabled !== 'boolean') fail(422, 'Choose whether downloads are allowed.');
      const draft = checkDraft(uploadId, req.user.uid);
      const files = JSON.parse(draft.files);
      const media = {};
      for (const [kind, item] of Object.entries(files)) {
        const path = filePath(draft.id, kind);
        if (!existsSync(path) || statSync(path).size !== item.size) fail(409, 'Wait for all files to finish uploading.');
        if (kind === 'pdf') media.pdf = { ...item, pages: await processDocument(() => pageCount(readFileSync(path))) };
        else {
          if (!looksLikeVideo(path, item.type)) fail(422, 'The selected file is not a valid video.');
          media.video = item;
        }
      }
      // Recheck after document processing so one upload cannot publish twice.
      checkDraft(uploadId, req.user.uid);
      db.exec('BEGIN');
      try {
        db.prepare(`INSERT INTO resources (id,kind,title,summary,body,created_at,published_at,media,downloads_enabled)
          VALUES (?,?,?,?,?,?,?,?,?)`).run(draft.id, kind, title, summary, body, new Date().toISOString(),
          publishedAt, JSON.stringify(media), Number(downloadsEnabled));
        db.prepare('DELETE FROM resource_uploads WHERE id=?').run(draft.id);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      return draft.id;
    },
    async edit(id, req) {
      const { uploadId, publishedAt, downloadsEnabled } = req.body;
      const title = text(req.body.title, 'Resource title', 120);
      const existingResource = resource(id);
      const summary = existingResource.kind === 'current-affairs' || req.body.summary === undefined ?
        existingResource.summary : text(req.body.summary, 'Summary', 300);
      const body = existingResource.kind === 'current-affairs' || req.body.body === undefined ?
        existingResource.body : text(req.body.body, 'Content', 10_000);
      if (typeof publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt) ||
          Number.isNaN(Date.parse(publishedAt)) || new Date(publishedAt).toISOString().slice(0, 10) !== publishedAt) {
        fail(422, 'Enter a valid publish date.');
      }
      if (typeof downloadsEnabled !== 'boolean') fail(422, 'Choose whether downloads are allowed.');
      if (uploadId !== undefined && uploadId !== null && uploadId !== '' && typeof uploadId !== 'string') {
        fail(422, 'Choose files to upload.');
      }
      const draft = uploadId ? checkDraft(uploadId, req.user.uid) : null;
      const files = draft ? JSON.parse(draft.files) : {};
      const staged = [];
      const replacements = {};
      let superseded = [];
      try {
        for (const [kind, item] of Object.entries(files)) {
          if (!['pdf', 'video'].includes(kind)) fail(422, 'Invalid upload file.');
          const source = filePath(draft.id, kind);
          if (!existsSync(source) || statSync(source).size !== item.size) fail(409, 'Wait for all files to finish uploading.');
          const name = `${kind}-${randomUUID()}`;
          mkdirSync(join(directory, id), { recursive: true, mode: 0o700 });
          staged.push(name);
          try { copyFileSync(source, filePath(id, name), constants.COPYFILE_EXCL); } catch (error) {
            if (error.code === 'EEXIST') staged.pop();
            throw error;
          }
          const path = filePath(id, name);
          if (statSync(path).size !== item.size) fail(409, 'Wait for all files to finish uploading.');
          if (kind === 'pdf') replacements.pdf = { ...item, file: name, pages: await processDocument(() => pageCount(readFileSync(path))) };
          else {
            if (!looksLikeVideo(path, item.type)) fail(422, 'The selected file is not a valid video.');
            replacements.video = { ...item, file: name };
          }
        }
        db.exec('BEGIN');
        try {
          if (draft) checkDraft(uploadId, req.user.uid);
          const existing = resource(id);
          const media = JSON.parse(existing.media);
          superseded = Object.keys(replacements).filter(kind => media[kind])
            .map(kind => media[kind].file || kind);
          Object.assign(media, replacements);
          db.prepare('UPDATE resources SET title=?, summary=?, body=?, published_at=?, downloads_enabled=?, media=? WHERE id=?')
            .run(title, summary, body, publishedAt, Number(downloadsEnabled), JSON.stringify(media), id);
          if (draft) db.prepare('DELETE FROM resource_uploads WHERE id=?').run(draft.id);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      } catch (error) {
        for (const name of staged) {
          try { removeFile(id, name); } catch (cleanupError) {
            console.error('Resource media cleanup failed:', id, cleanupError.code);
            error.warning = 'Some staged resource files could not be removed.';
          }
        }
        throw error;
      }
      let warning;
      for (const [cleanupId, name] of [
        ...superseded.map(name => [id, name]),
        ...Object.keys(files).map(kind => [draft.id, kind]),
      ]) {
        try { removeFile(cleanupId, name); } catch (error) {
          console.error('Resource media cleanup failed:', cleanupId, error.code);
          warning = 'The resource was updated, but some stored files could not be removed.';
        }
      }
      return { id, ...(warning ? { warning } : {}) };
    },
    remove(id) {
      rmSync(join(directory, id), { recursive: true, force: true });
    },
  };
}
