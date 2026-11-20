import { fail, validateQuestions } from './documents.js';
import { expiryInput } from './publishing-media.js';

export function registerPublishedRoutes(api, { db, bucket, value, text, byNewest, queryCollection, media }) {
  const collection = name => db.collection(name);
  const at = (name, field, id) => collection(name).where(field, '==', id);
  const price = amount => {
    if (!Number.isInteger(amount) || amount < 100 || amount > 10_000_000) fail(422, 'Enter a valid price in paise.');
    return amount;
  };
  const chapterFields = body => ({
    title: text(body.title, 'Title', 120),
    subject: text(body.subject, 'Subject', 100),
    chapter: text(body.chapter, 'Chapter', 120),
  });
  const editors = {
    courses: body => ({ title: text(body.title, 'Title', 120), description: text(body.description, 'Description', 2000),
      price: price(body.price), ...(body.expiresOn !== undefined ? { expiresOn: expiryInput(body.expiresOn) } : {}) }),
    tests: body => ({ title: text(body.title, 'Title', 120), questions: validateQuestions(body.questions) }),
    books: chapterFields,
    chapterVideos: chapterFields,
    videos: body => ({ title: text(body.title, 'Title', 120), description: text(body.description, 'Description', 1000),
      course: typeof body.course === 'string' ? body.course : '' }),
    resources(body) {
      const { publishedAt } = body;
      if (typeof publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt) ||
          Number.isNaN(Date.parse(publishedAt)) || new Date(publishedAt).toISOString().slice(0, 10) !== publishedAt) {
        fail(422, 'Enter a valid publish date.');
      }
      return { title: text(body.title, 'Title', 120), summary: text(body.summary, 'Summary', 300),
        body: text(body.body, 'Content', 10_000), publishedAt };
    },
    physicalBooks(body) {
      if (!Number.isInteger(body.stock) || body.stock < 0 || body.stock > 10000 || typeof body.active !== 'boolean') {
        fail(422, 'Enter a valid stock count and store visibility.');
      }
      return { title: text(body.title, 'Title', 120), description: text(body.description, 'Description', 2000),
        price: price(body.price), stock: body.stock, active: body.active };
    },
    schedules: body => ({
      title: text(body.title, 'Title', 120), day: text(body.day, 'Day', 20),
      startsAt: text(body.startsAt, 'Start time', 20), duration: text(body.duration, 'Duration', 30),
      description: text(body.description, 'Description', 1000),
    }),
  };
  const keys = Object.keys(editors);
  const managed = type => Object.hasOwn(editors, type) ? type : fail(404, 'Content type not found.');
  const tally = (rows, key) => {
    const counts = new Map();
    for (const row of rows) counts.set(row[key], (counts.get(row[key]) || 0) + 1);
    return id => counts.get(id) || 0;
  };
  api.get('/admin/published', async (_req, res) => {
    const [lists, orders, attempts, physicalOrders] = await Promise.all([
      Promise.all(keys.map(key => queryCollection(key))), queryCollection('orders'),
      queryCollection('attempts'), queryCollection('physicalOrders'),
    ]);
    const data = Object.fromEntries(keys.map((key, index) => [key, lists[index].sort(byNewest)]));
    const enrollments = tally(orders, 'course');
    const results = tally(attempts, 'test');
    const orderedBooks = tally(physicalOrders, 'book');
    const tests = tally(data.tests, 'course');
    const materials = tally([...data.books, ...data.chapterVideos], 'course');
    const linkedVideos = tally(data.videos, 'course');
    const courseNames = new Map(data.courses.map(item => [item.id, item.title]));
    const withCourse = item => ({ ...item, courseTitle: courseNames.get(item.course) || '' });
    const withChapter = item => withCourse({ ...item, subject: item.subject || 'General', chapter: item.chapter || 'Chapter 1' });
    res.json({
      courses: data.courses.map(item => ({ ...item, enrollments: enrollments(item.id), tests: tests(item.id),
        materials: materials(item.id), linkedVideos: linkedVideos(item.id) })),
      tests: data.tests.map(item => withCourse({ ...item, attempts: results(item.id) })),
      books: data.books.map(withChapter),
      chapterVideos: data.chapterVideos.map(withChapter),
      videos: data.videos.map(withCourse),
      resources: data.resources,
      physicalBooks: data.physicalBooks.map(item => ({ ...item, orders: orderedBooks(item.id) })),
      schedules: data.schedules.map(item => ({ ...item, startsAt: item.startsAt || item.starts_at,
        createdAt: item.createdAt || item.created_at })),
    });
  });

  api.put('/admin/published/:type/:id', async (req, res) => {
    const type = managed(req.params.type);
    const ref = collection(type).doc(req.params.id);
    const patch = editors[type](req.body ?? {});
    if (['courses', 'books', 'physicalBooks'].includes(type) && req.body?.images !== undefined) {
      patch.images = await media.validate(req.body.images);
    }
    await db.runTransaction(async tx => {
      if (!(await tx.get(ref)).exists) fail(404, 'Published item not found.');
      if (type === 'videos' && patch.course && !(await tx.get(collection('courses').doc(patch.course))).exists) {
        fail(404, 'Course not found.');
      }
      tx.update(ref, patch);
    });
    res.sendStatus(204);
  });

  api.delete('/admin/published/:type/:id', async (req, res) => {
    const type = managed(req.params.type);
    const { id } = req.params;
    const ref = collection(type).doc(id);
    const archived = await db.runTransaction(async tx => {
      if (!value(await tx.get(ref))) fail(404, 'Published item not found.');
      const has = async (name, field) => !(await tx.get(at(name, field, id).limit(1))).empty;
      if (type === 'courses') {
        const dependents = await Promise.all(['orders', 'tests', 'books', 'chapterVideos', 'videos'].map(name => has(name, 'course')));
        if (dependents[0]) fail(409, 'This course has purchase requests or enrolments and cannot be deleted.');
        if (dependents.some(Boolean)) fail(409, 'Remove or unlink this course’s published content before deleting it.');
      }
      if (type === 'tests' && await has('attempts', 'test')) {
        fail(409, 'This test has student results and cannot be deleted.');
      }
      if (type === 'physicalBooks' && await has('physicalOrders', 'book')) {
        tx.update(ref, { active: false });
        return true;
      }
      tx.delete(ref);
      return false;
    });
    const object = type === 'books' ? `books/${id}.pdf` : type === 'chapterVideos' ? `chapter-videos/${id}` : '';
    if (object) {
      try {
        await bucket.file(object).delete({ ignoreNotFound: true });
      } catch (error) {
        console.error('Published media cleanup failed:', object, error.code);
        return res.json({ deleted: true, archived, warning: 'The item is unpublished, but its stored file could not be removed.' });
      }
    }
    res.json({ deleted: !archived, archived });
  });
}
