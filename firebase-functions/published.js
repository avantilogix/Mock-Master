import { fail, validateQuestions } from './documents.js';
import { expiryInput } from './publishing-media.js';

function istIso(value, label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    fail(422, `${label} must be a valid IST date and time.`);
  }
  return new Date(`${value}${value.length === 16 ? ':00' : ''}+05:30`).toISOString();
}

export function registerPublishedRoutes(api, { db, bucket, value, text, byNewest, queryCollection, media, affairs }) {
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
    courses: body => {
      if (body.downloadsEnabled !== undefined && typeof body.downloadsEnabled !== 'boolean') {
        fail(422, 'Choose whether course downloads are allowed.');
      }
      return { title: text(body.title, 'Title', 120), description: text(body.description, 'Description', 2000),
        price: price(body.price), downloadsEnabled: body.downloadsEnabled === true,
        ...(body.expiresOn !== undefined ? { expiresOn: expiryInput(body.expiresOn) } : {}) };
    },
    tests: body => {
      if (body.live !== undefined && typeof body.live !== 'boolean') fail(422, 'Choose a valid test type.');
      if (typeof body.questionPaperDownload !== 'boolean') fail(422, 'Choose a valid question paper download option.');
      if ((body.durationMinutes !== undefined && (!Number.isInteger(body.durationMinutes) || body.durationMinutes < 10 || body.durationMinutes > 300)) ||
          (body.marksPerQuestion !== undefined && (!Number.isFinite(body.marksPerQuestion) || body.marksPerQuestion <= 0 || body.marksPerQuestion > 100)) ||
          (body.negativeMark !== undefined && (!Number.isFinite(body.negativeMark) || body.negativeMark < 0 || body.negativeMark > 100))) {
        fail(422, 'Enter valid duration and marking values.');
      }
      return { title: text(body.title, 'Title', 120), questions: validateQuestions(body.questions),
        ...(body.course ? {course: text(body.course, 'Course', 128)} : {}),
        marksPerQuestion: body.marksPerQuestion, negativeMark: body.negativeMark,
        questionPaperDownload: body.questionPaperDownload,
        ...(body.durationMinutes !== undefined ? {durationMinutes: body.durationMinutes} : {}),
        ...(body.marksPerQuestion !== undefined ? {marksPerQuestion: body.marksPerQuestion} : {}),
        ...(body.negativeMark !== undefined ? {negativeMark: body.negativeMark} : {}),
        ...(body.live !== undefined ? {live: body.live} : {}),
        ...(body.startsAt !== undefined ? {startsAt: body.startsAt} : {}),
        ...(body.expiresAt !== undefined ? {expiresAt: body.expiresAt} : {}),
        ...(body.attemptsLimit !== undefined ? {attemptsLimit: body.attemptsLimit} : {})};
    },
    books: chapterFields,
    chapterVideos: chapterFields,
    videos: body => {
      let videoId = '';
      try {
        const parsed = new URL(body.url);
        videoId = parsed.hostname === 'youtu.be' ? parsed.pathname.slice(1).split('/')[0] :
          parsed.hostname.endsWith('youtube.com') ? parsed.searchParams.get('v') ||
            parsed.pathname.split('/').filter(Boolean).at(-1) : '';
      } catch { /* validated below */ }
      if (!/^[A-Za-z0-9_-]{11}$/.test(videoId || '')) fail(422, 'Enter a valid YouTube video URL.');
      return {title: text(body.title, 'Title', 120), description: text(body.description, 'Description', 1000),
        course: typeof body.course === 'string' ? body.course : '', videoId};
    },
    resources(body, existing) {
      if (existing.kind === 'free-tests') fail(404, 'Resource not found.');
      const { publishedAt } = body;
      if (typeof publishedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(publishedAt) ||
          Number.isNaN(Date.parse(publishedAt)) || new Date(publishedAt).toISOString().slice(0, 10) !== publishedAt) {
        fail(422, 'Enter a valid publish date.');
      }
      if (existing.kind === 'current-affairs') {
        if (typeof body.downloadsEnabled !== 'boolean') fail(422, 'Choose whether downloads are allowed.');
        return { title: text(body.title, 'Title', 120), publishedAt, downloadsEnabled: body.downloadsEnabled };
      }
      return {
        title: text(body.title, 'Title', 120),
        summary: body.summary === undefined ? existing.summary || '' : text(body.summary, 'Summary', 300),
        body: body.body === undefined ? existing.body || '' : text(body.body, 'Content', 10_000),
        publishedAt,
      };
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
    const publicCourses = data.courses.filter(item => !item.publicLearning);
    const courseNames = new Map(data.courses.map(item => [item.id, item.title]));
    const withCourse = item => ({ ...item,
      courseTitle: item.resourceId ? 'Current Affairs' : courseNames.get(item.course) || '' });
    const withChapter = item => withCourse({ ...item, subject: item.subject || 'General', chapter: item.chapter || 'Chapter 1' });
    res.json({
      courses: publicCourses.map(item => ({ ...item, enrollments: enrollments(item.id), tests: tests(item.id),
        materials: materials(item.id), linkedVideos: linkedVideos(item.id) })),
      tests: data.tests.map(item => withCourse({ ...item, attempts: results(item.id) })),
      books: data.books.map(withChapter),
      chapterVideos: data.chapterVideos.map(withChapter),
      videos: data.videos.map(withCourse),
      resources: data.resources.filter(item => item.kind !== 'free-tests'),
      physicalBooks: data.physicalBooks.map(item => ({ ...item, orders: orderedBooks(item.id) })),
      schedules: data.schedules.map(item => ({ ...item, startsAt: item.startsAt || item.starts_at,
        createdAt: item.createdAt || item.created_at })),
    });
  });

  api.put('/admin/published/:type/:id', async (req, res) => {
    const type = managed(req.params.type);
    if (type === 'resources') {
      const resource = value(await collection(type).doc(req.params.id).get());
      if (!resource) fail(404, 'Resource not found.');
      if (resource.kind === 'current-affairs' || req.body?.uploadId !== undefined ||
          req.body?.downloadsEnabled !== undefined) return res.json(await affairs.edit(req.params.id, req));
    }
    const ref = collection(type).doc(req.params.id);
    const patch = type === 'resources' ? {} : editors[type](req.body ?? {});
    if (['courses', 'books', 'physicalBooks'].includes(type) && req.body?.images !== undefined) {
      patch.images = await media.validate(req.body.images);
    }
    await db.runTransaction(async tx => {
      const existing = value(await tx.get(ref));
      if (!existing) fail(404, 'Published item not found.');
      if (type === 'resources' && existing.kind === 'free-tests') fail(404, 'Published item not found.');
      if (type === 'resources') Object.assign(patch, editors.resources(req.body ?? {}, existing));
      if (type === 'tests' && patch.live === false) {
        Object.assign(patch, {startsAt: '', expiresAt: '', attemptsLimit: 0});
      }
      if (type === 'tests' && patch.live === true) {
        if (patch.startsAt === undefined || patch.expiresAt === undefined || patch.attemptsLimit === undefined) {
          fail(422, 'Live tests need a start time, expiry time, and attempt limit.');
        }
        patch.startsAt = istIso(patch.startsAt, 'Live start time');
        patch.expiresAt = istIso(patch.expiresAt, 'Live expiry time');
        if (Date.parse(patch.expiresAt) <= Date.parse(patch.startsAt) ||
            !Number.isInteger(patch.attemptsLimit) || patch.attemptsLimit < 1 || patch.attemptsLimit > 100) {
          fail(422, 'Live expiry must be after the start time, with 1–100 attempts allowed.');
        }
      }
      if (type === 'tests' && patch.live === undefined && existing.live && patch.startsAt !== undefined) {
        patch.startsAt = istIso(patch.startsAt, 'Live start time');
        patch.expiresAt = istIso(patch.expiresAt, 'Live expiry time');
        if (Date.parse(patch.expiresAt) <= Date.parse(patch.startsAt) ||
            !Number.isInteger(patch.attemptsLimit) || patch.attemptsLimit < 1 || patch.attemptsLimit > 100) {
          fail(422, 'Live expiry must be after the start time, with 1–100 attempts allowed.');
        }
      }
      if (['videos', 'tests'].includes(type) && patch.course && !(await tx.get(collection('courses').doc(patch.course))).exists) {
        fail(404, 'Course not found.');
      }
      if (type === 'tests' && patch.course && patch.course !== existing.course) patch.folderId = null;
      tx.update(ref, patch);
    });
    res.sendStatus(204);
  });

  api.delete('/admin/published/:type/:id', async (req, res) => {
    const type = managed(req.params.type);
    const { id } = req.params;
    const ref = collection(type).doc(id);
    let object = '';
    const archived = await db.runTransaction(async tx => {
      const existing = value(await tx.get(ref));
      if (!existing) fail(404, 'Published item not found.');
      if (type === 'resources' && existing.kind === 'free-tests') fail(404, 'Published item not found.');
      if (type === 'books') object = existing.pdfFile || `books/${id}.pdf`;
      if (type === 'chapterVideos') object = existing.mediaFile || `chapter-videos/${id}`;
      const has = async (name, field) => !(await tx.get(at(name, field, id).limit(1))).empty;
      if (type === 'resources' && await has('tests', 'resourceId')) {
        fail(409, 'Remove the linked test before deleting this Current Affairs resource.');
      }
      if (type === 'courses') {
        const dependents = await Promise.all(['orders', 'tests', 'books', 'chapterVideos', 'videos'].map(name => has(name, 'course')));
        if (dependents[0]) fail(409, 'This course has purchase requests or enrolments and cannot be deleted.');
        if (dependents.some(Boolean)) fail(409, 'Remove or unlink this course’s published content before deleting it.');
        const folders = await tx.get(at('courseFolders', 'course', id));
        for (const folder of folders.docs) tx.delete(folder.ref);
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
    if (type === 'resources') {
      try {
        await affairs.remove(id);
      } catch (error) {
        console.error('Resource media cleanup failed:', id, error.code);
        return res.json({ deleted: true, archived, warning: 'The resource is unpublished, but its stored files could not be removed.' });
      }
    }
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
