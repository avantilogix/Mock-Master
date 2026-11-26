import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument } from 'pdf-lib';
import { parseQuestions } from '../firebase-functions/question-import.js';
import { importQuestions, validateQuestions } from '../server/documents.js';
import { questionData } from '../public/assets/question-data.js';

test('imports Gujarati questions, inline choices, and localized answers without changing source digits', () => {
  const questions = parseQuestions(`પ્રશ્ન ૧: ગુજરાતની રાજધાની કઈ છે?
(A) અમદાવાદ (B) ગાંધીનગર
(C) સુરત (D) રાજકોટ
સાચો જવાબ: (B) ગાંધીનગર
પ્રશ્ન ૨. ૧૦ + ૨૦ = ?
(A) ૨૦ (B) ૩૦
જવાબ: (B) ૩૦`);
  assert.equal(questions.length, 2);
  assert.deepEqual(questions.map(question => question.answer), [1, 1]);
  assert.deepEqual(questions[0].options, ['અમદાવાદ', 'ગાંધીનગર', 'સુરત', 'રાજકોટ']);
  assert.equal(questions[1].prompt, '૧૦ + ૨૦ = ?');
  assert.equal(questions[1].questionNumber, '2');
  assert.equal(questions[0].reviewIssues, undefined);
});

test('keeps numbered statements and matching lists within their question and resolves a table key by source number', () => {
  const questions = parseQuestions(`Section 1: Matching
Question
11. Match the following:
1. First statement (a) first item
2. Second statement (b) second item
(A) 1-a, 2-b (B) 1-b, 2-a
પ્રશ્ન ૨૧. નીચેના વિધાનો જુઓ:
૧. પહેલું વિધાન
૨. બીજું વિધાન
(A) માત્ર ૧
(B) ૧ અને ૨
Verified Answer Key
પ્રશ્ન જવાબ પ્રશ્ન જવાબ
૨૧ B ૧૧ A`);
  assert.equal(questions.length, 2);
  assert.match(questions[0].prompt, /1\. First statement \(a\) first item\n2\. Second statement/);
  assert.deepEqual(questions[0].options, ['1-a, 2-b', '1-b, 2-a']);
  assert.equal(questions[0].section, 'Section 1: Matching');
  assert.deepEqual(questions.map(question => question.answer), [0, 1]);
});

test('supports unprefixed numbered questions containing numbered statements', () => {
  const questions = parseQuestions(`1. Choose the true statements:
1. Statement one
2. Statement two
A. One
B. Both
2. Next question?
A. Yes
B. No
Answer Key
1 B 2 A`);
  assert.equal(questions.length, 2);
  assert.match(questions[0].prompt, /2\. Statement two/);
  assert.deepEqual(questions.map(question => question.answer), [1, 0]);
});

test('retains unresolved questions without guessing and blocks unreviewed publishing on client and server', () => {
  const questions = parseQuestions(`1. Missing answer?
A. Yes
B. No
2. Invalid answer?
A. One
B. Two
Answer: F
3. Contradictory answers?
A. First
B. Second
Answer: A
Answer Key
1 B 3 B`);
  assert.deepEqual(questions.map(question => question.answer), [1, null, null]);
  assert.match(questions[1].reviewIssues.join(' '), /invalid or conflicting/);
  assert.match(questions[2].reviewIssues.join(' '), /invalid or conflicting/);
  assert.throws(() => validateQuestions(questions), /review warnings/);
  assert.throws(() => questionData(JSON.stringify(questions)), /needs review/);
  const [missing] = parseQuestions('1. Missing answer?\nA. Yes\nB. No');
  assert.equal(missing.answer, null);
  assert.match(missing.reviewIssues.join(' '), /No correct answer/);
});

test('handles repeated answer-key conflicts, missing choice labels, and missing PDF glyphs explicitly', () => {
  const [question] = parseQuestions('1. A damaged \u0000 question?\n(A) One\n(C) Three\nAnswer Key\n1 A\n1 C');
  assert.equal(question.answer, null);
  assert.match(question.prompt, /\ufffd/);
  assert.match(question.reviewIssues.join(' '), /unreadable/);
  assert.match(question.reviewIssues.join(' '), /labels/);
  const damaged = [{prompt: 'Damaged \ufffd text', options: ['One', 'Two'], answer: 0}];
  assert.throws(() => questionData(JSON.stringify(damaged)), /unreadable text/);
  assert.throws(() => validateQuestions(damaged), {status: 422});
});

test('matches Gujarati choice labels and numeric answers', () => {
  const questions = parseQuestions(`પ્રશ્ન ૧. યોગ્ય જવાબ પસંદ કરો:
(અ) એક (બ) બે (ક) ત્રણ (ડ) ચાર
જવાબ: (ક) ત્રણ
પ્રશ્ન ૨. સાચું પસંદ કરો:
(A) Yes (B) No
Answer: 2`);
  assert.deepEqual(questions.map(question => question.answer), [2, 1]);
  assert.ok(questions.every(question => !question.reviewIssues));
});

test('repairs spacing around Gujarati combining marks without removing word boundaries', () => {
  const [question] = parseQuestions('૧. સ્ થાપના ક્ યારે થઈ?\n(A) પ્ર ાચીન સમય (B) નવો સમય\nજવાબ: (B)');
  assert.equal(question.prompt, 'સ્થાપના ક્યારે થઈ?');
  assert.deepEqual(question.options, ['પ્રાચીન સમય', 'નવો સમય']);
});

test('does not append section headings or a prefixed answer-key heading to the last choice', () => {
  const questions = parseQuestions(`પ્રશ્ન ૧. પહેલો પ્રશ્ન?
(A) એક (B) બે
વિભાગ – ૨: નવો વિભાગ
પ્રશ્ન ૨. બીજો પ્રશ્ન?
(A) ત્રણ (B) ચાર
ચકાસાયેલી ઉત્તરવહી (Verified Answer Key)
1 A 2 B`);
  assert.deepEqual(questions.map(question => question.options), [['એક', 'બે'], ['ત્રણ', 'ચાર']]);
  assert.equal(questions[1].section, 'વિભાગ – ૨: નવો વિભાગ');
});

test('rejoins adjacent PDF text fragments, preserves real word gaps, and reads paired columns', async () => {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawText('1. What is', {x: 40, y: 720, size: 12});
  page.drawText(' two plus two?', {x: 98, y: 720, size: 12});
  page.drawText('(A) Three', {x: 40, y: 690, size: 12});
  page.drawText('(B) Four', {x: 300, y: 690, size: 12});
  page.drawText('Answer: (B) Four', {x: 40, y: 660, size: 12});
  page.drawText('Page 1 of 1', {x: 40, y: 20, size: 10});
  const [question] = await importQuestions(Buffer.from(await pdf.save()), 'pdf');
  assert.equal(question.prompt, 'What is two plus two?');
  assert.deepEqual(question.options, ['Three', 'Four']);
  assert.equal(question.answer, 1);
  assert.equal(question.reviewIssues, undefined);
});
