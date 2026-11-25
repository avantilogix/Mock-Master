import {api} from './services.js';
import {button, el, link, run, say, status} from './ui.js';

const database = () => new Promise((resolve, reject) => {
  const request = indexedDB.open('mission-selection-saved-content', 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('items', {keyPath: 'key'});
    request.result.createObjectStore('files', {keyPath: 'key'});
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
  request.onblocked = () => reject(new Error('Saved content storage is blocked. Close other app tabs and retry.'));
});

async function operation(store, mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = action(tx.objectStore(store));
      tx.oncomplete = () => resolve(request.result);
      tx.onabort = () => reject(tx.error || new Error('Saved content storage failed.'));
      tx.onerror = () => {};
    });
  } finally { db.close(); }
}

const keyFor = (uid, type, id) => JSON.stringify([uid, type, id]);
const partKey = (key, page) => JSON.stringify([key, page]);

export async function savedItems(uid) {
  return (await operation('items', 'readonly', store => store.getAll())).filter(item => item.uid === uid);
}

export async function removeSaved(uid, type, id) {
  const key = keyFor(uid, type, id);
  const item = await operation('items', 'readonly', store => store.get(key));
  if (!item) return;
  for (let page = 1; page <= item.parts; page++) {
    await operation('files', 'readwrite', store => store.delete(partKey(key, page)));
  }
  await operation('items', 'readwrite', store => store.delete(key));
}

export async function saveContent(ctx, item, onProgress = () => {}) {
  if (!ctx.user?.uid) throw new Error('Sign in before saving content.');
  if (item.pagePath && (!Number.isSafeInteger(item.pages) || item.pages < 1 || item.pages > 500)) {
    throw new Error('The PDF page count is invalid.');
  }
  const uid = ctx.user.uid;
  const key = keyFor(uid, item.type, item.id);
  const existing = (await savedItems(uid)).find(entry => entry.key === key);
  if (existing) throw new Error('This item is already saved in Downloads.');
  const parts = item.pages || 1;
  const metadata = {...item, uid, key, parts};
  await operation('items', 'readwrite', store => store.add({...metadata, incomplete: true}));
  try {
    for (let page = 1; page <= parts; page++) {
      onProgress(page, parts);
      let blob;
      if (item.pagePath) {
        blob = await api(`${item.pagePath}/${page}`, {ctx, auth: true, image: true});
      } else if (item.downloadPath) {
        blob = await api(item.downloadPath, {ctx, auth: true, blob: true});
      } else {
        const {url} = await api(item.videoLink, {ctx, auth: true});
        const response = await fetch(url, {signal: ctx.signal, credentials: 'omit', redirect: 'error'});
        if (!response.ok) throw new Error(`Video download failed (${response.status}).`);
        blob = await response.blob();
      }
      if (!ctx.current()) throw new DOMException('Request cancelled', 'AbortError');
      await operation('files', 'readwrite', store => store.put({key: partKey(key, page), blob}));
    }
    await validateAccess(ctx, metadata);
    await operation('items', 'readwrite', store => store.put(metadata));
  } catch (error) {
    try { await removeSaved(uid, item.type, item.id); }
    catch (cleanupError) {
      throw new Error(`Saving failed: ${error.message}. Cleanup also failed: ${cleanupError.message}`);
    }
    throw error;
  }
}

export async function openSaved(ctx, type, id) {
  const key = keyFor(ctx.user.uid, type, id);
  const item = await operation('items', 'readonly', store => store.get(key));
  if (!item || item.incomplete) throw new Error('Saved item is incomplete or unavailable. Remove it and save it again.');
  await validateAccess(ctx, item);
  return item;
}

async function validateAccess(ctx, item) {
  const {type, id} = item;
  if (type === 'course-pdf' || type === 'course-video') {
    const course = await api(`/courses/${encodeURIComponent(item.courseId)}`, {ctx, auth: true});
    if (!course.downloadsEnabled) throw new Error('Downloads are no longer enabled for this course.');
    const entries = type === 'course-pdf' ? course.books : course.videos;
    const entry = entries?.find(entry => String(entry.id) === id);
    if (!entry || (type === 'course-pdf' && entry.pages !== item.parts)) {
      throw new Error('This item is no longer available or has changed.');
    }
  } else if (type === 'ebook') {
    const books = await api('/ebooks', {ctx});
    const book = books.find(entry => String(entry.id) === id);
    if (!book || book.pages !== item.parts) throw new Error('This e-book is no longer available or has changed.');
    await api(`/ebooks/${encodeURIComponent(id)}/pages/1`, {ctx, auth: true, image: true});
  } else if (type === 'affairs-pdf' || type === 'affairs-video') {
    const resource = await api(`/resources/${encodeURIComponent(id)}`, {ctx, auth: true});
    const media = resource.media?.[type === 'affairs-pdf' ? 'pdf' : 'video'];
    if (!resource.downloadsEnabled || !media || (type === 'affairs-pdf' && media.pages !== item.parts)) {
      throw new Error('This resource is no longer available for download.');
    }
  } else if (type === 'test-pdf' || type === 'test-result-pdf') {
    await api(item.validatePath, {ctx, auth: true, blob: true});
  } else throw new Error('Unknown saved content type.');
}

export async function savedPart(item, page) {
  const entry = await operation('files', 'readonly', store => store.get(partKey(item.key, page)));
  if (!entry?.blob) throw new Error('This saved content is incomplete. Remove it and save it again.');
  return entry.blob;
}

export function saveControl(ctx, item) {
  const control = button('Save to Downloads', 'secondary');
  const feedback = status();
  control.addEventListener('click', () => run(control, feedback, async () => {
    await saveContent(ctx, item, (page, total) => say(feedback,
      item.pages ? `Saving page ${page} of ${total}…` : 'Saving video…'));
    say(feedback, 'Saved inside the app. Open it from Downloads.');
  }, 'Preparing download…'));
  return el('div', {class: 'saved-content-action'}, control, feedback, link('Open Downloads', '#downloads'));
}
