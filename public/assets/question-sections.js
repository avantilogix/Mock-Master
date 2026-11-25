import {button, confirmDelete, el, field, icon, run, say, status} from './ui.js?v=add-subject-button';

export function subjectQuestionManager(questionsEditor, importFile) {
  const subjects = [];
  let nextSubject = 1;
  const cards = el('div', {class: 'subject-question-cards'});
  const feedback = status();
  const sectionOf = question => typeof question?.section === 'string' && question.section.trim() ?
    question.section.trim() : 'General';
  const namesFromQuestions = () => {
    try {
      const questions = JSON.parse(questionsEditor.value);
      return Array.isArray(questions) ? [...new Set(questions.map(sectionOf))] : [];
    } catch { return []; }
  };
  const questionData = () => {
    if (!questionsEditor.value.trim()) return [];
    try {
      const questions = JSON.parse(questionsEditor.value);
      if (!Array.isArray(questions) || questions.some(question => !question || typeof question !== 'object')) throw new Error();
      return questions;
    } catch {
      throw new Error('Fix the Questions (JSON) draft before importing a subject file.');
    }
  };
  const questionCount = name => {
    try { return JSON.parse(questionsEditor.value).filter(question => sectionOf(question) === name).length; }
    catch { return 0; }
  };
  const updateCounts = () => subjects.forEach(subject => {
    const count = questionCount(subject.name);
    if (subject.countElement) subject.countElement.textContent = `${count} ${count === 1 ? 'question' : 'questions'}`;
  });
  const updateQuestions = questions => {
    questionsEditor.value = JSON.stringify(questions, null, 2);
    questionsEditor.dispatchEvent(new Event('input', {bubbles: true}));
  };
  const syncSubjects = () => {
    let changed = false;
    for (const name of namesFromQuestions()) {
      if (!subjects.some(subject => subject.name === name)) {
        subjects.push({name});
        changed = true;
      }
    }
    if (changed) render();
    else updateCounts();
  };
  const addSubject = (name = '') => {
    let defaultName = name || `Subject ${nextSubject++}`;
    while (subjects.some(subject => subject.name.toLowerCase() === defaultName.toLowerCase())) {
      defaultName = `Subject ${nextSubject++}`;
    }
    subjects.push({name: defaultName});
    render();
  };
  const render = () => {
    cards.replaceChildren(...subjects.map(subject => {
      const name = el('input', {required: '', maxlength: '100', value: subject.name, 'aria-label': 'Subject name'});
      const file = el('input', {type: 'file', accept: '.pdf,.docx,.txt', 'aria-label': `Question file for ${subject.name}`});
      const importFeedback = status();
      file.addEventListener('change', () => {
        const selected = file.files[0];
        say(importFeedback, selected ? `${selected.name} selected. Import it to replace this section’s questions.` : '');
      });
      const importButton = button('Import Questions for Subject', 'secondary');
      const count = el('small', {class: 'subject-question-count'});
      subject.countElement = count;
      name.addEventListener('change', () => {
        const nextName = name.value.trim();
        if (!nextName || subjects.some(other => other !== subject && other.name.toLowerCase() === nextName.toLowerCase())) {
          name.value = subject.name;
          say(importFeedback, nextName ? 'Each subject needs a unique name.' : 'Enter a subject name.', true);
          return;
        }
        let questions;
        try { questions = questionData(); } catch (error) {
          name.value = subject.name;
          say(importFeedback, error.message, true);
          return;
        }
        const previousName = subject.name;
        subject.name = nextName;
        updateQuestions(questions.map(question => sectionOf(question) === previousName ?
          {...question, section: nextName} : question));
        heading.textContent = nextName;
        file.setAttribute('aria-label', `Question file for ${nextName}`);
      });
      importButton.addEventListener('click', () => run(importButton, importFeedback, async () => {
        const selectedFile = file.files[0];
        if (!selectedFile) throw new Error('Choose a PDF, DOCX, or TXT question file.');
        const format = selectedFile.name.split('.').pop().toLowerCase();
        if (!['pdf', 'docx', 'txt'].includes(format)) throw new Error('Choose a PDF, DOCX, or TXT question file.');
        const result = await importFile(selectedFile, format);
        if (!Array.isArray(result?.questions) || !result.questions.length) throw new Error('No questions were imported.');
        const questions = questionData();
        const sectionQuestions = result.questions.map(question => ({...question, section: subject.name}));
        const firstIndex = questions.findIndex(question => sectionOf(question) === subject.name);
        const remaining = questions.filter(question => sectionOf(question) !== subject.name);
        remaining.splice(firstIndex < 0 ? remaining.length : firstIndex, 0, ...sectionQuestions);
        updateQuestions(remaining);
        say(importFeedback, `${sectionQuestions.length} questions imported into ${subject.name}.`);
      }, 'Importing questions…'));
      const remove = confirmDelete(importFeedback, async () => {
        const questions = questionData().filter(question => sectionOf(question) !== subject.name);
        subjects.splice(subjects.indexOf(subject), 1);
        updateQuestions(questions);
        render();
        say(feedback, `${subject.name} and its questions were removed from this draft.`);
      }, {label: 'Remove Subject', question: `Remove ${subject.name} and all its questions from this draft?`, busy: 'Removing…'});
      const heading = el('strong', {}, subject.name);
      return el('article', {class: 'subject-question-card'},
        el('div', {class: 'subject-question-heading'}, heading, count),
        field('Subject Name', name), field('Question File', file, 'Importing replaces this subject’s questions only.'),
        importButton, importFeedback, remove);
    }));
    updateCounts();
  };
  const add = button('Add Subject', 'secondary subject-add-button');
  add.prepend(icon('plus', 'line-icon'));
  add.addEventListener('click', () => addSubject());
  questionsEditor.addEventListener('input', syncSubjects);
  for (const name of namesFromQuestions()) addSubject(name);
  if (!subjects.length) addSubject('General');
  return {
    node: el('section', {class: 'subject-question-manager'},
      el('div', {class: 'subject-question-toolbar'},
        el('div', {}, el('h3', {}, 'Subject Sections'),
          el('p', {class: 'muted'}, 'Add a subject, name it, and upload its question file. Students can switch between sections during the test.')),
        add),
      feedback, cards),
    reset() {
      subjects.splice(0, subjects.length);
      nextSubject = 1;
      addSubject('General');
      questionsEditor.value = '';
      questionsEditor.dispatchEvent(new Event('input', {bubbles: true}));
    },
  };
}
