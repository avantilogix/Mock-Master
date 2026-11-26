import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { registerWorkspaceRoutes } from '../firebase-functions/workspace-routes.js';
import { registerPublishedRoutes } from '../firebase-functions/published.js';

function fakeFirestore() {
  const data = new Map();
  let nextId = 0;
  const snapshot = ref => {
    const stored = data.get(`${ref.collectionName}/${ref.id}`);
    return { id: ref.id, exists: stored !== undefined, data: () => stored, ref };
  };
  const db = {
    collection(name) {
      return {
        doc(id = `generated${++nextId}`) { return { collectionName: name, id,
          async delete() { data.delete(`${name}/${id}`); } }; },
        where(field, op, expected) {
          assert.equal(op, '==');
          return {
            collectionName: name, field, expected,
            async get() { return query(this); },
            limit(count) { return { ...this, count }; },
          };
        },
      };
    },
    async runTransaction(work) {
      const writes = [];
      const tx = {
        async get(ref) { return ref.field ? query(ref) : snapshot(ref); },
        create(ref, value) { writes.push(() => data.set(`${ref.collectionName}/${ref.id}`, value)); },
        update(ref, patch) { writes.push(() => data.set(`${ref.collectionName}/${ref.id}`, { ...snapshot(ref).data(), ...patch })); },
        delete(ref) { writes.push(() => data.delete(`${ref.collectionName}/${ref.id}`)); },
      };
      const result = await work(tx);
      writes.forEach(write => write());
      return result;
    },
    batch() {
      const refs = [];
      return {
        delete(ref) { refs.push(ref); },
        async commit() { for (const ref of refs) data.delete(`${ref.collectionName}/${ref.id}`); },
      };
    },
  };
  function query(ref) {
    const docs = [...data.keys()].filter(key => key.startsWith(`${ref.collectionName}/`))
      .map(key => snapshot({ collectionName: ref.collectionName, id: key.slice(ref.collectionName.length + 1) }))
      .filter(doc => doc.data()[ref.field] === ref.expected).slice(0, ref.count);
    return { docs, size: docs.length, empty: docs.length === 0 };
  }
  return { db, data };
}

test('Firebase published deletion retains courses and removes test results and sessions', async t => {
  const { db, data } = fakeFirestore();
  data.set('courses/c', { title: 'Course' });
  data.set('orders/o', { course: 'c' });
  data.set('tests/t', { course: 'c' });
  data.set('attempts/a', { test: 't' });
  data.set('examSessions/s', { test: 't' });
  const app = express();
  registerPublishedRoutes(app, {
    db, bucket: {}, value: snap => snap.exists ? { id: snap.id, ...snap.data() } : null,
    text: value => value, byNewest: () => 0, queryCollection: async () => [], media: {}, affairs: {},
  });
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const remove = (type, id) => fetch(`http://127.0.0.1:${server.address().port}/admin/published/${type}/${id}`, {method: 'DELETE'});
  const course = await remove('courses', 'c');
  assert.deepEqual(await course.json(), { deleted: false, archived: true });
  assert.equal(data.get('courses/c').archived, true);
  assert.equal(data.has('orders/o'), true);
  assert.equal(data.has('tests/t'), true);
  assert.equal((await remove('tests', 't')).status, 200);
  assert.equal(data.has('tests/t'), false);
  assert.equal(data.has('attempts/a'), false);
  assert.equal(data.has('examSessions/s'), false);
  data.set('tests/large', { course: 'c' });
  for (let i = 0; i < 500; i++) data.set(`attempts/large${i}`, { test: 'large' });
  assert.equal((await remove('tests', 'large')).status, 200);
  assert.equal(data.has('tests/large'), false);
  assert.equal(data.has('attempts/large0'), false);
});

