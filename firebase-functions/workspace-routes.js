import { folderBody, folderSubtree, folderView, idInput, itemFolderBody, itemTypeInput, kindInput, validateFolder, validateItemFolder } from './workspace.js';
import { fail } from './documents.js';

export function registerWorkspaceRoutes(api, { db, bucket, value, course }) {
  const foldersFor = id => db.collection('courseFolders').where('course', '==', id);
  const readFolders = snapshot => snapshot.docs.map(value).map(folderView);
  const mutate = (id, operation) => db.runTransaction(async tx => {
    idInput(id);
    const courseRef = db.collection('courses').doc(id);
    const selected = await tx.get(courseRef);
    if (!selected.exists) fail(404, 'Course not found.');
    const folders = readFolders(await tx.get(foldersFor(id)));
    const result = await operation(tx, folders);
    // All folder and item moves for a course contend on this document.
    tx.update(courseRef, { workspaceVersion: (selected.data().workspaceVersion || 0) + 1 });
    return result;
  });

  api.get('/admin/courses/:id/workspace', async (req, res) => {
    const { id } = await course(idInput(req.params.id));
    const kind = kindInput(req.query.kind);
    const types = kind === 'tests' ? ['test'] : ['book', 'chapterVideo'];
    const [folderSnapshot, ...snapshots] = await Promise.all([
      foldersFor(id).get(),
      ...types.map(type => db.collection(itemTypeInput(type).collection).where('course', '==', id).get()),
    ]);
    const items = snapshots.flatMap((snapshot, index) => snapshot.docs.map(value)
      .map(item => ({ id: item.id, title: item.title, type: types[index], folderId: item.folderId ?? null })));
    res.json({ folders: readFolders(folderSnapshot).filter(folder => folder.kind === kind), items });
  });

  api.post('/admin/courses/:id/folders', async (req, res) => {
    const input = folderBody(req.body, true);
    const ref = db.collection('courseFolders').doc();
    const folder = { id: ref.id, ...input };
    await mutate(req.params.id, async (tx, folders) => {
      validateFolder(folders, folder);
      tx.create(ref, { course: req.params.id, ...input });
    });
    res.status(201).json(folderView(folder));
  });

  api.patch('/admin/courses/:id/folders/:folderId', async (req, res) => {
    idInput(req.params.folderId);
    const patch = folderBody(req.body);
    const folder = await mutate(req.params.id, async (tx, folders) => {
      const current = folders.find(item => item.id === req.params.folderId);
      if (!current) fail(404, 'Folder not found.');
      const updated = { ...current, ...patch };
      validateFolder(folders, updated);
      tx.update(db.collection('courseFolders').doc(current.id), patch);
      return updated;
    });
    res.json(folderView(folder));
  });

  api.delete('/admin/courses/:id/folders/:folderId', async (req, res) => {
    idInput(req.params.folderId);
    const objects = await mutate(req.params.id, async (tx, folders) => {
      const { root, ids } = folderSubtree(folders, req.params.folderId);
      if (root.kind !== 'content') fail(422, 'Only course content folders can be deleted here.');
      const snapshots = await Promise.all(['books', 'chapterVideos'].map(name =>
        tx.get(db.collection(name).where('course', '==', req.params.id))));
      const records = snapshots.flatMap((snapshot, index) => snapshot.docs
        .filter(doc => ids.has(doc.data().folderId)).map(doc => ({ doc, type: index === 0 ? 'book' : 'video' })));
      if (ids.size + records.length + 1 > 500) fail(409, 'This folder contains too many items to delete at once. Delete smaller subfolders first.');
      const files = records.map(({ doc, type }) => {
        const item = doc.data();
        return type === 'book' ? item.pdfFile || `books/${doc.id}.pdf` :
          item.mediaFile || `chapter-videos/${doc.id}`;
      });
      for (const { doc } of records) tx.delete(doc.ref);
      for (const id of ids) tx.delete(db.collection('courseFolders').doc(id));
      return files;
    });
    let warning = '';
    for (const object of objects) {
      try {
        await bucket.file(object).delete({ ignoreNotFound: true });
      } catch (error) {
        console.error('Folder media cleanup failed:', object, error.code);
        warning = 'The folder was deleted, but some stored files could not be removed.';
      }
    }
    res.json({ deleted: true, ...(warning ? { warning } : {}) });
  });

  api.patch('/admin/courses/:id/workspace-items/:type/:itemId', async (req, res) => {
    idInput(req.params.itemId);
    const type = itemTypeInput(req.params.type);
    const folderId = itemFolderBody(req.body);
    const ref = db.collection(type.collection).doc(req.params.itemId);
    await mutate(req.params.id, async (tx, folders) => {
      const item = value(await tx.get(ref));
      if (!item || item.course !== req.params.id) fail(404, 'Item not found.');
      validateItemFolder(folders, folderId, type.kind);
      tx.update(ref, { folderId });
    });
    res.json({ id: req.params.itemId, type: req.params.type, folderId });
  });
}
