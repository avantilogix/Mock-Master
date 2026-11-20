import { DatabaseSync } from 'node:sqlite';

const project = 'mission-selection-ba819';
const bucket = `${project}.firebasestorage.app`;
const token = process.env.FIREBASE_ACCESS_TOKEN;
if (!token) throw new Error('Set FIREBASE_ACCESS_TOKEN for this process.');

function value(input) {
  if (input === null) return { nullValue: null };
  if (typeof input === 'number') return { integerValue: String(input) };
  if (typeof input === 'string') return { stringValue: input };
  if (typeof input === 'boolean') return { booleanValue: input };
  if (Array.isArray(input)) return { arrayValue: { values: input.map(value) } };
  return { mapValue: { fields: fields(input) } };
}

function fields(object) {
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, value(item)]));
}

async function request(url, options, label) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`${label} failed (${response.status}): ${detail.slice(0, 500)}`);
  }
}

async function writeDocument(collection, id, data) {
  const path = `projects/${project}/databases/(default)/documents/${collection}/${encodeURIComponent(String(id))}`;
  await request(`https://firestore.googleapis.com/v1/${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: fields(data) }),
  }, `${collection}/${id}`);
}

async function uploadBook(id, pdf) {
  const url = `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o?uploadType=media&name=${encodeURIComponent(`books/${id}.pdf`)}`;
  await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'private, no-store' },
    body: pdf,
  }, `Storage books/${id}.pdf`);
}

const db = new DatabaseSync('./data/mock-master.sqlite', { readOnly: true });
const createdAt = new Date().toISOString();
try {
  const courses = db.prepare('SELECT * FROM courses').all();
  for (const course of courses) {
    await writeDocument('courses', course.id, { title: course.title, description: course.description, price: course.price, createdAt });
  }

  const tests = db.prepare('SELECT * FROM tests').all();
  for (const test of tests) {
    await writeDocument('tests', test.id, {
      course: test.course, title: test.title, questions: JSON.parse(test.questions), createdAt,
    });
  }

  const books = db.prepare('SELECT * FROM books').all();
  for (const book of books) {
    await uploadBook(book.id, Buffer.from(book.pdf));
    await writeDocument('books', book.id, { course: book.course, title: book.title, pages: book.pages, createdAt });
  }

  for (const student of db.prepare('SELECT * FROM students').all()) {
    await writeDocument('students', student.uid, { phone: student.phone, name: student.name });
  }
  for (const order of db.prepare('SELECT * FROM orders').all()) {
    await writeDocument('orders', order.id, {
      uid: order.uid, course: order.course, amount: order.amount, payment: order.payment || '',
      paymentStatus: order.payment_status, transactionRef: order.transaction_ref, paymentNote: order.payment_note,
      reviewNote: order.review_note, submittedAt: order.submitted_at, reviewedAt: order.reviewed_at,
      reviewedBy: order.reviewed_by, createdAt: order.submitted_at || createdAt,
    });
  }
  for (const message of db.prepare('SELECT * FROM messages').all()) {
    await writeDocument('messages', message.id, {
      course: message.course, uid: message.uid, text: message.text, createdAt,
    });
  }
  for (const review of db.prepare('SELECT * FROM reviews').all()) {
    await writeDocument('reviews', `${review.course}_${review.uid}`, {
      course: review.course, uid: review.uid, rating: review.rating, text: review.text, createdAt,
    });
  }
  for (const ticket of db.prepare('SELECT * FROM tickets').all()) {
    await writeDocument('tickets', ticket.id, { uid: ticket.uid, text: ticket.text, createdAt });
  }
  const resources = db.prepare('SELECT * FROM resources').all();
  for (const resource of resources) {
    await writeDocument('resources', resource.id, {
      kind: resource.kind, title: resource.title, summary: resource.summary, body: resource.body,
      createdAt: resource.created_at,
    });
  }
  console.log(`Migrated ${courses.length} courses, ${tests.length} tests, ${books.length} protected books, and ${resources.length} resources.`);
} finally {
  db.close();
}
