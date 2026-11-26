import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { fail } from './documents.js';
import { chapterInput, idInput, validateFolderSnapshot } from './workspace.js';

const types = new Map([['video/mp4', 'mp4'], ['video/webm', 'webm'], ['video/quicktime', 'mov']]);
const maxBytes = 300 * 1024 * 1024;
const pathFor = id => `chapter-videos/${id}`;
const digest = value => createHash('sha256').update(value).digest('hex');
const ticketId = (uid, videoId) => digest(JSON.stringify([uid, videoId]));

export function registerVideoFileRoute(api, { db, bucket, value, videoUser, requirePurchase }) {
  api.get('/videos/:id/file', async (req, res) => {
    const ticket = typeof req.query.ticket === 'string' ? /^([a-f0-9]{64})\.([a-f0-9]{64})$/.exec(req.query.ticket) : null;
    if (!ticket) fail(403, 'This video link is invalid.');
    const access = value(await db.collection('videoAccessTickets').doc(ticket[1]).get());
    const actual = Buffer.from(digest(ticket[2]), 'hex');
    const valid = Array.isArray(access?.tickets) && access.tickets.some(entry => {
      const expected = Buffer.from(entry.secretHash || '', 'hex');
      return entry.expires > Date.now() && actual.length === expected.length && timingSafeEqual(actual, expected);
    });
    if (!valid || access.video !== req.params.id) fail(403, 'This video link expired or is invalid.');
    const item = value(await db.collection('chapterVideos').doc(req.params.id).get());
    if (!item) fail(404, 'Chapter video not found.');
    const user = await videoUser(access.uid);
    await requirePurchase(user, item.course);
    if (req.query.download === '1') fail(403, 'Save this video inside the app instead.');
    if (!Number.isSafeInteger(item.size) || item.size < 1) fail(500, 'Video size is invalid.');
    let start = 0;
    let end = item.size - 1;
    const range = req.get('Range');
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return res.status(416).set('Content-Range', `bytes */${item.size}`).end();
      if (!match[1]) start = Math.max(0, item.size - Number(match[2]));
      else {
        start = Number(match[1]);
        if (match[2]) end = Math.min(end, Number(match[2]));
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= item.size) {
        return res.status(416).set('Content-Range', `bytes */${item.size}`).end();
      }
      res.status(206).set('Content-Range', `bytes ${start}-${end}/${item.size}`);
    }
    res.set({ 'Accept-Ranges': 'bytes', 'Content-Type': item.type, 'Content-Length': String(end - start + 1) });
    await pipeline(bucket.file(item.mediaFile || pathFor(item.id)).createReadStream({start, end, validation: false}), res);
  });
}

