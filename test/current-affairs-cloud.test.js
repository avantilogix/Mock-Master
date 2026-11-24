import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { currentAffairs } from '../firebase-functions/current-affairs.js';

test('cloud Current Affairs signs private uploads and publishes only matching completed files', async () => {
  const documents = new Map();
  const objects = new Map();
  const signed = [];
  const handlers = new Map();
  const ref = path => ({
    id: path.split('/').at(-1),
    get: async () => ({id: path.split('/').at(-1), exists: documents.has(path), data: () => documents.get(path)}),
    create: async data => { documents.set(path, data); },
    path,
  });
  const db = {
    collection: name => ({doc: id => ref(`${name}/${id}`)}),
    runTransaction: async action => action({
      get: item => item.get(),
      create: (item, data) => documents.set(item.path, data),
      delete: item => documents.delete(item.path),
    }),
  };
  const bucket = {file: (path, options) => ({
    getSignedUrl: async input => { signed.push({path, options, ...input}); return [`https://storage.example/${path}`]; },
    getMetadata: async () => {
      if (!objects.has(path)) throw Object.assign(new Error('Missing object'), {code: 404});
      return [objects.get(path).metadata];
    },
    download: async () => [objects.get(path).bytes],
    delete: async () => { objects.delete(path); },
  })};
  const service = currentAffairs({
    get: (path, handler) => handlers.set(`GET ${path}`, handler),
    post: (path, handler) => handlers.set(`POST ${path}`, handler),
  }, {
    db, bucket, value: snapshot => snapshot.exists ? {id: snapshot.id, ...snapshot.data()} : null,
    text: input => input.trim(), processDocument: operation => operation(),
    protectedPdf: () => { throw new Error('Download must be denied before rendering.'); },
  });
  service.routes();
  service.adminRoutes();
  const response = () => ({
    status(code) { this.code = code; return this; },
    json(body) { this.body = body; return this; },
  });
  const pdf = await PDFDocument.create();
  pdf.addPage();
  const bytes = Buffer.from(await pdf.save());
  const req = {user: {uid: 'admin'}, body: {pdf: {size: bytes.length, type: 'application/pdf'}}};
  const draft = response();
  await handlers.get('POST /admin/current-affairs/uploads')(req, draft);
  assert.equal(draft.code, 201);
  const {id} = draft.body;
  assert.equal(draft.body.files.pdf.headers['x-goog-if-generation-match'], '0');
  assert.equal(signed[0].action, 'write');
  assert.equal(signed[0].extensionHeaders['content-length'], bytes.length);
  req.body = {uploadId: id, title: 'Daily Affairs', publishedAt: '2026-02-28', downloadsEnabled: false};
  await assert.rejects(service.publish({...req, user: {uid: 'another-admin'}}), {status: 404});
  await assert.rejects(service.publish(req), {status: 409});
  const object = {bytes, metadata: {size: String(bytes.length), contentType: 'application/pdf',
    generation: '123', metadata: {'upload-id': 'wrong-upload'}}};
  objects.set(`current-affairs/${id}/pdf`, object);
  await assert.rejects(service.publish(req), {status: 422});
  object.metadata.metadata['upload-id'] = id;
  assert.equal(await service.publish(req), id);
  assert.equal(documents.get(`resources/${id}`).media.pdf.pages, 1);
  assert.equal(documents.get(`resources/${id}`).media.pdf.generation, '123');
  assert.equal(documents.has(`resourceUploads/${id}`), false);
  await assert.rejects(service.publish(req), {status: 404});
  const read = {params: {id}, query: {}, user: {uid: 'student'}};
  await assert.rejects(handlers.get('GET /resources/:id/pdf/download')(read, response()), {status: 403});
  const item = documents.get(`resources/${id}`);
  item.media.video = {type: 'video/mp4', size: 12, generation: '456'};
  await assert.rejects(handlers.get('GET /resources/:id/video/link')({...read, query: {download: '1'}}, response()), {status: 403});
  await handlers.get('GET /resources/:id/video/link')(read, response());
  assert.equal(signed.at(-1).options.generation, '456');
  assert.match(signed.at(-1).responseDisposition, /^inline/);
  item.downloadsEnabled = true;
  await handlers.get('GET /resources/:id/video/link')({...read, query: {download: '1'}}, response());
  assert.match(signed.at(-1).responseDisposition, /^attachment/);
  await service.remove(id);
  assert.equal(objects.size, 0);
});
