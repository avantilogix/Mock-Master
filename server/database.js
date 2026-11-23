import { DatabaseSync } from 'node:sqlite';

export function openDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys=ON;
    PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS students (
      uid TEXT PRIMARY KEY, phone TEXT NOT NULL, name TEXT NOT NULL DEFAULT ''
    ) STRICT;
    CREATE TABLE IF NOT EXISTS courses (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, price INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY, uid TEXT NOT NULL REFERENCES students, course TEXT NOT NULL REFERENCES courses,
      amount INTEGER NOT NULL, payment TEXT UNIQUE, UNIQUE (uid, course)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS tests (
      id TEXT PRIMARY KEY, course TEXT NOT NULL REFERENCES courses, title TEXT NOT NULL,
      questions TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY, course TEXT NOT NULL REFERENCES courses, title TEXT NOT NULL,
      pages INTEGER NOT NULL, pdf BLOB NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS ebooks (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, price INTEGER NOT NULL,
      pages INTEGER NOT NULL, pdf BLOB NOT NULL, created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS ebook_orders (
      id TEXT PRIMARY KEY, uid TEXT NOT NULL REFERENCES students, ebook TEXT NOT NULL REFERENCES ebooks,
      amount INTEGER NOT NULL, transaction_ref TEXT NOT NULL DEFAULT '', payment_note TEXT NOT NULL DEFAULT '',
      payment TEXT NOT NULL DEFAULT '', payment_status TEXT NOT NULL DEFAULT 'pending',
      review_note TEXT NOT NULL DEFAULT '', submitted_at TEXT NOT NULL, reviewed_at TEXT NOT NULL DEFAULT '',
      reviewed_by TEXT NOT NULL DEFAULT '', UNIQUE (uid, ebook)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY, course TEXT NOT NULL REFERENCES courses,
      uid TEXT NOT NULL REFERENCES students, text TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS reviews (
      course TEXT NOT NULL REFERENCES courses, uid TEXT NOT NULL REFERENCES students,
      rating INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (course, uid)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY, uid TEXT NOT NULL REFERENCES students, text TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS attempts (
      id TEXT PRIMARY KEY, uid TEXT NOT NULL REFERENCES students, course TEXT NOT NULL REFERENCES courses,
      test TEXT NOT NULL REFERENCES tests, title TEXT NOT NULL, score INTEGER NOT NULL, total INTEGER NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS resources (
      id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL,
      body TEXT NOT NULL, created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS schedules (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, day TEXT NOT NULL, starts_at TEXT NOT NULL,
      duration TEXT NOT NULL, description TEXT NOT NULL, created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS physical_books (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, price INTEGER NOT NULL,
      stock INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS physical_orders (
      id TEXT PRIMARY KEY, uid TEXT NOT NULL REFERENCES students, book TEXT NOT NULL REFERENCES physical_books,
      quantity INTEGER NOT NULL, amount INTEGER NOT NULL, transaction_ref TEXT NOT NULL, address TEXT NOT NULL,
      status TEXT NOT NULL, review_note TEXT NOT NULL DEFAULT '', tracking TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS referrals (
      uid TEXT PRIMARY KEY REFERENCES students, code TEXT NOT NULL UNIQUE, referred_by TEXT NOT NULL DEFAULT '',
      credits INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY, value TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS payment_settings (
      id INTEGER PRIMARY KEY CHECK (id=1), upi_id TEXT NOT NULL DEFAULT '',
      payee_name TEXT NOT NULL DEFAULT '', method TEXT NOT NULL DEFAULT 'upi',
      qr BLOB, qr_type TEXT NOT NULL DEFAULT ''
    ) STRICT;
    CREATE TABLE IF NOT EXISTS videos (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL,
      video_id TEXT NOT NULL, course TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS chapter_videos (
      id TEXT PRIMARY KEY, course TEXT NOT NULL REFERENCES courses, title TEXT NOT NULL,
      subject TEXT NOT NULL, chapter TEXT NOT NULL, type TEXT NOT NULL, size INTEGER NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS student_schedules (
      id TEXT PRIMARY KEY, uid TEXT NOT NULL REFERENCES students, title TEXT NOT NULL, day TEXT NOT NULL,
      starts_at TEXT NOT NULL, duration INTEGER NOT NULL, description TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS exam_sessions (
      id TEXT PRIMARY KEY, uid TEXT NOT NULL REFERENCES students, test TEXT NOT NULL REFERENCES tests,
      started_at TEXT NOT NULL, answers TEXT NOT NULL DEFAULT '[]', marked TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1, UNIQUE (uid, test, id)
    ) STRICT;
    CREATE INDEX IF NOT EXISTS student_schedules_uid ON student_schedules (uid);
  `);
  // Rows created before this column existed keep '' and are shown as "Date not recorded".
  for (const table of ['courses', 'tests', 'books']) {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
    if (!columns.has('created_at')) db.exec(`ALTER TABLE ${table} ADD COLUMN created_at TEXT NOT NULL DEFAULT ''`);
  }
  const orderColumns = new Set(db.prepare('PRAGMA table_info(orders)').all().map(column => column.name));
  if (!orderColumns.has('credits_used')) db.exec('ALTER TABLE orders ADD COLUMN credits_used INTEGER NOT NULL DEFAULT 0');
  if (!orderColumns.has('original_amount')) db.exec('ALTER TABLE orders ADD COLUMN original_amount INTEGER NOT NULL DEFAULT 0');
  const studentColumns = new Set(db.prepare('PRAGMA table_info(students)').all().map(column => column.name));
  if (!studentColumns.has('disabled')) db.exec("ALTER TABLE students ADD COLUMN disabled INTEGER NOT NULL DEFAULT 0");
  const resourceColumns = new Set(db.prepare('PRAGMA table_info(resources)').all().map(column => column.name));
  if (!resourceColumns.has('published_at')) db.exec("ALTER TABLE resources ADD COLUMN published_at TEXT NOT NULL DEFAULT ''");
  const bookColumns = new Set(db.prepare('PRAGMA table_info(books)').all().map(column => column.name));
  if (!bookColumns.has('subject')) db.exec("ALTER TABLE books ADD COLUMN subject TEXT NOT NULL DEFAULT 'General'");
  if (!bookColumns.has('chapter')) db.exec("ALTER TABLE books ADD COLUMN chapter TEXT NOT NULL DEFAULT 'Chapter 1'");
  const testColumns = new Set(db.prepare('PRAGMA table_info(tests)').all().map(column => column.name));
  if (!testColumns.has('live')) db.exec('ALTER TABLE tests ADD COLUMN live INTEGER NOT NULL DEFAULT 0');
  if (!testColumns.has('starts_at')) db.exec("ALTER TABLE tests ADD COLUMN starts_at TEXT NOT NULL DEFAULT ''");
  if (!testColumns.has('duration_minutes')) db.exec('ALTER TABLE tests ADD COLUMN duration_minutes INTEGER NOT NULL DEFAULT 0');
  if (!testColumns.has('expires_at')) db.exec("ALTER TABLE tests ADD COLUMN expires_at TEXT NOT NULL DEFAULT ''");
  if (!testColumns.has('attempts_limit')) db.exec('ALTER TABLE tests ADD COLUMN attempts_limit INTEGER NOT NULL DEFAULT 2');
  if (!testColumns.has('marks_per_question')) db.exec('ALTER TABLE tests ADD COLUMN marks_per_question REAL NOT NULL DEFAULT 1');
  if (!testColumns.has('negative_mark')) db.exec('ALTER TABLE tests ADD COLUMN negative_mark REAL NOT NULL DEFAULT 0');
  if (!testColumns.has('sections')) db.exec("ALTER TABLE tests ADD COLUMN sections TEXT NOT NULL DEFAULT '[]'");
  const attemptColumns = new Set(db.prepare('PRAGMA table_info(attempts)').all().map(column => column.name));
  if (!attemptColumns.has('answers')) db.exec("ALTER TABLE attempts ADD COLUMN answers TEXT NOT NULL DEFAULT '[]'");
  if (!attemptColumns.has('max_marks')) db.exec('ALTER TABLE attempts ADD COLUMN max_marks REAL NOT NULL DEFAULT 0');
  if (!attemptColumns.has('negative')) db.exec('ALTER TABLE attempts ADD COLUMN negative REAL NOT NULL DEFAULT 0');
  if (!attemptColumns.has('elapsed_seconds')) db.exec('ALTER TABLE attempts ADD COLUMN elapsed_seconds INTEGER NOT NULL DEFAULT 0');
  if (!attemptColumns.has('section_scores')) db.exec("ALTER TABLE attempts ADD COLUMN section_scores TEXT NOT NULL DEFAULT '[]'");
  if (!studentColumns.has('exam_preference')) db.exec("ALTER TABLE students ADD COLUMN exam_preference TEXT NOT NULL DEFAULT ''");
  const additions = [
    ['payment_status', "TEXT NOT NULL DEFAULT 'pending'"],
    ['transaction_ref', 'TEXT NOT NULL DEFAULT \'\''],
    ['payment_note', "TEXT NOT NULL DEFAULT ''"],
    ['review_note', "TEXT NOT NULL DEFAULT ''"],
    ['submitted_at', "TEXT NOT NULL DEFAULT ''"],
    ['reviewed_at', "TEXT NOT NULL DEFAULT ''"],
    ['reviewed_by', "TEXT NOT NULL DEFAULT ''"],
  ];
  for (const [name, definition] of additions) {
    if (!orderColumns.has(name)) db.exec(`ALTER TABLE orders ADD COLUMN ${name} ${definition}`);
  }
  db.exec(`UPDATE orders SET payment_status='approved' WHERE payment IS NOT NULL AND payment!='' AND payment_status!='approved'`);
  return db;
}