export function registerVideoRoutes(api, { db, bucket, value, text, course, requirePurchase }) {
  const videos = db.collection('chapterVideos');
  const uploads = db.collection('chapterVideoUploads');

  api.get('/videos/:id/link', async (req, res) => {
    const item = value(await videos.doc(req.params.id).get());
    if (!item) fail(404, 'Chapter video not found.');
    await requirePurchase(req.user, item.course);
    const download = req.query.download === '1';
    if (download) fail(403, 'Save this video inside the app instead.');
    const secret = randomBytes(32).toString('hex');
    const id = ticketId(req.user.uid, item.id);
    const ref = db.collection('videoAccessTickets').doc(id);
    await db.runTransaction(async tx => {
      const current = value(await tx.get(ref));
      const now = Date.now();
      const tickets = (Array.isArray(current?.tickets) ? current.tickets : [])
        .filter(ticket => ticket.expires > now).slice(-31);
      tickets.push({secretHash: digest(secret), expires: now + 60 * 60_000});
      tx.set(ref, {uid: req.user.uid, video: item.id, tickets});
    });
    const url = `/api/videos/${encodeURIComponent(item.id)}/file?ticket=${id}.${secret}`;
    res.json({ url, title: item.title });
  });

  api.post('/admin/courses/:id/videos/upload', async (req, res) => {
    const { id: courseId } = await course(req.params.id);
    const { title, subject, chapter, type, size } = req.body ?? {};
    const replaceId = req.body?.replaceId ? idInput(req.body.replaceId) : null;
    const replacement = replaceId ? value(await videos.doc(replaceId).get()) : null;
    if (replaceId && (!replacement || replacement.course !== courseId)) fail(404, 'Chapter video not found.');
    const folderId = replacement ? replacement.folderId || null :
      idInput(req.body?.folderId === undefined ? null : req.body.folderId);
    if (folderId !== null) {
      const folder = await db.collection('courseFolders').doc(folderId).get();
      validateFolderSnapshot(folder, courseId, folderId, 'content', value);
    }
    if (!types.has(type)) fail(422, 'Choose an MP4, WebM, or MOV video.');
    if (!Number.isSafeInteger(size) || size < 12 || size > maxBytes) fail(422, 'Choose a video up to 300 MB.');
    const id = randomUUID();
    const expires = Date.now() + 30 * 60_000;
    const item = { course: courseId, title: text(title, 'Title', 120), subject: text(subject, 'Subject', 100),
      chapter: chapterInput(chapter === undefined && folderId ? '' : chapter),
      type, size, folderId, replaceId, uid: req.user.uid, expires };
    const headers = { 'x-goog-if-generation-match': '0', 'x-goog-meta-upload-id': id,
      'cache-control': 'private, no-store' };
    const [url] = await bucket.file(pathFor(id)).getSignedUrl({
      version: 'v4', action: 'write', expires, contentType: type, extensionHeaders: { ...headers, 'content-length': size },
    });
    await uploads.doc(id).create(item);
    res.status(201).json({ id, url, headers });
  });

  api.post('/admin/courses/:id/videos/:video/publish', async (req, res) => {
    const { id: courseId } = await course(req.params.id);
    const ref = uploads.doc(req.params.video);
    const draft = value(await ref.get());
    if (!draft || draft.course !== courseId || draft.uid !== req.user.uid) fail(404, 'Video upload not found.');
    if (draft.expires < Date.now()) fail(410, 'This upload expired. Choose the video and upload it again.');
    const file = bucket.file(pathFor(draft.id));
    const [metadata] = await file.getMetadata().catch(error => {
      if (error.code === 404) fail(409, 'The video has not finished uploading.');
      throw error;
    });
    const generation = bucket.file(pathFor(draft.id), { generation: metadata.generation });
    const chunks = [];
    for await (const chunk of generation.createReadStream({ start: 0, end: 11, validation: false })) chunks.push(chunk);
    const header = Buffer.concat(chunks);
    const valid = draft.type === 'video/webm' ? header.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')) :
      header.toString('ascii', 4, 8) === 'ftyp';
    if (!valid || Number(metadata.size) !== draft.size || metadata.contentType !== draft.type ||
        metadata.metadata?.['upload-id'] !== draft.id) {
      await Promise.all([generation.delete({ ignoreNotFound: true }), ref.delete()]);
      fail(422, 'This file is not a valid video of the selected type.');
    }
    const { title, subject, chapter, type, size } = draft;
    let previousFile;
    await db.runTransaction(async tx => {
      const courseRef = db.collection('courses').doc(courseId);
      const folderId = idInput(draft.folderId === undefined ? null : draft.folderId);
      const folderRef = folderId === null ? null : db.collection('courseFolders').doc(folderId);
      const videoRef = draft.replaceId ? videos.doc(draft.replaceId) : null;
      const [pending, currentCourse, folder, existingVideo] = await Promise.all([
        tx.get(ref), tx.get(courseRef), folderRef ? tx.get(folderRef) : Promise.resolve(null),
        videoRef ? tx.get(videoRef) : Promise.resolve(null),
      ]);
      if (!currentCourse.exists) fail(404, 'Course not found.');
      if (!pending.exists) fail(409, 'This upload has already been published.');
      validateFolderSnapshot(folder, courseId, folderId, 'content', value);
      if (videoRef) {
        const existing = value(existingVideo);
        if (!existing || existing.course !== courseId) fail(404, 'Chapter video not found.');
        previousFile = existing.mediaFile || pathFor(existing.id);
        tx.update(videoRef, { title, subject, chapter, type, size, mediaFile: pathFor(draft.id) });
      } else {
        tx.create(videos.doc(draft.id), { course: courseId, title, subject, chapter, type, size, folderId,
          createdAt: new Date().toISOString() });
      }
      tx.update(courseRef, { workspaceVersion: (currentCourse.data().workspaceVersion || 0) + 1 });
      tx.delete(ref);
    });
    let warning;
    try {
      if (previousFile && previousFile !== pathFor(draft.id)) {
        await bucket.file(previousFile).delete({ ignoreNotFound: true });
      }
    } catch (error) {
      console.error('Replaced chapter video cleanup failed:', previousFile, error.code);
      warning = 'The video was updated, but its previous file could not be removed.';
    }
    res.status(201).json({ id: draft.replaceId || draft.id, ...(warning ? { warning } : {}) });
  });
}
