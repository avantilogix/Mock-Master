import { fail } from './documents.js';

export const itemTypes = {
  book: { collection: 'books', table: 'books', kind: 'content' },
  chapterVideo: { collection: 'chapterVideos', table: 'chapter_videos', kind: 'content' },
  test: { collection: 'tests', table: 'tests', kind: 'tests' },
};

export function kindInput(kind) {
  if (kind !== 'content' && kind !== 'tests') fail(422, 'Choose a valid workspace kind.');
  return kind;
}

export function itemTypeInput(type) {
  if (!Object.hasOwn(itemTypes, type)) fail(422, 'Choose a valid workspace item type.');
  return itemTypes[type];
}

export function idInput(id) {
  if (id !== null && (typeof id !== 'string' || !id.trim() || id.length > 128 ||
      id.includes('/') || id === '.' || id === '..')) fail(422, 'Choose a valid folder ID or null.');
  return id;
}

export function folderBody(body, create = false) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).some(key => !(create ? ['kind', 'name', 'parentId'] : ['name', 'parentId']).includes(key)) ||
      (!create && !Object.hasOwn(body, 'name') && !Object.hasOwn(body, 'parentId'))) {
    fail(422, 'Provide valid folder fields.');
  }
  const result = {};
  if (create) result.kind = kindInput(body.kind);
  if (create || Object.hasOwn(body, 'name')) {
    if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120) fail(422, 'Enter a folder name (maximum 120 characters).');
    result.name = body.name.trim();
  }
  if (create || Object.hasOwn(body, 'parentId')) {
    result.parentId = idInput(create && body.parentId === undefined ? null : body.parentId);
  }
  return result;
}

export function itemFolderBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !Object.hasOwn(body, 'folderId')) fail(422, 'Provide a folderId or null.');
  return idInput(body.folderId);
}

export function validateFolder(folders, folder) {
  const byId = new Map(folders.map(item => [item.id, item]));
  if (folder.parentId !== null) {
    let parent = byId.get(folder.parentId);
    if (!parent || parent.kind !== folder.kind) fail(422, 'Parent folder must belong to this course and kind.');
    const seen = new Set([folder.id]);
    while (parent) {
      if (seen.has(parent.id)) fail(422, 'A folder cannot be moved into itself or its descendants.');
      seen.add(parent.id);
      parent = parent.parentId === null ? null : byId.get(parent.parentId);
    }
  }
  if (folders.some(item => item.id !== folder.id && item.kind === folder.kind &&
      item.parentId === folder.parentId && item.name === folder.name)) fail(409, 'A sibling folder already has that name.');
}

export function validateItemFolder(folders, folderId, kind) {
  if (folderId !== null && !folders.some(folder => folder.id === folderId && folder.kind === kind)) {
    fail(422, 'Folder must belong to this course and item kind.');
  }
}

export function validateFolderSnapshot(snapshot, courseId, folderId, kind, value) {
  const folder = snapshot && value(snapshot);
  validateItemFolder(folder && folder.course === courseId ? [folder] : [], folderId, kind);
}

export const folderView = ({ id, name, parentId, kind }) => ({ id, name, parentId: parentId ?? null, kind });
