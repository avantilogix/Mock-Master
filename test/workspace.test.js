import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createApp } from '../server/app.js';
import { openDatabase } from '../server/database.js';

test('course workspaces enforce scope, hierarchy and item placement', async t => {
  const db = openDatabase(':memory:');
  const users = {
    admin: { uid: 'admin', phone: '+919000000001' },
    student: { uid: 'student', phone: '+919000000002' },
  };
  const server = createApp({ db, verifyToken: async token => users[token], adminUids: ['admin'] }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(() => { db.close(); resolve(); })));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const request = (path, method = 'GET', body, user = 'admin') => fetch(base + path, {
    method, headers: { Authorization: `Bearer ${user}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = async (path, method, body, status = 200) => {
    const response = await request(path, method, body);
    assert.equal(response.status, status, await response.clone().text());
    return response.json();
  };
  for (const id of ['one', 'two']) db.prepare('INSERT INTO courses (id,title,description,price) VALUES (?, ?, ?, ?)').run(id, id, 'description', 100);
  db.prepare("INSERT INTO tests (id,course,title,questions) VALUES ('t','one','Test','[]'),('other','two','Other','[]')").run();
  db.prepare("INSERT INTO books (id,course,title,pages,pdf) VALUES ('b','one','Book',1,X'00')").run();
  db.prepare("INSERT INTO chapter_videos (id,course,title,subject,chapter,type,size,created_at) VALUES ('v','one','Video','S','C','video/mp4',1,'')").run();
  const root = '/admin/courses/one';
  assert.equal((await request(`${root}/workspace?kind=content`, 'GET', undefined, 'student')).status, 403);
  assert.equal((await request(`${root}/workspace`)).status, 422);
  assert.equal((await request('/admin/courses/missing/workspace?kind=tests')).status, 404);
  const a = await json(`${root}/folders`, 'POST', { kind: 'content', name: ' A ' }, 201);
  assert.deepEqual({ ...a, id: 'id' }, { id: 'id', name: 'A', parentId: null, kind: 'content' });
  const b = await json(`${root}/folders`, 'POST', { kind: 'content', name: 'B', parentId: a.id }, 201);
  const c = await json(`${root}/folders`, 'POST', { kind: 'content', name: 'C', parentId: b.id }, 201);
  const testFolder = await json(`${root}/folders`, 'POST', { kind: 'tests', name: 'A', parentId: null }, 201);
  const other = await json('/admin/courses/two/folders', 'POST', { kind: 'content', name: 'Other' }, 201);
  for (const input of [
    { kind: 'invalid', name: 'A' }, { kind: 'content', name: ' ' }, { kind: 'content', name: 'A' },
    { kind: 'content', name: 'X', parentId: other.id }, { kind: 'content', name: 'X', parentId: testFolder.id },
    { kind: 'content', name: 'X', parentId: 5 }, { kind: 'content', name: 'X', extra: true },
  ]) {
    const response = await request(`${root}/folders`, 'POST', input);
    assert.equal(response.status, input.name === 'A' && input.kind === 'content' ? 409 : 422);
  }
  assert.equal((await request(`${root}/folders/${a.id}`, 'PATCH', { parentId: c.id })).status, 422);
  assert.equal((await request(`${root}/folders/${a.id}`, 'PATCH', { parentId: a.id })).status, 422);
  assert.equal((await request(`${root}/folders/${b.id}`, 'PATCH', { parentId: testFolder.id })).status, 422);
  assert.equal((await request(`${root}/folders/${b.id}`, 'PATCH', { name: 'A', parentId: null })).status, 409);
  assert.equal((await request(`${root}/folders/${other.id}`, 'PATCH', { name: 'X' })).status, 404);
  assert.equal((await request(`${root}/folders/${b.id}`, 'PATCH', {})).status, 422);
  assert.equal((await json(`${root}/folders/${c.id}`, 'PATCH', { name: 'Renamed', parentId: null })).name, 'Renamed');
  for (const [type, item, folderId] of [['book', 'b', b.id], ['chapterVideo', 'v', a.id], ['test', 't', testFolder.id]]) {
    assert.deepEqual(await json(`${root}/workspace-items/${type}/${item}`, 'PATCH', { folderId }), { id: item, type, folderId });
  }
  assert.equal((await request(`${root}/workspace-items/test/t`, 'PATCH', { folderId: a.id })).status, 422);
  assert.equal((await request(`${root}/workspace-items/book/b`, 'PATCH', { folderId: other.id })).status, 422);
  assert.equal((await request(`${root}/workspace-items/test/other`, 'PATCH', { folderId: null })).status, 404);
  assert.equal((await request(`${root}/workspace-items/bad/b`, 'PATCH', { folderId: null })).status, 422);
  assert.equal((await request(`${root}/workspace-items/book/b`, 'PATCH', {})).status, 422);
  const content = await json(`${root}/workspace?kind=content`);
  assert.deepEqual(content.folders.map(f => f.name), ['A', 'B', 'Renamed']);
  assert.deepEqual(content.items, [{ id: 'b', title: 'Book', folderId: b.id, type: 'book' }, { id: 'v', title: 'Video', folderId: a.id, type: 'chapterVideo' }]);
  const tests = await json(`${root}/workspace?kind=tests`);
  assert.deepEqual(tests.folders, [testFolder]);
  assert.deepEqual(tests.items, [{ id: 't', title: 'Test', folderId: testFolder.id, type: 'test' }]);
  const detail = await json('/courses/one');
  assert.equal(detail.folders.length, 4);
  assert.equal(detail.books[0].folderId, b.id);
  assert.equal(detail.videos[0].folderId, a.id);
  assert.equal(detail.tests[0].folderId, testFolder.id);
  assert.equal((await request('/courses/one', 'GET', undefined, 'student')).status, 403);
  db.prepare("INSERT INTO orders (id,uid,course,amount,payment,payment_status) VALUES ('order','student','one',100,'paid','approved')").run();
  const studentDetail = await (await request('/courses/one', 'GET', undefined, 'student')).json();
  assert.deepEqual(studentDetail.folders, detail.folders);
  assert.equal(studentDetail.books[0].folderId, b.id);
  await json(`${root}/workspace-items/book/b`, 'PATCH', { folderId: null });
  assert.equal((await json('/courses/one')).books[0].folderId, null);
  const edited = await request('/admin/published/tests/t', 'PUT', {
    course: 'two', title: 'Test', questions: [{ prompt: 'Question?', options: ['A', 'B'], answer: 0 }],
    questionPaperDownload: false,
  });
  assert.equal(edited.status, 204, await edited.text());
  assert.equal(db.prepare("SELECT folder_id FROM tests WHERE id='t'").get().folder_id, null);
  assert.equal((await request('/admin/published/courses/two', 'DELETE')).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM course_folders WHERE course='two'").get().count, 0);
});

test('legacy SQLite databases migrate and retain workspace data after reopening', t => {
  const path = `.workspace-test-${randomUUID()}.sqlite`;
  t.after(() => { for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true }); });
  const old = new DatabaseSync(path);
  old.exec(`
    CREATE TABLE students (uid TEXT PRIMARY KEY, phone TEXT NOT NULL, name TEXT NOT NULL DEFAULT '') STRICT;
    CREATE TABLE courses (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, price INTEGER NOT NULL) STRICT;
    CREATE TABLE orders (id TEXT PRIMARY KEY, uid TEXT NOT NULL REFERENCES students, course TEXT NOT NULL REFERENCES courses,
      amount INTEGER NOT NULL, payment TEXT UNIQUE, UNIQUE (uid, course)) STRICT;
    CREATE TABLE tests (id TEXT PRIMARY KEY, course TEXT NOT NULL REFERENCES courses, title TEXT NOT NULL, questions TEXT NOT NULL) STRICT;
    CREATE TABLE books (id TEXT PRIMARY KEY, course TEXT NOT NULL REFERENCES courses, title TEXT NOT NULL, pages INTEGER NOT NULL, pdf BLOB NOT NULL) STRICT;
    CREATE TABLE chapter_videos (id TEXT PRIMARY KEY, course TEXT NOT NULL REFERENCES courses, title TEXT NOT NULL, subject TEXT NOT NULL, chapter TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL, created_at TEXT NOT NULL) STRICT;
    INSERT INTO courses VALUES ('c','Course','Description',100);
    INSERT INTO students VALUES ('s','+919000000001','');
    INSERT INTO orders VALUES ('o','s','c',100,'legacy-paid');
    INSERT INTO tests VALUES ('t','c','Test','[]');
  `);
  old.close();
  let db = openDatabase(path);
  assert.equal(db.prepare("SELECT payment_status FROM orders WHERE id='o'").get().payment_status, 'approved');
  db.prepare("UPDATE orders SET payment_status='rejected' WHERE id='o'").run();
  assert.equal(db.prepare("SELECT folder_id FROM tests WHERE id='t'").get().folder_id, null);
  db.prepare("INSERT INTO course_folders VALUES ('f','c','tests','Folder',NULL)").run();
  db.prepare("UPDATE tests SET folder_id='f' WHERE id='t'").run();
  db.close();
  db = openDatabase(path);
  assert.equal(db.prepare("SELECT payment_status FROM orders WHERE id='o'").get().payment_status, 'rejected');
  assert.equal(db.prepare("SELECT folder_id FROM tests WHERE id='t'").get().folder_id, 'f');
  assert.equal(db.prepare("SELECT name FROM course_folders WHERE id='f'").get().name, 'Folder');
  db.close();
});
