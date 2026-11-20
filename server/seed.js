import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDatabase } from './database.js';

function pdf(lines) {
  const escaped = lines.map(line => line.replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)'));
  const stream = `BT /F1 14 Tf 48 740 Td 22 TL ${escaped.map(line => `(${line}) Tj T*`).join('\n')} ET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let contents = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(contents);
    contents += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  return Buffer.from(`${contents}xref\n0 6\n0000000000 65535 f \n${offsets.join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${Buffer.byteLength(contents)}\n%%EOF\n`);
}

const courses = [
  {
    id: 'sample-bank-exam',
    title: 'Bank Exam Mission 2027',
    description: 'Focused preparation for banking selections with quantitative aptitude, reasoning, English, and current-affairs practice.',
    price: 14900,
    test: 'Banking Foundation Mock 01',
    questions: [
      { prompt: 'What is 25% of 480?', options: ['100', '120', '140', '160'], answer: 1 },
      { prompt: 'Choose the synonym of concise.', options: ['Lengthy', 'Brief', 'Complex', 'Unclear'], answer: 1 },
      { prompt: 'If all roses are flowers and some flowers fade, which conclusion is certain?', options: ['All roses fade', 'Some roses fade', 'Some flowers are roses', 'No conclusion'], answer: 2 },
      { prompt: 'A sum of ₹2,000 earns ₹200 simple interest in 2 years. What is the annual rate?', options: ['2%', '4%', '5%', '10%'], answer: 2 },
      { prompt: 'Which is a prime number?', options: ['21', '27', '29', '33'], answer: 2 },
    ],
    book: 'Banking Mission Starter Guide',
  },
  {
    id: 'sample-ssc-exam',
    title: 'SSC Selection Mission 2027',
    description: 'A practical SSC preparation bundle covering mathematics, reasoning, English, and general awareness.',
    price: 12900,
    test: 'SSC Foundation Mock 01',
    questions: [
      { prompt: 'What is the square root of 1764?', options: ['38', '40', '42', '44'], answer: 2 },
      { prompt: 'Choose the correctly spelled word.', options: ['Accomodation', 'Accommodation', 'Acommodation', 'Accommadation'], answer: 1 },
      { prompt: 'Complete the series: 2, 6, 12, 20, ?', options: ['24', '28', '30', '32'], answer: 2 },
      { prompt: 'Who is known as the Father of the Indian Constitution?', options: ['Mahatma Gandhi', 'B. R. Ambedkar', 'Sardar Patel', 'Jawaharlal Nehru'], answer: 1 },
      { prompt: 'What is the HCF of 18 and 24?', options: ['3', '6', '8', '12'], answer: 1 },
    ],
    book: 'SSC Mission Starter Guide',
  },
  {
    id: 'sample-railway-exam',
    title: 'Railway Selection Mission 2027',
    description: 'Build speed and accuracy for railway exams with arithmetic, reasoning, science, and general-awareness practice.',
    price: 9900,
    test: 'Railway Foundation Mock 01',
    questions: [
      { prompt: 'A train travels 120 km in 2 hours. What is its speed?', options: ['40 km/h', '50 km/h', '60 km/h', '80 km/h'], answer: 2 },
      { prompt: 'Water freezes at what temperature under standard conditions?', options: ['0°C', '10°C', '32°C', '100°C'], answer: 0 },
      { prompt: 'Find the odd one out.', options: ['Mercury', 'Venus', 'Mars', 'Moon'], answer: 3 },
      { prompt: '15 × 18 equals?', options: ['240', '260', '270', '280'], answer: 2 },
      { prompt: 'Which gas is most abundant in Earth’s atmosphere?', options: ['Oxygen', 'Carbon dioxide', 'Nitrogen', 'Hydrogen'], answer: 2 },
    ],
    book: 'Railway Mission Starter Guide',
  },
];

const resources = [
  ['current-affairs', 'sample-current-affairs', 'Current Affairs Study Plan: November 2026',
    'A focused revision structure for national, international, economy, science, and sports updates.',
    'Revise the last 30 days of updates. Note economic announcements, schemes, science, awards, and sports. Attempt a weekly quiz.'],
  ['free-tests', 'sample-free-test', 'Free General Aptitude Practice',
    'A compact practice set to begin your Mission Selection journey.',
    '1. 25% of 480 = 120.\n2. 2, 6, 12, 20, 30.\n3. Synonym of concise: Brief.\n4. HCF of 18 and 24: 6.'],
  ['pyqs', 'sample-pyq', 'How to revise previous-year questions',
    'A repeatable method for turning PYQs into an accurate revision system.',
    'Group PYQs by topic. Solve without notes, mark confidence, review weak topics, and repeat after 48 hours.'],
  ['syllabus', 'sample-syllabus', 'SSC and Banking Foundation Syllabus',
    'Core topics for quantitative aptitude, reasoning, English, and general awareness.',
    'Quantitative Aptitude; Reasoning; English; General Awareness and current affairs.'],
];

export function seedCatalog(databasePath) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = openDatabase(databasePath);
  try {
    db.exec('BEGIN');
    try {
      const now = new Date().toISOString();
      for (const course of courses) {
        db.prepare(`INSERT INTO courses (id, title, description, price, created_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET title=excluded.title, description=excluded.description, price=excluded.price`)
          .run(course.id, course.title, course.description, course.price, now);
        db.prepare(`INSERT INTO tests (id, course, title, questions, created_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET title=excluded.title, questions=excluded.questions`)
          .run(`${course.id}-test-01`, course.id, course.test, JSON.stringify(course.questions), now);
        db.prepare(`INSERT INTO books (id, course, title, pages, pdf, subject, chapter, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET title=excluded.title, pages=excluded.pages, pdf=excluded.pdf,
            subject=excluded.subject, chapter=excluded.chapter`)
          .run(`${course.id}-book-01`, course.id, course.book, 1, pdf([
            'MISSION SELECTION',
            '',
            course.book,
            '',
            'Welcome to your preparation mission.',
            'Use this guide with the accompanying mock test.',
            'Study consistently, review mistakes, and track progress.',
            '',
            'This page is protected with your verified mobile number.',
          ]), 'Foundation', 'Chapter 1: Getting Started', now);
      }
      for (const [kind, id, title, summary, body] of resources) {
        db.prepare(`INSERT INTO resources VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (id) DO UPDATE SET title=excluded.title, summary=excluded.summary, body=excluded.body`)
          .run(id, kind, title, summary, body, now, now.slice(0, 10));
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  } finally {
    db.close();
  }
}

if (process.argv[1]?.endsWith('seed.js')) {
  const path = process.env.DATA_DIR ? `${process.env.DATA_DIR}/mock-master.sqlite` : './data/mock-master.sqlite';
  seedCatalog(path);
  console.log(`Seeded ${courses.length} sample preparation missions in ${path}.`);
}
