import {api} from './services.js';
import {bindForm, button, el, entries, field, heading, link, loadInto, panel, say, status, textValue} from './ui.js';

const contentKinds = {
  'free-tests': {title: 'Free Tests', icon: '✓', description: 'Try selected practice resources without purchasing a mission.'},
  'current-affairs': {title: 'Current Affairs', icon: '◫', description: 'Read concise updates prepared for competitive examinations.'},
  'pyqs': {title: 'Previous Year Questions', icon: '?', description: 'Revise important question patterns from earlier examinations.'},
  'syllabus': {title: 'Syllabus', icon: '☷', description: 'Organize preparation with published topic and syllabus resources.'},
};

export function showProgress(main, ctx, action) {
  main.append(...heading('Progress report', 'Review every submitted test and track your overall accuracy.'));
  if (!ctx.user) {
    main.append(panel('Your preparation analytics', el('p', {}, 'Sign in to see your scored test attempts.'),
      action.signInLink()));
    return;
  }
  const summary = el('div', {class: 'progress-summary'});
  const history = el('div');
  main.append(summary, panel('Attempt history', history));
  loadInto(history, ctx, async () => {
    const result = await api('/progress', {ctx, auth: true});
    summary.replaceChildren(
      ...[
        ['Attempts', result.summary.attempts, 'Tests submitted'],
        ['Accuracy', `${result.summary.accuracy}%`, 'Correct answers'],
        ['Questions', result.summary.questions, 'Questions attempted'],
      ].map(([label, value, hint]) => el('article', {class: 'progress-tile'},
        el('span', {}, label), el('strong', {}, String(value)), el('small', {}, hint))));
    history.replaceChildren(entries(result.attempts, 'Complete your first test to begin your progress report.', attempt =>
      el('div', {class: 'attempt-row'},
        el('div', {}, el('strong', {}, attempt.title), el('p', {class: 'muted'}, attempt.courseTitle),
          el('small', {class: 'muted'}, new Date(attempt.createdAt).toLocaleString('en-IN'))),
        el('div', {class: 'attempt-score'}, `${attempt.score}/${attempt.total}`))));
  });
}

export function showNotifications(main, ctx, action) {
  main.append(...heading('Notifications', 'Updates about your course payments and learning access.'));
  if (!ctx.user) {
    main.append(panel('Your inbox', el('p', {}, 'Sign in to see payment and course notifications.'),
      action.signInLink()));
    return;
  }
  const list = el('div');
  main.append(list);
  loadInto(list, ctx, async () => {
    const rows = await api('/notifications', {ctx, auth: true});
    list.replaceChildren(entries(rows, 'You are all caught up. New course updates will appear here.', item => {
      const card = link('', item.href, 'notification-card');
      card.append(
        item.unread ? el('span', {class: 'notification-dot', 'aria-label': 'New'}) : null,
        el('div', {}, el('strong', {}, item.title), el('p', {class: 'muted'}, item.body),
          el('small', {class: 'muted'}, item.date ? new Date(item.date).toLocaleString('en-IN') : '')));
      return card;
    }));
  });
}

export function showLearningContent(main, ctx, kind, action) {
  const config = contentKinds[kind];
  main.append(...heading(config.title, config.description));
  if (!ctx.user) {
    main.append(panel(config.title, el('p', {}, 'Sign in to open published learning content.'), action.signInLink()));
    return;
  }
  const content = el('div', {class: 'resource-list'});
  main.append(content);
  loadInto(content, ctx, async () => {
    const rows = await api(`/content/${kind}`, {ctx, auth: true});
    content.replaceChildren(...(rows.length ? rows.map(item =>
      el('article', {class: 'resource-card'},
        el('span', {class: 'resource-icon', 'aria-hidden': 'true'}, config.icon),
        el('h2', {}, item.title), el('p', {class: 'lead'}, item.summary),
        el('details', {}, el('summary', {}, 'Open resource'), el('div', {class: 'resource-body'}, item.body)))) :
      [el('div', {class: 'empty-library'}, el('span', {class: 'resource-icon'}, config.icon),
        el('h2', {}, `No ${config.title.toLowerCase()} published yet`),
        el('p', {class: 'muted'}, 'Your admin can publish new resources from the Admin workspace.'))]));
  });
}

export function adminContentForm(post, refresh) {
  const kind = el('select', {required: ''},
    Object.entries(contentKinds).map(([value, config]) => el('option', {value}, config.title)));
  const title = el('input', {required: '', maxlength: '120'});
  const summary = el('textarea', {rows: '2', required: '', maxlength: '300'});
  const body = el('textarea', {rows: '7', required: '', maxlength: '10000'});
  const submit = button('Publish resource', null, 'submit');
  const feedback = status();
  const form = el('form', {}, field('Section', kind), field('Resource title', title),
    field('Short summary', summary), field('Content', body), submit, feedback);
  bindForm(form, submit, feedback, async () => {
    await post(`/admin/content/${kind.value}`, {json: {
      title: textValue(title, 'Title'), summary: textValue(summary, 'Summary'), body: textValue(body, 'Content'),
    }});
    form.reset();
    say(feedback, 'Learning resource published.');
    refresh?.();
  }, 'Publishing resource…');
  return form;
}
