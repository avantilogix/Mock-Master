import {button, el, field, icon, textValue} from './ui.js';

export function manualQuestions() {
  const list = el('div', {class: 'manual-question-list'});
  const count = el('p', {class: 'muted', role: 'status'});
  const add = button('', 'secondary manual-add-question');
  add.setAttribute('aria-label', 'Add question');
  add.title = 'Add question';
  add.prepend(icon('plus', 'line-icon'));
  const node = el('fieldset', {class: 'manual-questions upload-fields', hidden: '', disabled: ''},
    el('legend', {}, 'Manual Questions'),
    el('p', {class: 'muted'}, 'Add 1–200 questions with 2–6 options each. Select one correct answer per question.'),
    list, el('div', {class: 'actions'}, add), count);
  let questions = [];
  const updateNumbers = () => {
    questions.forEach((question, index) => {
      question.legend.textContent = `Question ${index + 1}`;
      question.remove.setAttribute('aria-label', `Remove question ${index + 1}`);
      question.remove.title = `Remove question ${index + 1}`;
      question.remove.disabled = questions.length === 1;
    });
    add.disabled = questions.length >= 200;
    count.textContent = `${questions.length} of 200 questions`;
  };
  const addQuestion = () => {
    const prompt = el('textarea', {rows: '3', required: '', maxlength: '2000'});
    const section = el('input', {maxlength: '100', placeholder: 'General'});
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
    const questionNode = el('fieldset', {class: 'manual-question'},
      legend, field('Question Text', prompt), field('Section (optional)', section),
      optionsArea, el('div', {class: 'actions'}, addOption),
      field('Correct Answer', correct, 'Choose the option that earns marks.'),
      el('div', {class: 'actions'}, remove));
    const question = {node: questionNode, legend, prompt, section, correct, remove};
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
    const appendOption = () => {
      const input = el('input', {required: '', maxlength: '500'});
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
      });
      options.push(option);
      optionsArea.append(row);
      updateOptions();
    };
    correct.addEventListener('change', () => { answer = correct.value === '' ? null : options[Number(correct.value)]; });
    addOption.addEventListener('click', appendOption);
    remove.addEventListener('click', () => {
      questions = questions.filter(item => item !== question);
      questionNode.remove();
      updateNumbers();
    });
    question.value = () => ({
      prompt: textValue(prompt, 'Question text'),
      options: options.map(option => textValue(option.input, 'Answer option')),
      answer: correct.value === '' ? -1 : Number(correct.value),
      section: section.value.trim() || 'General',
    });
    for (let index = 0; index < 4; index++) appendOption();
    questions.push(question);
    list.append(questionNode);
    updateNumbers();
  };
  const reset = () => {
    questions = [];
    list.replaceChildren();
    addQuestion();
  };
  add.addEventListener('click', () => {
    addQuestion();
    questions.at(-1).prompt.focus();
  });
  reset();
  return {node, reset, values: () => questions.map(question => question.value())};
}