test('Firebase workspace routes persist validated folders and item moves transactionally', async t => {
  const { db, data } = fakeFirestore();
  data.set('courses/c', { title: 'Course' });
  data.set('courses/other', { title: 'Other' });
  data.set('books/b', { course: 'c', title: 'Book' });
  data.set('tests/t', { course: 'c', title: 'Test' });
  data.set('chapterVideos/v', { course: 'other', title: 'Other video' });
  const value = snap => snap.exists ? { id: snap.id, ...snap.data() } : null;
  const app = express();
  app.use(express.json());
  const deletedFiles = [];
  const bucket = { file: name => ({ delete: async () => {
    if (name === 'broken.pdf') throw Object.assign(new Error('Storage unavailable'), { code: 'unavailable' });
    deletedFiles.push(name);
  } }) };
  registerWorkspaceRoutes(app, { db, bucket, value, course: async id => {
    if (!data.has(`courses/${id}`)) throw Object.assign(new Error('Course not found.'), { status: 404 });
    return { id };
  } });
  app.use((err, _req, res, _next) => res.status(err.status || 500).json({ error: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/admin/courses/c`;
  const request = (path, method = 'GET', body) => fetch(base + path, {
    method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const create = async body => {
    const response = await request('/folders', 'POST', body);
    assert.equal(response.status, 201);
    return response.json();
  };
  const a = await create({ kind: 'content', name: 'Root' });
  const b = await create({ kind: 'content', name: 'Child', parentId: a.id });
  const tests = await create({ kind: 'tests', name: 'Tests' });
  assert.equal((await request('/folders', 'POST', { kind: 'content', name: 'Root' })).status, 409);
  assert.equal((await request(`/folders/${a.id}`, 'PATCH', { parentId: b.id })).status, 422);
  assert.equal((await request(`/folders/${b.id}`, 'PATCH', { parentId: tests.id })).status, 422);
  assert.equal((await request('/workspace-items/book/b', 'PATCH', { folderId: b.id })).status, 200);
  assert.equal((await request('/workspace-items/test/t', 'PATCH', { folderId: b.id })).status, 422);
  assert.equal((await request('/workspace-items/chapterVideo/v', 'PATCH', { folderId: a.id })).status, 404);
  assert.equal(data.get('books/b').folderId, b.id);
  assert.equal(data.get('courses/c').workspaceVersion, 4);
  assert.deepEqual(await (await request('/workspace?kind=content')).json(), {
    folders: [a, b], items: [{ id: 'b', title: 'Book', type: 'book', folderId: b.id }],
  });
  assert.equal((await request('/workspace-items/book/b', 'PATCH', { folderId: null })).status, 200);
  assert.equal(data.get('books/b').folderId, null);
  data.set('books/b2', { course: 'c', title: 'Nested book', folderId: b.id, pdfFile: 'custom/book.pdf' });
  data.set('chapterVideos/v2', { course: 'c', title: 'Video', folderId: a.id, mediaFile: 'custom/video' });
  data.set('books/other', { course: 'other', title: 'Other', folderId: a.id });
  assert.equal((await request(`/folders/${tests.id}`, 'DELETE')).status, 422);
  assert.equal((await request('/folders/missing', 'DELETE')).status, 404);
  assert.equal((await request(`/folders/${a.id}`, 'DELETE')).status, 200);
  assert.equal(data.has(`courseFolders/${a.id}`), false);
  assert.equal(data.has(`courseFolders/${b.id}`), false);
  assert.equal(data.has('books/b2'), false);
  assert.equal(data.has('chapterVideos/v2'), false);
  assert.equal(data.has('books/b'), true);
  assert.equal(data.has('books/other'), true);
  assert.equal(data.has(`courseFolders/${tests.id}`), true);
  assert.deepEqual(deletedFiles.sort(), ['custom/book.pdf', 'custom/video']);
  const large = await create({ kind: 'content', name: 'Large' });
  for (let i = 0; i < 499; i++) data.set(`books/large${i}`, { course: 'c', folderId: large.id });
  assert.equal((await request(`/folders/${large.id}`, 'DELETE')).status, 409);
  assert.equal(data.has(`courseFolders/${large.id}`), true);
  assert.equal(data.has('books/large0'), true);
  const broken = await create({ kind: 'content', name: 'Broken file' });
  data.set('books/broken', { course: 'c', folderId: broken.id, pdfFile: 'broken.pdf' });
  const response = await request(`/folders/${broken.id}`, 'DELETE');
  assert.equal(response.status, 200);
  assert.match((await response.json()).warning, /stored files could not be removed/);
  assert.equal(data.has(`courseFolders/${broken.id}`), false);
});
