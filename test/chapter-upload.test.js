import assert from 'node:assert/strict';
import test from 'node:test';
import {uploadChapterVideo} from '../public/assets/chapter-upload.js';

test('chapter upload preserves folder placement for local and signed uploads', async () => {
  const placement = {title: 'Lesson', subject: 'Maths', chapter: 'One', folderId: 'folder'};
  const file = {name: 'lesson.mp4', type: 'video/mp4', size: 12};
  const ctx = {signal: new AbortController().signal};
  const calls = [];
  const post = async (path, body) => {
    calls.push({path, body});
    return calls.length === 1 ? {direct: true} : {};
  };
  await uploadChapterVideo({ctx, post, coursePath: '/admin/courses/c', placement, file});
  assert.equal(calls[0].body.json.folderId, 'folder');
  assert.equal(new URLSearchParams(calls[1].path.split('?')[1]).get('folderId'), 'folder');
  assert.equal(calls[1].body.binary, file);

  const originalFetch = globalThis.fetch;
  try {
    calls.length = 0;
    globalThis.fetch = async (url, options) => {
      assert.equal(url, 'https://storage.example/video');
      assert.equal(options.body, file);
      return {ok: true};
    };
    const cloudPost = async (path, body) => {
      calls.push({path, body});
      return calls.length === 1 ? {id: 'video', url: 'https://storage.example/video', headers: {}} : {};
    };
    let publishing = false;
    await uploadChapterVideo({ctx, post: cloudPost, coursePath: '/admin/courses/c', placement, file,
      onPublish: () => { publishing = true; }});
    assert.equal(calls[0].body.json.folderId, 'folder');
    assert.equal(calls[1].path, '/admin/courses/c/videos/video/publish');
    assert.equal(publishing, true);
    globalThis.fetch = async () => ({ok: false, status: 500});
    calls.length = 0;
    await assert.rejects(uploadChapterVideo({ctx, post: cloudPost, coursePath: '/admin/courses/c', placement, file}),
      /could not be uploaded \(500\)/);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
