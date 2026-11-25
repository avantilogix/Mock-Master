import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test from 'node:test';
import { registerVideoRoutes } from '../firebase-functions/chapter-videos.js';

test('Firebase chapter uploads validate and retain their course folder', async () => {
  const documents = new Map([
    ['courses/c', {title: 'Course'}],
    ['courseFolders/content', {course: 'c', kind: 'content'}],
    ['courseFolders/tests', {course: 'c', kind: 'tests'}],
    ['courseFolders/other', {course: 'other', kind: 'content'}],
  ]);
  const objects = new Map();
  const handlers = new Map();
  const ref = path => ({
    id: path.split('/').at(-1), path,
    get: async () => ({id: path.split('/').at(-1), exists: documents.has(path), data: () => documents.get(path)}),
    create: async data => { documents.set(path, data); },
    delete: async () => { documents.delete(path); },
  });
  const db = {
    collection: name => ({doc: id => ref(`${name}/${id}`)}),
    runTransaction: async action => action({
      get: item => item.get(),
      create: (item, data) => documents.set(item.path, data),
      update: (item, patch) => documents.set(item.path, {...documents.get(item.path), ...patch}),
      delete: item => documents.delete(item.path),
    }),
  };
  const bucket = {file: path => ({
    getSignedUrl: async () => [`https://storage.example/${path}`],
    getMetadata: async () => {
      if (!objects.has(path)) throw Object.assign(new Error('Missing object'), {code: 404});
      return [objects.get(path).metadata];
    },
    createReadStream: () => Readable.from([objects.get(path).bytes]),
    delete: async () => { objects.delete(path); },
  })};
  registerVideoRoutes({
    get: (path, handler) => handlers.set(`GET ${path}`, handler),
    post: (path, handler) => handlers.set(`POST ${path}`, handler),
  }, {
    db, bucket, value: snapshot => snapshot.exists ? {id: snapshot.id, ...snapshot.data()} : null,
    text: input => input.trim(),
    course: async id => {
      if (!documents.has(`courses/${id}`)) throw Object.assign(new Error('Missing course'), {status: 404});
      return {id};
    },
    requirePurchase: async () => null,
  });
  const response = () => ({
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  });
  const bytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom')]);
  const req = {params: {id: 'c'}, user: {uid: 'admin'},
    body: {title: 'Video', subject: 'Maths', chapter: 'One', type: 'video/mp4', size: bytes.length, folderId: 'content'}};
  const upload = handlers.get('POST /admin/courses/:id/videos/upload');
  for (const folderId of ['tests', 'other', 'missing']) {
    await assert.rejects(upload({...req, body: {...req.body, folderId}}, response()), {status: 422});
  }
  const draft = response();
  await upload(req, draft);
  const {id} = draft.body;
  assert.equal(documents.get(`chapterVideoUploads/${id}`).folderId, 'content');
  objects.set(`chapter-videos/${id}`, {bytes, metadata: {size: String(bytes.length), contentType: 'video/mp4',
    generation: '1', metadata: {'upload-id': id}}});
  const publish = handlers.get('POST /admin/courses/:id/videos/:video/publish');
  documents.get('courseFolders/content').kind = 'tests';
  await assert.rejects(publish({...req, params: {id: 'c', video: id}}, response()), {status: 422});
  assert.equal(documents.has(`chapterVideos/${id}`), false);
  documents.get('courseFolders/content').kind = 'content';
  const published = response();
  await publish({...req, params: {id: 'c', video: id}}, published);
  assert.equal(published.code, 201);
  assert.equal(documents.get(`chapterVideos/${id}`).folderId, 'content');
  assert.equal(documents.has(`chapterVideoUploads/${id}`), false);
});
