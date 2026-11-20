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
  const insights = el('div', {class: 'progress-insights'});
  const history = el('div');
  main.append(summary, insights, panel('Attempt history', history));
  loadInto(history, ctx, async () => {
    const result = await api('/progress', {ctx, auth: true});
    summary.replaceChildren(
      ...[
        ['Attempts', result.summary.attempts, 'Tests submitted'],
        ['Accuracy', `${result.summary.accuracy}%`, 'Correct answers'],
        ['Best score', `${result.summary.best || 0}%`, 'Personal best'],
      ].map(([label, value, hint]) => el('article', {class: 'progress-tile'},
        el('span', {}, label), el('strong', {}, String(value)), el('small', {}, hint))));
    const filter = el('select', {}, el('option', {value: ''}, 'All missions'),
      ...(result.courses || []).map(course => el('option', {value: course.course}, course.title)));
    const trend = el('div', {class: 'score-trend'});
    const renderTrend = selected => {
      const attempts = result.attempts.filter(item => !selected || item.course === selected).slice(0, 10).reverse();
      trend.replaceChildren(...(attempts.length ? attempts.map(item => {
        const score = Math.round(item.score / item.total * 100);
        return el('div', {class: 'trend-point', 'aria-label': `${item.title}: ${score}%`},
          el('span', {style: `height:${Math.max(score, 8)}%`}), el('small', {}, `${score}%`));
      }) : [el('p', {class: 'muted'}, 'No tests in this mission yet.')]));
    };
    filter.addEventListener('change', () => renderTrend(filter.value));
    renderTrend('');
    insights.replaceChildren(el('section', {class: 'progress-chart'},
      el('div', {class: 'chart-head'}, el('div', {}, el('h2', {}, 'Score trend'),
        el('p', {class: 'muted'}, 'Your last 10 test results')), field('Mission', filter)),
      trend),
      el('section', {class: 'mission-progress'}, el('h2', {}, 'Mission performance'),
        ...(result.courses?.length ? result.courses.map(course => el('article', {class: 'mission-progress-row'},
          el('div', {}, el('strong', {}, course.title), el('p', {class: 'muted'}, `${course.attempts} attempts · Best ${course.best}%`)),
          el('div', {class: 'accuracy-ring', style: `--value:${course.accuracy * 3.6}deg`},
            el('span', {}, `${course.accuracy}%`)))) :
          [el('p', {class: 'muted'}, 'Complete a test to see mission-level performance.')])));
    history.replaceChildren(entries(result.attempts, 'Complete your first test to begin your progress report.', attempt =>
      el('div', {class: 'attempt-row'},
        el('div', {}, el('strong', {}, attempt.title), el('p', {class: 'muted'}, attempt.courseTitle),
          el('small', {class: 'muted'}, new Date(attempt.createdAt).toLocaleString('en-IN'))),
        el('div', {}, el('div', {class: 'attempt-score'}, `${attempt.score}/${attempt.total}`),
          el('small', {class: 'attempt-percent'}, `${Math.round(attempt.score / attempt.total * 100)}%`)))));
  });
}

export function showNotifications(main, ctx, action) {
  main.append(...heading('Notifications', 'Updates about your course payments and learning access.'));
  if (!ctx.user) {
    main.append(panel('Your inbox', el('p', {}, 'Sign in to see payment and course notifications.'),
      action.signInLink()));
    return;
  }
  const list = el('div', {class: 'notification-list'});
  main.append(list);
  loadInto(list, ctx, async () => {
    const rows = await api('/notifications', {ctx, auth: true});
    list.replaceChildren(entries(rows, 'You are all caught up. New course updates will appear here.', item => {
      const card = link('', item.href || '#home', 'notification-card');
      card.append(
        item.unread ? el('span', {class: 'notification-dot', 'aria-label': 'New'}) : null,
        el('div', {}, el('strong', {}, item.title?.replace(/^null\s*/, '') || 'Course update'), el('p', {class: 'muted'}, item.body || ''),
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
    if (kind === 'current-affairs') {
      const years = new Map();
      for (const item of rows) {
        const date = item.publishedAt || item.createdAt?.slice(0, 10) || new Date().toISOString().slice(0, 10);
        const [year, month] = date.split('-');
        if (!years.has(year)) years.set(year, new Map());
        if (!years.get(year).has(month)) years.get(year).set(month, []);
        years.get(year).get(month).push(item);
      }
      const monthName = value => new Intl.DateTimeFormat('en-IN', {month: 'long'}).format(new Date(2026, Number(value) - 1, 1));
      content.replaceChildren(...(years.size ? [...years].map(([year, months]) =>
        el('section', {class: 'affairs-year'},
          el('div', {class: 'affairs-year-head'}, el('h2', {}, year), el('span', {}, `${[...months.values()].flat().length} updates`)),
          ...[...months].sort(([a], [b]) => Number(a) - Number(b)).map(([month, items]) => el('details', {class: 'affairs-month', open: ''},
            el('summary', {}, el('span', {}, monthName(month)), el('small', {}, `${items.length} ${items.length === 1 ? 'item' : 'items'}`)),
            ...items.map(item => el('article', {class: 'resource-card'},
              el('h3', {}, item.title), el('p', {class: 'muted'}, item.summary),
              el('details', {}, el('summary', {}, 'Read update'), el('div', {class: 'resource-body'}, item.body)))))))) :
        [el('div', {class: 'empty-library'}, el('h2', {}, 'No current affairs published yet'),
          el('p', {class: 'muted'}, 'Admin can add dated updates from the Admin workspace.'))]));
      return;
    }
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
  const published = el('input', {type: 'date', value: new Date().toISOString().slice(0, 10)});
  const publishedField = field('Publish date', published, 'Current Affairs uses this year and month in the student archive.');
  publishedField.hidden = kind.value !== 'current-affairs';
  kind.addEventListener('change', () => { publishedField.hidden = kind.value !== 'current-affairs'; });
  const submit = button('Publish resource', null, 'submit');
  const feedback = status();
  const form = el('form', {}, field('Section', kind), publishedField, field('Resource title', title),
    field('Short summary', summary), field('Content', body), submit, feedback);
  bindForm(form, submit, feedback, async () => {
    await post(`/admin/content/${kind.value}`, {json: {
      title: textValue(title, 'Title'), summary: textValue(summary, 'Summary'), body: textValue(body, 'Content'),
      publishedAt: published.value,
    }});
    form.reset();
    say(feedback, 'Learning resource published.');
    refresh?.();
  }, 'Publishing resource…');
  return form;
}
