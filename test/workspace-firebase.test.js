import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { registerWorkspaceRoutes } from '../firebase-functions/workspace-routes.js';

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
        doc(id = `generated${++nextId}`) { return { collectionName: name, id }; },
        where(field, op, expected) {
          assert.equal(op, '==');
          return {
            collectionName: name, field, expected,
            async get() { return query(this); },
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
      };
      const result = await work(tx);
      writes.forEach(write => write());
      return result;
    },
  };
  function query(ref) {
    return { docs: [...data.keys()].filter(key => key.startsWith(`${ref.collectionName}/`))
      .map(key => snapshot({ collectionName: ref.collectionName, id: key.slice(ref.collectionName.length + 1) }))
      .filter(doc => doc.data()[ref.field] === ref.expected) };
  }
  return { db, data };
}

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
  registerWorkspaceRoutes(app, { db, value, course: async id => {
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
});
