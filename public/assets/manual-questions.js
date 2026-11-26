import {button, el, field, icon, textValue} from './ui.js';

export function importQuestionReview(editor) {
  let editing = false;
  const review = manualQuestions({review: true, onChange: questions => {
    editing = true;
    try {
      editor.value = JSON.stringify(questions, null, 2);
      editor.dispatchEvent(new Event('input', {bubbles: true}));
    } finally { editing = false; }
  }});
  const feedback = el('p', {class: 'status error', role: 'status'});
  review.node.append(feedback);
  editor.addEventListener('input', () => {
    if (editing) return;
    feedback.textContent = '';
    try {
      const questions = JSON.parse(editor.value || '[]');
      if (!Array.isArray(questions) || questions.length > 200 ||
          questions.some(question => !question || typeof question.prompt !== 'string' ||
            !Array.isArray(question.options) || question.options.some(option => typeof option !== 'string') ||
            (question.reviewIssues !== undefined && (!Array.isArray(question.reviewIssues) ||
              question.reviewIssues.some(issue => typeof issue !== 'string'))))) throw new Error();
      review.setQuestions(questions);
    } catch {
      review.reset();
      feedback.textContent = 'Fix the Questions (JSON) draft to display its editable question review.';
    }
  });
  return review;
}

export function manualQuestions({review = false, onChange} = {}) {
  const list = el('div', {class: 'manual-question-list'});
  const count = el('p', {class: 'muted', role: 'status'});
  const add = button('', 'secondary manual-add-question');
  add.setAttribute('aria-label', 'Add question');
  add.title = 'Add question';
  add.prepend(icon('plus', 'line-icon'));
  const node = el('fieldset', {class: `manual-questions upload-fields${review ? ' imported-question-review' : ''}`, hidden: '', disabled: ''},
    el('legend', {}, review ? 'Imported Questions' : 'Manual Questions'),
    el('p', {class: 'muted'}, review ?
      'Review the imported text and choices below. Yellow questions need attention. Missing answers are never guessed. Resolve all warnings before publishing.' :
      'Add 1–200 questions with 2–6 options each. Select one correct answer per question.'),
    list, el('div', {class: 'actions'}, add), count);
  let questions = [];
  const notify = () => {
    questions.forEach(question => question.updateReview());
    updateNumbers();
    onChange?.(questions.map(question => question.draft()));
  };
  const updateNumbers = () => {
    questions.forEach((question, index) => {
      const label = `Question ${index + 1}${question.sourceNumber ? ` · Source ${question.sourceNumber}` : ''}`;
      question.legend.textContent = label;
      if (question.summary) question.summary.textContent = `${label}${question.issues().length ? ' — Needs review' : ''}`;
      question.remove.setAttribute('aria-label', `Remove question ${index + 1}`);
      question.remove.title = `Remove question ${index + 1}`;
      question.remove.disabled = questions.length === 1;
    });
    add.disabled = questions.length >= 200;
    const pending = questions.filter(question => question.issues().length).length;
    count.textContent = `${questions.length} of 200 questions${review ? ` · ${pending} need review` : ''}`;
  };
  const addQuestion = (initial = {}) => {
    const prompt = el('textarea', {rows: '3', required: '', maxlength: '2000'});
    prompt.value = initial.prompt || '';
    const section = el('input', {maxlength: '100', placeholder: 'General'});
    section.value = initial.section || '';
    const correct = el('select', {required: ''});
    const optionsArea = el('div', {class: 'manual-options'});
    const addOption = button('', 'secondary manual-add-option');
    addOption.setAttribute('aria-label', 'Add answer option');
    addOption.title = 'Add answer option';
    addOption.prepend(icon('plus', 'line-icon'));
    const remove = button('', 'secondary manual-remove-question');
    remove.title = 'Remove question';
    remove.prepend(icon('trash', 'line-icon'));
    const legend = el('legend');
    const warnings = el('ul', {class: 'question-review-warnings'});
    const structuralIssues = (initial.reviewIssues || []).filter(issue =>
      /labels|source question number/.test(issue));
    const confirmed = el('input', {type: 'checkbox'});
    const confirmation = el('label', {class: 'choice', hidden: ''}, confirmed, 'I checked this source question and its choice order.');
    confirmation.hidden = !structuralIssues.length;
    confirmed.required = Boolean(structuralIssues.length);
    const questionNode = el('fieldset', {class: 'manual-question'},
      legend, warnings, confirmation, field('Question Text', prompt), field('Section (optional)', section),
      optionsArea, el('div', {class: 'actions'}, addOption),
      field('Correct Answer', correct, 'Choose the option that earns marks.'),
      el('div', {class: 'actions'}, remove));
    const summary = review ? el('summary') : null;
    const container = review ? el('details', {class: 'imported-question'}, summary, questionNode) : questionNode;
    const question = {node: questionNode, legend, prompt, section, correct, remove, summary, sourceNumber: initial.questionNumber};
    let options = [];
    let answer = null;
    const updateOptions = () => {
      options.forEach((option, index) => {
        const label = `Option ${String.fromCharCode(65 + index)}`;
        option.field.querySelector('label').textContent = label;
        option.input.dataset.label = label;
        option.remove.setAttribute('aria-label', `Remove ${label.toLowerCase()}`);
        option.remove.title = `Remove ${label.toLowerCase()}`;
        option.remove.disabled = options.length <= 2;
      });
      correct.replaceChildren(el('option', {value: ''}, 'Select the correct answer'),
        ...options.map((_, index) => el('option', {value: String(index)}, `Option ${String.fromCharCode(65 + index)}`)));
      correct.value = answer && options.includes(answer) ? String(options.indexOf(answer)) : '';
      addOption.disabled = options.length >= 6;
    };
    const appendOption = (value = '') => {
      const input = review ? el('textarea', {required: '', maxlength: '500', rows: '2'}) :
        el('input', {required: '', maxlength: '500'});
      input.value = typeof value === 'string' ? value : '';
      const remove = button('', 'secondary manual-remove-option');
      remove.setAttribute('aria-label', 'Remove answer option');
      remove.title = 'Remove answer option';
      remove.prepend(icon('trash', 'line-icon'));
      const wrapper = field('Answer Option', input);
      const row = el('div', {class: 'manual-option'}, wrapper, remove);
      const option = {input, remove, field: wrapper};
      remove.addEventListener('click', () => {
        if (answer === option) answer = null;
        options = options.filter(item => item !== option);
        row.remove();
        updateOptions();
        notify();
      });
      options.push(option);
      optionsArea.append(row);
      updateOptions();
    };
    correct.addEventListener('change', () => { answer = correct.value === '' ? null : options[Number(correct.value)]; notify(); });
    addOption.addEventListener('click', () => { appendOption(); notify(); });
    confirmed.addEventListener('change', notify);
    questionNode.addEventListener('input', notify);
    remove.addEventListener('click', () => {
      questions = questions.filter(item => item !== question);
      container.remove();
      notify();
    });
    question.value = () => ({
      prompt: textValue(prompt, 'Question text'),
      options: options.map(option => textValue(option.input, 'Answer option')),
      answer: correct.value === '' ? -1 : Number(correct.value),
      section: section.value.trim() || 'General',
      ...(question.sourceNumber === undefined ? {} : {questionNumber: question.sourceNumber}),
    });
    question.issues = () => {
      if (!review) return [];
      const issues = confirmed.checked ? [] : [...structuralIssues];
      if (correct.value === '') issues.push('Select the correct answer. No reliable answer was found or selected.');
      if (!prompt.value.trim() || prompt.value.length > 2000) issues.push('Enter question text, up to 2000 characters.');
      if (options.length < 2 || options.length > 6 || options.some(option => !option.input.value.trim() || option.input.value.length > 500)) {
        issues.push('Provide 2–6 non-empty choices, up to 500 characters each.');
      }
      if (/\ufffd|\u0000/.test([prompt.value, section.value, ...options.map(option => option.input.value)].join(''))) {
        issues.push('Unreadable characters (�): compare with the source and repair the text.');
      }
      return issues;
    };
    question.updateReview = () => {
      const issues = question.issues();
      container.classList.toggle('needs-review', issues.length > 0);
      warnings.replaceChildren(...issues.map(issue => el('li', {}, issue)));
      warnings.hidden = !issues.length;
    };
    question.draft = () => {
      const issues = question.issues();
      return {prompt: prompt.value, options: options.map(option => option.input.value),
        answer: correct.value === '' ? null : Number(correct.value), section: section.value.trim() || 'General',
        ...(question.sourceNumber === undefined ? {} : {questionNumber: question.sourceNumber}),
        ...(issues.length ? {reviewIssues: issues} : {})};
    };
    for (const value of initial.options || Array(4).fill('')) appendOption(value);
    if (Number.isInteger(initial.answer) && initial.answer >= 0 && initial.answer < options.length) {
      answer = options[initial.answer];
      updateOptions();
    }
    questions.push(question);
    list.append(container);
    question.updateReview();
    if (review && question.issues().length) container.open = true;
    updateNumbers();
  };
  const reset = () => {
    questions = [];
    list.replaceChildren();
    if (!review) addQuestion();
    else updateNumbers();
  };
  add.addEventListener('click', () => {
    addQuestion();
    notify();
    questions.at(-1).prompt.focus();
  });
  reset();
  return {node, reset, values: () => questions.map(question => question.value()), setQuestions(values) {
    questions = [];
    list.replaceChildren();
    values.forEach(addQuestion);
    updateNumbers();
  }};
}
