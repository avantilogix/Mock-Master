import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import test from 'node:test';
import express from 'express';
import { registerVideoFileRoute, registerVideoRoutes } from '../firebase-functions/chapter-videos.js';

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

  const replacementBytes = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypisom'), Buffer.alloc(12, 2)]);
  const replacementDraft = response();
  await upload({...req, body: {...req.body, title: 'Updated Video', size: replacementBytes.length, replaceId: id}}, replacementDraft);
  const replacementId = replacementDraft.body.id;
  objects.set(`chapter-videos/${replacementId}`, {bytes: replacementBytes, metadata: {
    size: String(replacementBytes.length), contentType: 'video/mp4',
    generation: '2', metadata: {'upload-id': replacementId},
  }});
  const replaced = response();
  await publish({...req, params: {id: 'c', video: replacementId}}, replaced);
  assert.equal(replaced.code, 201);
  assert.equal(replaced.body.id, id);
  assert.equal(documents.get(`chapterVideos/${id}`).title, 'Updated Video');
  assert.equal(documents.get(`chapterVideos/${id}`).mediaFile, `chapter-videos/${replacementId}`);
  assert.equal(documents.get(`chapterVideos/${id}`).folderId, 'content');
  assert.equal(objects.has(`chapter-videos/${id}`), false);
  assert.equal(objects.has(`chapter-videos/${replacementId}`), true);
});

test('Firebase video links recheck access on every range request and after revocation', async t => {
  const bytes = Buffer.from('0123456789abcdef');
  const documents = new Map([['chapterVideos/v', {course: 'c', title: 'Video', type: 'video/mp4', size: bytes.length}]]);
  const ref = path => ({
    id: path.split('/').at(-1),
    get: async () => ({id: path.split('/').at(-1), exists: documents.has(path), data: () => documents.get(path)}),
    set: async data => { documents.set(path, data); },
  });
  const db = {
    collection: name => ({doc: id => ref(`${name}/${id}`)}),
    runTransaction: async action => action({get: item => item.get(), set: (item, data) => item.set(data)}),
  };
  const bucket = {file: () => ({createReadStream: ({start, end}) => Readable.from([bytes.subarray(start, end + 1)])})};
  const value = snap => snap.exists ? {id: snap.id, ...snap.data()} : null;
  let allowed = true;
  let enabled = true;
  const requirePurchase = async () => {
    if (!allowed) throw Object.assign(new Error('Purchase required'), {status: 403});
  };
  const app = express();
  registerVideoFileRoute(app, {db, bucket, value, requirePurchase, videoUser: async uid => {
    if (!enabled) throw Object.assign(new Error('Account disabled'), {status: 403});
    return {uid};
  }});
  app.use((req, _res, next) => { req.user = {uid: 'buyer'}; next(); });
  registerVideoRoutes(app, {db, bucket, value, requirePurchase, text: value => value, course: async id => ({id})});
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({error: error.message}));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${base}/videos/v/file`)).status, 403);
  const link = await (await fetch(`${base}/videos/v/link`)).json();
  const path = link.url.replace('/api/', '/');
  const partial = await fetch(base + path, {headers: {Range: 'bytes=2-5'}});
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), `bytes 2-5/${bytes.length}`);
  assert.equal(await partial.text(), '2345');
  const second = await (await fetch(`${base}/videos/v/link`)).json();
  assert.equal((await fetch(base + path)).status, 200);
  assert.equal((await fetch(base + second.url.replace('/api/', '/'))).status, 200);
  assert.equal((await fetch(base + path, {headers: {Range: 'bytes=99-'}})).status, 416);
  assert.equal((await fetch(base + path + '&download=1')).status, 403);
  assert.equal((await fetch(base + path + '0')).status, 403);
  enabled = false;
  assert.equal((await fetch(base + path)).status, 403);
  enabled = true;
  allowed = false;
  assert.equal((await fetch(base + path)).status, 403);
  assert.equal((await fetch(`${base}/videos/v/link`)).status, 403);
});
