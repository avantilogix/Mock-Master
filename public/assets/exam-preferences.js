import {el} from './ui.js';

export const examOptions = [
  'CCE', 'TET 1', 'TET 2', 'TAT S - HS', 'PSI - Constable',
  'Panchayat Talati - Clerk', 'Technical Exams', 'GPSC STI - Dyso', 'Other Exams',
];

export function normalizeExamPreferences(value) {
  const values = Array.isArray(value) ? value :
    typeof value === 'string' ? value.split(',').map(item => item.trim()).filter(Boolean) : [];
  return [...new Set(values.filter(item => examOptions.includes(item)))];
}

export function examPreferenceField(selected = []) {
  const values = new Set(normalizeExamPreferences(selected));
  const boxes = examOptions.map(exam => {
    const checkbox = el('input', {type: 'checkbox', value: exam});
    checkbox.checked = values.has(exam);
    return {exam, checkbox, label: el('label', {class: 'exam-choice'}, checkbox, el('span', {}, exam))};
  });
  const node = el('div', {class: 'exam-choice-grid'}, ...boxes.map(item => item.label));
  return {
    node,
    value: () => boxes.filter(item => item.checkbox.checked).map(item => item.exam),
    set(values) {
      const chosen = new Set(normalizeExamPreferences(values));
      boxes.forEach(item => { item.checkbox.checked = chosen.has(item.exam); });
    },
  };
}
