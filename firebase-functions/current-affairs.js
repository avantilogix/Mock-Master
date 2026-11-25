import { randomUUID } from 'node:crypto';
import { fail, pageCount, renderPage } from './documents.js';

const videoTypes = new Map([['video/mp4', 'mp4'], ['video/webm', 'webm'], ['video/quicktime', 'mov']]);
const limits = { pdf: 12 * 1024 * 1024, video: 300 * 1024 * 1024 };
const pathFor = (id, kind) => `current-affairs/${id}/${kind}`;

export function currentAffairs(api, { db, bucket, value, text, processDocument }) {
  const uploads = db.collection('resourceUploads');
  const resources = db.collection('resources');
  const resource = async id => {
    const item = value(await resources.doc(id).get());
    if (!item || item.kind !== 'current-affairs') fail(404, 'Current Affairs resource not found.');
    return item;
  };
  const checkDraft = (draft, uid) => {
    if (!draft || draft.uid !== uid) fail(404, 'Resource upload not found.');
    if (draft.expires < Date.now()) fail(410, 'This upload expired. Choose the files and upload again.');
  };
  const fileFor = (id, kind, item) => bucket.file(pathFor(id, item.file || kind), { generation: item.generation });
  return {
    routes() {
      api.get('/resources/:id', async (req, res) => {
        const item = await resource(req.params.id);
        res.json(item);
      });
      api.get('/resources/:id/pdf/pages/:page', async (req, res) => {
        const item = await resource(req.params.id);
        const pdf = item.media?.pdf;
        const page = Number(req.params.page);
        if (!pdf || !Number.isInteger(page) || page < 1 || page > pdf.pages) fail(404, 'Page not found.');
        const [bytes] = await fileFor(item.id, 'pdf', pdf).download();
        res.type('png').send(await processDocument(() => renderPage(bytes, page, req.user.phone)));
      });
      api.get('/resources/:id/pdf/download', async () => fail(403, 'Save this resource inside the app instead.'));
      api.get('/resources/:id/video/link', async (req, res) => {
        const item = await resource(req.params.id);
        const video = item.media?.video;
        if (!video) fail(404, 'Video not found.');
        const download = req.query.download === '1';
        if (download) fail(403, 'Save this video inside the app instead.');
        const filename = `${item.title.replace(/[^\w .-]+/g, '_')}.${videoTypes.get(video.type)}`;
        const [url] = await fileFor(item.id, 'video', video).getSignedUrl({
          version: 'v4', action: 'read', expires: Date.now() + 60 * 60_000,
          responseDisposition: `inline; filename="${filename}"`,
        });
        res.json({ url });
      });
    },
    adminRoutes() {
      api.post('/admin/current-affairs/uploads', async (req, res) => {
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
        const expires = Date.now() + 30 * 60_000;
        const output = {};
        for (const [kind, item] of Object.entries(files)) {
          const headers = { 'x-goog-if-generation-match': '0', 'x-goog-meta-upload-id': id,
            'cache-control': 'private, no-store' };
          const [url] = await bucket.file(pathFor(id, kind)).getSignedUrl({
            version: 'v4', action: 'write', expires, contentType: item.type,
            extensionHeaders: { ...headers, 'content-length': item.size },
          });
          output[kind] = { url, headers };
        }
        await uploads.doc(id).create({ uid: req.user.uid, expires, files });
        res.status(201).json({ id, files: output });
      });
    },
    async publish(req) {
      const { uploadId, publishedAt, downloadsEnabled } = req.body;
      const title = text(req.body.title, 'Resource title', 120);
      if (typeof publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt) ||
          Number.isNaN(Date.parse(publishedAt)) || new Date(publishedAt).toISOString().slice(0, 10) !== publishedAt) {
        fail(422, 'Enter a valid publish date.');
      }
      if (typeof downloadsEnabled !== 'boolean') fail(422, 'Choose whether downloads are allowed.');
      if (typeof uploadId !== 'string' || !uploadId) fail(422, 'Choose files to upload.');
      const ref = uploads.doc(uploadId);
      const draft = value(await ref.get());
      checkDraft(draft, req.user.uid);
      const media = {};
      for (const [kind, item] of Object.entries(draft.files)) {
        const [metadata] = await bucket.file(pathFor(draft.id, kind)).getMetadata().catch(error => {
          if (error.code === 404) fail(409, 'Wait for all files to finish uploading.');
          throw error;
        });
        if (Number(metadata.size) !== item.size || metadata.contentType !== item.type ||
            metadata.metadata?.['upload-id'] !== draft.id) fail(422, 'Uploaded file does not match the selected file.');
        const file = bucket.file(pathFor(draft.id, kind), { generation: metadata.generation });
        if (kind === 'pdf') {
          const [bytes] = await file.download();
          media.pdf = { ...item, generation: metadata.generation, pages: await processDocument(() => pageCount(bytes)) };
        } else {
          const chunks = [];
          for await (const chunk of file.createReadStream({ start: 0, end: 11, validation: false })) chunks.push(chunk);
          const header = Buffer.concat(chunks);
          const valid = item.type === 'video/webm' ? header.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')) :
            ['ftyp', 'moov', 'mdat', 'wide', 'free'].includes(header.toString('ascii', 4, 8));
          if (!valid) fail(422, 'The selected file is not a valid video.');
          media.video = { ...item, generation: metadata.generation };
        }
      }
      await db.runTransaction(async tx => {
        checkDraft(value(await tx.get(ref)), req.user.uid);
        tx.create(resources.doc(draft.id), { kind: 'current-affairs', title, summary: '', body: '',
          publishedAt, downloadsEnabled, media, createdAt: new Date().toISOString() });
        tx.delete(ref);
      });
      return draft.id;
    },
    async edit(id, req) {
      const { uploadId, publishedAt, downloadsEnabled } = req.body;
      const title = text(req.body.title, 'Resource title', 120);
      if (typeof publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt) ||
          Number.isNaN(Date.parse(publishedAt)) || new Date(publishedAt).toISOString().slice(0, 10) !== publishedAt) {
        fail(422, 'Enter a valid publish date.');
      }
      if (typeof downloadsEnabled !== 'boolean') fail(422, 'Choose whether downloads are allowed.');
      await resource(id);
      if (uploadId !== undefined && uploadId !== null && uploadId !== '' && typeof uploadId !== 'string') {
        fail(422, 'Choose files to upload.');
      }
      const ref = uploadId ? uploads.doc(uploadId) : null;
      const draft = ref ? value(await ref.get()) : null;
      if (ref) checkDraft(draft, req.user.uid);
      const files = draft?.files || {};
      const staged = [];
      const uploaded = [];
      const replacements = {};
      let superseded = [];
      try {
        for (const [kind, item] of Object.entries(files)) {
          if (!['pdf', 'video'].includes(kind)) fail(422, 'Invalid upload file.');
          const [metadata] = await bucket.file(pathFor(draft.id, kind)).getMetadata().catch(error => {
            if (error.code === 404) fail(409, 'Wait for all files to finish uploading.');
            throw error;
          });
          if (Number(metadata.size) !== item.size || metadata.contentType !== item.type ||
              metadata.metadata?.['upload-id'] !== draft.id) fail(422, 'Uploaded file does not match the selected file.');
          uploaded.push({ kind, generation: metadata.generation });
          const name = `${kind}-${randomUUID()}`;
          const destination = bucket.file(pathFor(id, name));
          const entry = { name };
          staged.push(entry);
          try {
            await bucket.file(pathFor(draft.id, kind), { generation: metadata.generation })
              .copy(destination, { preconditionOpts: { ifGenerationMatch: 0 } });
          } catch (error) {
            if (error.code === 412) staged.pop();
            throw error;
          }
          const [copied] = await destination.getMetadata();
          entry.generation = copied.generation;
          const file = bucket.file(pathFor(id, name), { generation: copied.generation });
          if (kind === 'pdf') {
            const [bytes] = await file.download();
            replacements.pdf = { ...item, file: name, generation: copied.generation,
              pages: await processDocument(() => pageCount(bytes)) };
          } else {
            const chunks = [];
            for await (const chunk of file.createReadStream({ start: 0, end: 11, validation: false })) chunks.push(chunk);
            const header = Buffer.concat(chunks);
            const valid = item.type === 'video/webm' ? header.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')) :
              ['ftyp', 'moov', 'mdat', 'wide', 'free'].includes(header.toString('ascii', 4, 8));
            if (!valid) fail(422, 'The selected file is not a valid video.');
            replacements.video = { ...item, file: name, generation: copied.generation };
          }
        }
        await db.runTransaction(async tx => {
          const existing = value(await tx.get(resources.doc(id)));
          if (!existing || existing.kind !== 'current-affairs') fail(404, 'Current Affairs resource not found.');
          if (ref) checkDraft(value(await tx.get(ref)), req.user.uid);
          superseded = Object.keys(replacements).filter(kind => existing.media?.[kind])
            .map(kind => ({ kind, item: existing.media[kind] }));
          tx.update(resources.doc(id), { title, publishedAt, downloadsEnabled,
            media: { ...existing.media, ...replacements } });
          if (ref) tx.delete(ref);
        });
      } catch (error) {
        for (const entry of staged) {
          try {
            await bucket.file(pathFor(id, entry.name), entry.generation ? { generation: entry.generation } : undefined)
              .delete({ ignoreNotFound: true });
          } catch (cleanupError) {
            console.error('Resource media cleanup failed:', id, cleanupError.code);
            error.warning = 'Some staged resource files could not be removed.';
          }
        }
        throw error;
      }
      let warning;
      for (const { kind, item } of superseded) {
        try { await fileFor(id, kind, item).delete({ ignoreNotFound: true }); } catch (error) {
          console.error('Resource media cleanup failed:', id, error.code);
          warning = 'The resource was updated, but some stored files could not be removed.';
        }
      }
      for (const { kind, generation } of uploaded) {
        try { await bucket.file(pathFor(draft.id, kind), { generation }).delete({ ignoreNotFound: true }); } catch (error) {
          console.error('Resource media cleanup failed:', draft.id, error.code);
          warning = 'The resource was updated, but some stored files could not be removed.';
        }
      }
      return { id, ...(warning ? { warning } : {}) };
    },
    async remove(id) {
      if (bucket.deleteFiles) await bucket.deleteFiles({ prefix: `current-affairs/${id}/`, force: true });
      else await Promise.all(['pdf', 'video'].map(kind => bucket.file(pathFor(id, kind)).delete({ ignoreNotFound: true })));
    },
  };
}
