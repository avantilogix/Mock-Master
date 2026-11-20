import { randomUUID } from 'node:crypto';
import { fail } from './documents.js';

const types = new Map([['video/mp4', 'mp4'], ['video/webm', 'webm'], ['video/quicktime', 'mov']]);
const maxBytes = 300 * 1024 * 1024;
const pathFor = id => `chapter-videos/${id}`;

export function registerVideoRoutes(api, { db, bucket, value, text, course, requirePurchase }) {
  const videos = db.collection('chapterVideos');
  const uploads = db.collection('chapterVideoUploads');

  api.get('/videos/:id/link', async (req, res) => {
    const item = value(await videos.doc(req.params.id).get());
    if (!item) fail(404, 'Chapter video not found.');
    const cutoff = await requirePurchase(req.user, item.course);
    const download = req.query.download === '1';
    const filename = item.title.replace(/[^\w .-]+/g, '_').trim() || 'chapter-video';
    const [url] = await bucket.file(pathFor(item.id)).getSignedUrl({
      version: 'v4', action: 'read', expires: Math.min(Date.now() + 60 * 60_000, cutoff ?? Infinity),
      responseDisposition: `${download ? 'attachment' : 'inline'}; filename="${filename}.${types.get(item.type)}"`,
    });
    res.json({ url, title: item.title });
  });

  api.post('/admin/courses/:id/videos/upload', async (req, res) => {
    const { id: courseId } = await course(req.params.id);
    const { title, subject, chapter, type, size } = req.body ?? {};
    if (!types.has(type)) fail(422, 'Choose an MP4, WebM, or MOV video.');
    if (!Number.isSafeInteger(size) || size < 12 || size > maxBytes) fail(422, 'Choose a video up to 300 MB.');
    const id = randomUUID();
    const expires = Date.now() + 30 * 60_000;
    const item = { course: courseId, title: text(title, 'Title', 120), subject: text(subject, 'Subject', 100),
      chapter: text(chapter, 'Chapter', 120), type, size, uid: req.user.uid, expires };
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
    await db.runTransaction(async tx => {
      const [pending, currentCourse] = await Promise.all([
        tx.get(ref), tx.get(db.collection('courses').doc(courseId)),
      ]);
      if (!currentCourse.exists) fail(404, 'Course not found.');
      if (!pending.exists) fail(409, 'This upload has already been published.');
      tx.create(videos.doc(draft.id), { course: courseId, title, subject, chapter, type, size, createdAt: new Date().toISOString() });
      tx.delete(ref);
    });
    res.status(201).json({ id: draft.id });
  });
}
