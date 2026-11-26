import {api} from './services.js';
import {el, empty, firstAttemptScore, heading, idPart, link, loadInto} from './ui.js';

export function showFreeTests(main, ctx, action) {
  main.append(...heading('Free Test Series', 'Practise without purchasing a course.'));
  if (!ctx.user) {
    main.append(action.signInLink());
    return;
  }
  const content = el('div', {class: 'grid'});
  main.append(content);
  loadInto(content, ctx, async () => {
    const tests = await api('/free-tests', {ctx, auth: true});
    content.replaceChildren(...(tests.length ? tests.map(test => {
      const remaining = Math.max(0, test.attemptsLimit - test.attempts);
      const attempts = test.live && Date.now() <= Date.parse(test.expiresAt) ?
        `${remaining} ${remaining === 1 ? 'attempt' : 'attempts'} remaining during live window` : 'Unlimited attempts';
      return el('article', {class: 'panel card'}, el('div', {class: 'card-body'},
        el('h2', {}, test.title),
        el('p', {class: 'muted'}, `${test.questionCount} ${test.questionCount === 1 ? 'question' : 'questions'} · ${test.questionCount * test.marksPerQuestion} marks · ${test.durationMinutes} minutes`),
        el('p', {class: 'muted'}, attempts),
        el('div', {class: 'actions'}, link('Start Test', `#test/free-tests/${idPart(test.id)}`, 'button'),
          firstAttemptScore(test.firstAttempt))));
    }) : [empty('No free tests are available yet.')]));
  });
}
