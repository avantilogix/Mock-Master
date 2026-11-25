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
      update: (item, patch) => documents.set(item.path, {...documents.get(item.path), ...patch}),
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
  const pyqDraft = response();
  await handlers.get('POST /admin/current-affairs/uploads')({
    user: {uid: 'admin'}, body: {pdf: {size: bytes.length, type: 'application/pdf'}},
  }, pyqDraft);
  const pyqId = pyqDraft.body.id;
  objects.set(`current-affairs/${pyqId}/pdf`, {bytes, metadata: {size: String(bytes.length),
    contentType: 'application/pdf', generation: '124', metadata: {'upload-id': pyqId}}});
  const pyqRequest = {user: {uid: 'admin'}, body: {uploadId: pyqId, title: 'PYQs',
    summary: 'Past questions', body: 'Practice paper', publishedAt: '2026-03-02', downloadsEnabled: true}};
  assert.equal(await service.publish(pyqRequest, 'pyqs'), pyqId);
  const pyqRead = response();
  await handlers.get('GET /resources/:id')({params: {id: pyqId}}, pyqRead);
  assert.equal(pyqRead.body.kind, 'pyqs');
  assert.equal(pyqRead.body.summary, 'Past questions');
  assert.equal(pyqRead.body.media.pdf.pages, 1);
  assert.equal(pyqRead.body.downloadsEnabled, true);
  const pyqEdit = {user: {uid: 'admin'}, body: {
    title: 'Updated PYQs', publishedAt: '2026-03-02', downloadsEnabled: false,
  }};
  assert.deepEqual(await service.edit(pyqId, pyqEdit), {id: pyqId});
  const updatedPyq = documents.get(`resources/${pyqId}`);
  assert.equal(updatedPyq.title, 'Updated PYQs');
  assert.equal(updatedPyq.summary, 'Past questions');
  assert.equal(updatedPyq.body, 'Practice paper');
  assert.equal(updatedPyq.media.pdf.generation, '124');
  assert.equal(updatedPyq.downloadsEnabled, false);
  const syllabusDraft = response();
  await handlers.get('POST /admin/current-affairs/uploads')({
    user: {uid: 'admin'}, body: {pdf: {size: bytes.length, type: 'application/pdf'}},
  }, syllabusDraft);
  const syllabusId = syllabusDraft.body.id;
  objects.set(`current-affairs/${syllabusId}/pdf`, {bytes, metadata: {size: String(bytes.length),
    contentType: 'application/pdf', generation: '125', metadata: {'upload-id': syllabusId}}});
  assert.equal(await service.publish({user: {uid: 'admin'}, body: {
    uploadId: syllabusId, title: 'Syllabus', publishedAt: '2026-03-03', downloadsEnabled: false,
  }}, 'syllabus'), syllabusId);
  assert.equal(documents.get(`resources/${syllabusId}`).summary, '');
  assert.equal(documents.get(`resources/${syllabusId}`).body, '');
  const item = documents.get(`resources/${id}`);
  item.media.video = {type: 'video/mp4', size: 12, generation: '456'};
  await assert.rejects(handlers.get('GET /resources/:id/video/link')({...read, query: {download: '1'}}, response()), {status: 403});
  await handlers.get('GET /resources/:id/video/link')(read, response());
  assert.equal(signed.at(-1).options.generation, '456');
  assert.match(signed.at(-1).responseDisposition, /^inline/);
  item.downloadsEnabled = true;
  await assert.rejects(handlers.get('GET /resources/:id/video/link')({...read, query: {download: '1'}}, response()), {status: 403});
  await assert.rejects(handlers.get('GET /resources/:id/pdf/download')(read, response()), {status: 403});
  await service.remove(id);
  await service.remove(pyqId);
  await service.remove(syllabusId);
  assert.equal(objects.size, 0);
});

