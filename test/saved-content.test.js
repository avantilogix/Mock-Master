import assert from 'node:assert/strict';
import test from 'node:test';
import {openSaved, removeSaved, saveContent, savedItems, savedPart} from '../public/assets/saved-content.js';

function fakeIndexedDB() {
  const stores = new Map();
  const db = {
    createObjectStore(name) { stores.set(name, new Map()); },
    close() {},
    transaction(name) {
      const tx = {error: null};
      tx.objectStore = () => Object.fromEntries(['get', 'getAll', 'put', 'add', 'delete'].map(method => [method, value => {
        const request = {};
        queueMicrotask(() => {
          const store = stores.get(name);
          if (method === 'add' && store.has(value.key)) {
            tx.error = new Error('Already exists');
            tx.onabort();
            return;
          }
          if (method === 'get') request.result = store.get(value);
          if (method === 'getAll') request.result = [...store.values()];
          if (method === 'put' || method === 'add') store.set(value.key, value);
          if (method === 'delete') store.delete(value);
          tx.oncomplete();
        });
        return request;
      }]));
      return tx;
    },
  };
  let created = false;
  return {
    open() {
      const request = {};
      queueMicrotask(() => {
        request.result = db;
        if (!created) { created = true; request.onupgradeneeded(); }
        request.onsuccess();
      });
      return request;
    },
  };
}

test('saved content is account-scoped, revalidated, removed, and cleaned up on failure', async t => {
  const oldDB = globalThis.indexedDB;
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.indexedDB = oldDB; globalThis.fetch = oldFetch; });
  globalThis.indexedDB = fakeIndexedDB();
  let enabled = true;
  let failPage = false;
  globalThis.fetch = async path => {
    if (path === '/api/courses/course') return Response.json({downloadsEnabled: enabled,
      books: [{id: 'book', pages: 2}], videos: []});
    if (path.startsWith('/api/books/book/pages/')) {
      if (failPage && path.endsWith('/2')) return Response.json({error: 'Page unavailable'}, {status: 503});
      return new Response(new Blob([path], {type: 'image/png'}), {headers: {'Content-Type': 'image/png'}});
    }
    throw new Error(`Unexpected request: ${path}`);
  };
  const ctx = {user: {uid: 'buyer', getIdToken: async () => 'token'}, current: () => true};
  const item = {type: 'course-pdf', id: 'book', courseId: 'course', title: 'Book', pages: 2,
    pagePath: '/books/book/pages'};
  await saveContent(ctx, item);
  assert.equal((await savedItems('buyer')).length, 1);
  assert.deepEqual(await savedItems('other'), []);
  const saved = await openSaved(ctx, item.type, item.id);
  assert.equal(await (await savedPart(saved, 2)).text(), '/api/books/book/pages/2');
  enabled = false;
  await assert.rejects(openSaved(ctx, item.type, item.id), /no longer enabled/);
  await removeSaved('buyer', item.type, item.id);
  assert.deepEqual(await savedItems('buyer'), []);
  await assert.rejects(savedPart(saved, 1), /incomplete/);
  enabled = true;
  failPage = true;
  await assert.rejects(saveContent(ctx, item), /Page unavailable/);
  assert.deepEqual(await savedItems('buyer'), []);
});

test('e-books and Current Affairs saves require current server access', async t => {
  const oldDB = globalThis.indexedDB;
  const oldFetch = globalThis.fetch;
  t.after(() => { globalThis.indexedDB = oldDB; globalThis.fetch = oldFetch; });
  globalThis.indexedDB = fakeIndexedDB();
  let approved = true;
  let enabled = true;
  globalThis.fetch = async path => {
    if (path === '/api/ebooks') return Response.json([{id: 'ebook', pages: 1}]);
    if (path === '/api/ebooks/ebook/pages/1') return approved ?
      new Response('page', {headers: {'Content-Type': 'image/png'}}) :
      Response.json({error: 'Purchase approval required'}, {status: 403});
    if (path === '/api/resources/affairs') return Response.json({downloadsEnabled: enabled,
      media: {pdf: {pages: 1}, video: {type: 'video/mp4'}}});
    if (path === '/api/resources/affairs/pdf/pages/1') {
      return new Response('affairs page', {headers: {'Content-Type': 'image/png'}});
    }
    if (path === '/api/resources/affairs/video/link') return Response.json({url: '/video-file'});
    if (path === '/video-file') return new Response('video', {headers: {'Content-Type': 'video/mp4'}});
    throw new Error(`Unexpected request: ${path}`);
  };
  const ctx = {user: {uid: 'buyer', getIdToken: async () => 'token'}, current: () => true};
  const ebook = {type: 'ebook', id: 'ebook', title: 'E-book', pages: 1, pagePath: '/ebooks/ebook/pages'};
  const pdf = {type: 'affairs-pdf', id: 'affairs', title: 'Current Affairs', pages: 1,
    pagePath: '/resources/affairs/pdf/pages'};
  const video = {type: 'affairs-video', id: 'affairs', title: 'Current Affairs',
    videoLink: '/resources/affairs/video/link'};
  await saveContent(ctx, ebook);
  await saveContent(ctx, pdf);
  await saveContent(ctx, video);
  assert.equal(await (await savedPart(await openSaved(ctx, video.type, video.id), 1)).text(), 'video');
  approved = false;
  await assert.rejects(openSaved(ctx, ebook.type, ebook.id), /Purchase approval required/);
  enabled = false;
  await assert.rejects(openSaved(ctx, pdf.type, pdf.id), /no longer available/);
  await assert.rejects(openSaved(ctx, video.type, video.id), /no longer available/);
});
