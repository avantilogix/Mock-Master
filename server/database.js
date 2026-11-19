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
  `);
  return db;
}