function editFixture() {
  const media = {
    pdf: {type: 'application/pdf', size: 20, pages: 1, generation: '1'},
    video: {type: 'video/mp4', size: 12, generation: '2'},
  };
  const documents = new Map([['resources/resource', {
    kind: 'current-affairs', title: 'Original', publishedAt: '2026-01-01',
    downloadsEnabled: false, media,
  }]]);
  const objects = new Map([
    ['current-affairs/resource/pdf', {bytes: Buffer.from('old pdf'), metadata: {generation: '1'}}],
    ['current-affairs/resource/video', {bytes: Buffer.from('old video'), metadata: {generation: '2'}}],
  ]);
  const ref = path => ({
    path,
    get: async () => ({id: path.split('/').at(-1), exists: documents.has(path), data: () => documents.get(path)}),
  });
  const db = {
    collection: name => ({doc: id => ref(`${name}/${id}`)}),
    runTransaction: async action => action({
      get: item => item.get(),
      update: (item, patch) => documents.set(item.path, {...documents.get(item.path), ...patch}),
      delete: item => documents.delete(item.path),
    }),
  };
  let generation = 10;
  const bucket = {file: (path, options = {}) => ({
    path,
    getMetadata: async () => {
      if (!objects.has(path)) throw Object.assign(new Error('Missing object'), {code: 404});
      return [objects.get(path).metadata];
    },
    download: async () => [objects.get(path).bytes],
    copy: async (destination, copyOptions) => {
      const source = objects.get(path);
      assert.equal(options.generation, source.metadata.generation);
      assert.equal(copyOptions.preconditionOpts.ifGenerationMatch, 0);
      objects.set(destination.path, {bytes: source.bytes,
        metadata: {...source.metadata, generation: String(++generation)}});
    },
    delete: async () => {
      if (objects.has(path) && options.generation !== undefined) {
        assert.equal(options.generation, objects.get(path).metadata.generation);
      }
      objects.delete(path);
    },
  })};
  const service = currentAffairs({}, {
    db, bucket, value: snapshot => snapshot.exists ? {id: snapshot.id, ...snapshot.data()} : null,
    text: input => input.trim(), processDocument: operation => operation(),
  });
  const request = {user: {uid: 'admin'}, body: {
    title: 'Updated', publishedAt: '2026-02-28', downloadsEnabled: true,
  }};
  const uploadPdf = bytes => {
    documents.set('resourceUploads/draft', {uid: 'admin', expires: Date.now() + 60_000,
      files: {pdf: {size: bytes.length, type: 'application/pdf'}}});
    objects.set('current-affairs/draft/pdf', {bytes, metadata: {size: String(bytes.length),
      contentType: 'application/pdf', generation: '3', metadata: {'upload-id': 'draft'}}});
    request.body.uploadId = 'draft';
  };
  return {service, request, uploadPdf, documents, objects, media};
}

test('cloud Current Affairs edit replaces selected media without changing resource ID or other media', async () => {
  const {service, request, uploadPdf, documents, objects, media} = editFixture();
  const pdf = await PDFDocument.create();
  pdf.addPage();
  pdf.addPage();
  uploadPdf(Buffer.from(await pdf.save()));

  assert.deepEqual(await service.edit('resource', request), {id: 'resource'});
  const item = documents.get('resources/resource');
  assert.equal(item.title, 'Updated');
  assert.equal(item.publishedAt, '2026-02-28');
  assert.equal(item.downloadsEnabled, true);
  assert.deepEqual(item.media.video, media.video);
  assert.equal(item.media.pdf.pages, 2);
  assert.notEqual(item.media.pdf.generation, media.pdf.generation);
  assert.ok(objects.has(`current-affairs/resource/${item.media.pdf.file}`));
  assert.ok(objects.has('current-affairs/resource/video'));
  assert.ok(!objects.has('current-affairs/resource/pdf'));
  assert.ok(!objects.has('current-affairs/draft/pdf'));
  assert.ok(!documents.has('resourceUploads/draft'));
});

test('cloud Current Affairs edit rejects invalid replacement without changing existing resource or media', async () => {
  const {service, request, uploadPdf, documents, objects} = editFixture();
  const original = structuredClone(documents.get('resources/resource'));
  uploadPdf(Buffer.from('not a pdf'));
  const originalObjects = [...objects.keys()].sort();

  await assert.rejects(service.edit('resource', request), {status: 422});
  assert.deepEqual(documents.get('resources/resource'), original);
  assert.deepEqual([...objects.keys()].sort(), originalObjects);
  assert.ok(documents.has('resourceUploads/draft'));
});

test('cloud Current Affairs metadata-only edit retains both media references', async () => {
  const {service, request, documents, objects, media} = editFixture();
  const originalObjects = [...objects.keys()].sort();

  assert.deepEqual(await service.edit('resource', request), {id: 'resource'});
  const item = documents.get('resources/resource');
  assert.equal(item.title, 'Updated');
  assert.equal(item.publishedAt, '2026-02-28');
  assert.equal(item.downloadsEnabled, true);
  assert.deepEqual(item.media, media);
  assert.deepEqual([...objects.keys()].sort(), originalObjects);
});
