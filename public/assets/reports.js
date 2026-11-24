import {api} from './services.js';
import {bindForm, button, el, entries, field, heading, link, loadInto, panel, run, say, status, textValue} from './ui.js';

export const contentKinds = {
  'free-tests': {title: 'Free Tests', icon: '✓', description: 'Try selected practice resources without purchasing a mission.'},
  'current-affairs': {title: 'Current Affairs', icon: '◫', description: 'Read concise updates prepared for competitive examinations.'},
  'pyqs': {title: 'Previous Year Questions', icon: '?', description: 'Revise important question patterns from earlier examinations.'},
  'syllabus': {title: 'Syllabus', icon: '☷', description: 'Organize preparation with published topic and syllabus resources.'},
};

export function showProgress(main, ctx, action) {
  main.append(...heading('Progress Report', 'Review every submitted test and track your overall accuracy.'));
  if (!ctx.user) {
    main.append(panel('Your Preparation Analytics', el('p', {}, 'Sign in to see your scored test attempts.'),
      action.signInLink()));
    return;
  }
  const summary = el('div', {class: 'progress-summary'});
  const insights = el('div', {class: 'progress-insights'});
  const history = el('div');
  main.append(summary, insights, panel('Attempt History', history));
  loadInto(history, ctx, async () => {
    const result = await api('/progress', {ctx, auth: true});
    const allCourses = result.courses || [];
    const percent = item => Math.round(item.score / item.total * 100);
    const filter = el('select', {}, el('option', {value: ''}, 'All Missions'),
      ...allCourses.map(course => el('option', {value: course.course}, course.title)));
    const trend = el('div', {class: 'score-trend'});
    const performance = el('div');
    insights.replaceChildren(el('section', {class: 'progress-chart'},
      el('div', {class: 'chart-head'}, el('div', {}, el('h2', {}, 'Score Trend'),
        el('p', {class: 'muted'}, 'Your last 10 test results')), field('Mission', filter)),
      trend),
      el('section', {class: 'mission-progress'}, el('h2', {}, 'Mission Performance'), performance));
    const render = selected => {
      const attempts = result.attempts.filter(item => !selected || item.course === selected);
      const courses = allCourses.filter(course => !selected || course.course === selected);
      let stats = result.summary;
      if (selected) {
        const total = attempts.reduce((sum, item) => sum + item.total, 0);
        const correct = attempts.reduce((sum, item) => sum + item.score, 0);
        stats = {attempts: attempts.length, accuracy: total ? Math.round(correct / total * 100) : 0,
          best: attempts.length ? Math.max(...attempts.map(percent)) : 0};
      }
      summary.replaceChildren(
        ...[
          ['Attempts', stats.attempts, 'Tests Submitted'],
          ['Accuracy', `${stats.accuracy}%`, 'Correct Answers'],
          ['Best Score', `${stats.best || 0}%`, 'Personal Best'],
        ].map(([label, value, hint]) => el('article', {class: 'progress-tile'},
          el('span', {}, label), el('strong', {}, String(value)), el('small', {}, hint))));
      const recent = attempts.slice(0, 10).reverse();
      trend.replaceChildren(...(recent.length ? recent.map(item => {
        const score = percent(item);
        return el('div', {class: 'trend-point', 'aria-label': `${item.title}: ${score}%`},
          el('span', {style: `height:${Math.max(score, 8)}%`}), el('small', {}, `${score}%`));
      }) : [el('p', {class: 'muted'}, 'No tests in this mission yet.')]));
      performance.replaceChildren(...(courses.length ? courses.map(course => el('article', {class: 'mission-progress-row'},
        el('div', {}, el('strong', {}, course.title), el('p', {class: 'muted'}, `${course.attempts} attempts · Best ${course.best}%`)),
        el('div', {class: 'accuracy-ring', style: `--value:${course.accuracy * 3.6}deg`},
          el('span', {}, `${course.accuracy}%`)))) :
        [el('p', {class: 'muted'}, 'Complete a test to see mission-level performance.')]));
      history.replaceChildren(entries(attempts, 'Complete your first test to begin your progress report.', attempt =>
        el('div', {class: 'attempt-row'},
          el('div', {}, el('strong', {}, attempt.title), el('p', {class: 'muted'}, attempt.courseTitle),
            el('small', {class: 'muted'}, new Date(attempt.createdAt).toLocaleString('en-IN'))),
          el('div', {}, el('div', {class: 'attempt-score'}, `${attempt.score}/${attempt.total}`),
            el('small', {class: 'attempt-percent'}, `${percent(attempt)}%`),
            resultDownloadButton(ctx, attempt)))));
    };
    filter.addEventListener('change', () => render(filter.value));
    render('');
  });
}

