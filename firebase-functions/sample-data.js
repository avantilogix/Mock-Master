import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const sampleCourses = [
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

export const sampleResources = [
  {
    kind: 'current-affairs', id: 'sample-current-affairs',
    title: 'Current Affairs Study Plan: November 2026',
    summary: 'A focused revision structure for national, international, economy, science, and sports updates.',
    body: '1. Revise the last 30 days of national and international updates.\n2. Note major economic announcements and government schemes.\n3. Make one-line facts for science, technology, awards, and sports.\n4. Attempt a weekly current-affairs quiz and review incorrect answers.',
  },
  {
    kind: 'free-tests', id: 'sample-free-test',
    title: 'Free General Aptitude Practice',
    summary: 'A compact practice set to begin your Mission Selection journey.',
    body: '1. What is 25% of 480? Answer: 120.\n2. Find the next number: 2, 6, 12, 20, __. Answer: 30.\n3. Choose the synonym of concise: Brief.\n4. What is the HCF of 18 and 24? Answer: 6.\n5. A train travels 120 km in 2 hours. Its speed is 60 km/h.',
  },
  {
    kind: 'pyqs', id: 'sample-pyq',
    title: 'How to revise previous-year questions',
    summary: 'A repeatable method for turning PYQs into an accurate revision system.',
    body: 'Group PYQs by topic. Solve them without notes. Mark time taken and confidence. Revisit incorrect topics in your study materials, then attempt a second PYQ set after 48 hours.',
  },
  {
    kind: 'syllabus', id: 'sample-syllabus',
    title: 'SSC and Banking Foundation Syllabus',
    summary: 'Core topics for quantitative aptitude, reasoning, English, and general awareness.',
    body: 'Quantitative Aptitude: number system, percentages, ratio, average, time and work, profit and loss, simple interest.\nReasoning: series, coding-decoding, syllogism, blood relations, seating arrangement.\nEnglish: grammar, vocabulary, reading comprehension, error spotting.\nGeneral Awareness: current affairs, Indian polity, history, geography, economy, science.',
  },
];

export async function sampleBookPdf(title) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  page.drawText('MISSION SELECTION', { x: 52, y: 760, size: 13, font: bold, color: rgb(.13, .20, .48) });
  page.drawText(title, { x: 52, y: 710, size: 26, font: bold, color: rgb(.09, .15, .28) });
  page.drawText('Welcome to your preparation mission.', { x: 52, y: 650, size: 15, font: regular });
  page.drawText('Study consistently, review mistakes, and track progress.', { x: 52, y: 620, size: 13, font: regular });
  page.drawText('Use this guide with the accompanying mock test.', { x: 52, y: 592, size: 13, font: regular });
  return Buffer.from(await pdf.save());
}