function resultDownloadButton(ctx, attempt) {
  const control = button('Download Result', 'secondary');
  const feedback = status();
  control.addEventListener('click', () => run(control, feedback, async () => {
    const blob = await api(`/attempts/${attempt.id}/result.pdf`, {ctx, auth: true, blob: true});
    const url = URL.createObjectURL(blob);
    const anchor = el('a', {href: url, download: `${attempt.title}-result.pdf`});
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(feedback, 'Result PDF downloaded.');
  }, 'Preparing result…'));
  return el('div', {class: 'attempt-download'}, control, feedback);
}

export function showNotifications(main, ctx, action) {
  main.append(...heading('Notifications', 'Updates about your course payments and learning access.'));
  if (!ctx.user) {
    main.append(panel('Your Inbox', el('p', {}, 'Sign in to see payment and course notifications.'),
      action.signInLink()));
    return;
  }
  const list = el('div', {class: 'notification-list'});
  main.append(list);
  loadInto(list, ctx, async () => {
    const rows = await api('/notifications', {ctx, auth: true});
    list.replaceChildren(entries(rows, 'You are all caught up. New course updates will appear here.', item => {
      const card = link('', item.href || '#home', 'notification-card');
      const indicator = item.unread ? el('span', {class: 'notification-dot', 'aria-label': 'New'}) : null;
      const content = el('div', {}, el('strong', {}, item.title?.replace(/\bnull\b/gi, '').trim() || 'Course Update'),
        el('p', {class: 'muted'}, String(item.body || '').replace(/\bnull\b/gi, '').trim()),
        el('small', {class: 'muted'}, item.date ? new Date(item.date).toLocaleString('en-IN') : ''));
      if (indicator) card.append(indicator);
      card.append(content);
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
              el('details', {}, el('summary', {}, 'Read Update'), el('div', {class: 'resource-body'}, item.body)))))))) :
        [el('div', {class: 'empty-library'}, el('h2', {}, 'No Current Affairs Published Yet'),
          el('p', {class: 'muted'}, 'Admin can add dated updates from the Admin workspace.'))]));
      return;
    }
    content.replaceChildren(...(rows.length ? rows.map(item =>
      el('article', {class: 'resource-card'},
        el('span', {class: 'resource-icon', 'aria-hidden': 'true'}, config.icon),
        el('h2', {}, item.title), el('p', {class: 'lead'}, item.summary),
        el('details', {}, el('summary', {}, 'Open Resource'), el('div', {class: 'resource-body'}, item.body)))) :
      [el('div', {class: 'empty-library'}, el('span', {class: 'resource-icon'}, config.icon),
        el('h2', {}, `No ${config.title} Published Yet`),
        el('p', {class: 'muted'}, 'Your admin can publish new resources from the Admin workspace.'))]));
  });
}

export function adminContentForm(post, refresh) {
  const kind = el('select', {required: ''},
    Object.entries(contentKinds).map(([value, config]) => el('option', {value}, config.title)));
  const title = el('input', {required: '', maxlength: '120'});
  const summary = el('textarea', {rows: '2', required: '', maxlength: '300'});
  const body = el('textarea', {rows: '7', required: '', maxlength: '10000'});
  const published = el('input', {type: 'date', required: '', value: new Date().toISOString().slice(0, 10)});
  const publishedField = field('Publish Date', published, 'Current Affairs uses this year and month in the student archive.');
  publishedField.hidden = kind.value !== 'current-affairs';
  kind.addEventListener('change', () => { publishedField.hidden = kind.value !== 'current-affairs'; });
  const submit = button('Publish Resource', null, 'submit');
  const feedback = status();
  const form = el('form', {}, field('Section', kind), publishedField, field('Resource Title', title),
    field('Short Summary', summary), field('Content', body), submit, feedback);
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
