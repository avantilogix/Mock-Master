import {api} from './services.js';
import {pdfReader} from './ebooks.js?v=pdf-reader-minimal-v2';
import {saveControl} from './saved-content.js?v=merge-resolved-v1';
import {importQuestionReview, manualQuestions} from './manual-questions.js?v=bilingual-import-v1';
import {subjectQuestionManager} from './question-sections.js?v=subject-import-label-v1';
import {questionData} from './question-data.js';
import {backLink, bindForm, button, el, entries, field, firstAttemptScore, heading, icon, iconAction, idPart, link, loadInto, panel, rule, run, say, status, textValue} from './ui.js?v=merge-resolved-v1';

export const contentKinds = {
  'current-affairs': {title: 'Current affairs', icon: '◫', description: 'Explore PDF, video, and test updates by year, month, and date.'},
  'pyqs': {title: 'Previous year questions', icon: '?', description: 'Revise important question patterns from earlier examinations.'},
  'syllabus': {title: 'Syllabus', icon: '☷', description: 'Organize preparation with published topic and syllabus resources.'},
};

export function showProgress(main, ctx, action) {
  main.append(...heading('Progress report', 'Review every submitted test and track your overall accuracy.'));
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
  const control = button('', 'secondary icon-button result-download-icon');
  control.append(icon('download', 'line-icon'));
  control.setAttribute('aria-label', `Download ${attempt.title} result`);
  control.title = 'Download Result PDF';
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
  const refresh = iconAction(button('', 'secondary icon-button refresh-action'), 'refresh', 'Refresh notifications');
  main.append(el('div', {class: 'actions'}, refresh), list);
  loadInto(list, ctx, async () => {
    const rows = await api(`/notifications?at=${Date.now()}`, {ctx, auth: true});
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
  refresh.addEventListener('click', () => {
    loadInto(list, ctx, async () => {
      const rows = await api(`/notifications?at=${Date.now()}`, {ctx, auth: true});
      list.replaceChildren(entries(rows, 'No notifications yet. Payment and live-test updates will appear here.', item => {
        const card = link('', item.href || '#home', 'notification-card');
        card.append(el('div', {}, el('strong', {}, item.title || 'Course Update'),
          el('p', {class: 'muted'}, item.body || ''), el('small', {class: 'muted'},
            item.date ? new Date(item.date).toLocaleString('en-IN', {timeZone:'Asia/Kolkata'}) : '')));
        return card;
      }));
    });
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
      content.classList.add('affairs-archive');
      const archive = new Map();
      for (const item of rows) {
        const date = item.publishedAt || item.createdAt?.slice(0, 10) || new Date().toISOString().slice(0, 10);
        const [year, month] = date.split('-');
        if (!archive.has(year)) archive.set(year, new Map());
        if (!archive.get(year).has(month)) archive.get(year).set(month, new Map());
        if (!archive.get(year).get(month).has(date)) archive.get(year).get(month).set(date, []);
        archive.get(year).get(month).get(date).push(item);
      }
      const monthName = value => new Intl.DateTimeFormat('en-IN', {month: 'long'}).format(new Date(2026, Number(value) - 1, 1));
      const sorted = map => [...map].sort(([a], [b]) => b.localeCompare(a));
      const resourceCard = item => {
        const badges = [];
        const [year, month] = (item.publishedAt || item.createdAt?.slice(0, 10) || '').split('-');
        const testQuery = year && month ? `?${new URLSearchParams({year, month})}` : '';
        if (item.test) badges.push(el('span', {class: 'badge'}, item.test.live ? 'Live Test' : 'Mock Test'));
        return el('article', {class: 'resource-card affairs-resource-card'},
          el('div', {class: 'affairs-resource-heading'}, el('h3', {}, item.title),
            badges.length ? el('div', {class: 'actions'}, ...badges) : null),
          item.summary ? el('p', {class: 'muted'}, item.summary) : null,
          item.media?.pdf || item.media?.video ? el('div', {class: 'affairs-media-card'},
            item.media.pdf ? link('View PDF', `#resource/${idPart(item.id)}?media=pdf`, 'button secondary') : null,
            item.media.video ? link('Watch Video', `#resource/${idPart(item.id)}?media=video`, 'button secondary') : null) : null,
          item.test ? el('div', {class: 'actions'}, firstAttemptScore(item.test.firstAttempt),
            link(item.test.live ? 'Take Live Test' : 'Take Mock Test',
              `#test/current-affairs/${idPart(item.test.id)}${testQuery}`, 'button')) : null,
          item.body ? el('details', {}, el('summary', {}, 'Read Update'), el('div', {class: 'resource-body'}, item.body)) : null);
      };
      const navCard = (label, detail, onSelect) => {
        const select = button('', 'affairs-nav-card');
        select.replaceChildren(el('img', {class: 'affairs-nav-logo', src: '/assets/logo.png?v=brand-20261126', alt: '',
          width: 72, height: 72}), el('strong', {}, label), el('small', {}, detail));
        select.addEventListener('click', onSelect);
        return select;
      };
      const showYears = () => {
        content.replaceChildren(el('div', {class: 'affairs-navigation-grid'},
          ...sorted(archive).map(([year]) => {
            const select = button('', 'affairs-nav-card affairs-year-card');
            select.replaceChildren(el('strong', {}, year));
            select.addEventListener('click', () => showMonths(year));
            return select;
          })));
      };
      const showMonths = year => {
        const months = archive.get(year);
        const back = iconAction(button('', 'secondary affairs-back'), 'back', 'All Years');
        back.addEventListener('click', showYears);
        content.replaceChildren(back, el('h2', {class: 'affairs-selection-title'}, year),
          el('div', {class: 'affairs-navigation-grid'},
            ...sorted(months).map(([month, dates]) => {
              const count = [...dates.values()].reduce((sum, items) => sum + items.length, 0);
              return navCard(`${monthName(month)}-${year}`,
                `${count} ${count === 1 ? 'resource' : 'resources'}`, () => showDates(year, month));
            })));
      };
      const showDates = (year, month) => {
        const dates = archive.get(year).get(month);
        const back = iconAction(button('', 'secondary affairs-back'), 'back', `${year} Months`);
        back.addEventListener('click', () => showMonths(year));
        content.replaceChildren(back, el('h2', {class: 'affairs-selection-title'}, `${monthName(month)} ${year}`),
          ...sorted(dates).map(([date, items]) => el('section', {class: 'affairs-day'},
            el('h3', {}, new Intl.DateTimeFormat('en-IN', {day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'})
              .format(new Date(`${date}T00:00:00Z`))),
            el('div', {class: 'affairs-day-resources'}, ...items.map(resourceCard)))));
      };
      const year = action.query?.get('year');
      const month = action.query?.get('month');
      if (year && month && archive.get(year)?.has(month)) showDates(year, month);
      else if (year && archive.has(year)) showMonths(year);
      else if (archive.size) showYears();
      else content.replaceChildren(el('div', {class: 'empty-library'}, el('h2', {}, 'No Current Affairs Published Yet'),
        el('p', {class: 'muted'}, 'Admin can add dated updates from the Admin workspace.')));
      return;
    }
    content.replaceChildren(...(rows.length ? rows.map(item =>
      el('article', {class: 'resource-card'},
        el('span', {class: 'resource-icon', 'aria-hidden': 'true'}, config.icon),
        el('h2', {}, item.title), item.summary ? el('p', {class: 'lead'}, item.summary) : null,
        item.media?.pdf ? el('div', {class: 'affairs-media-card'},
          el('div', {class: 'actions'},
            el('span', {class: 'badge'}, `${item.media.pdf.pages} PDF ${item.media.pdf.pages === 1 ? 'page' : 'pages'}`),
            el('small', {class: 'muted'}, item.downloadsEnabled ? 'Downloads allowed' : 'View in app')),
          link('View PDF', `#resource/${idPart(item.id)}`, 'button secondary')) : null,
        item.body ? el('details', {}, el('summary', {}, 'Open Resource'), el('div', {class: 'resource-body'}, item.body)) : null)) :
      [el('div', {class: 'empty-library'}, el('span', {class: 'resource-icon'}, config.icon),
        el('h2', {}, `No ${config.title} Published Yet`),
        el('p', {class: 'muted'}, 'Your admin can publish new resources from the Admin workspace.'))]));
  });
}

export function showResource(main, ctx, id, action) {
  const back = backLink('Back to Learning Resources', '#home');
  main.append(back);
  if (!ctx.user) {
    main.append(panel('Current Affairs', el('p', {}, 'Sign in to view this resource.'), action.signInLink()));
    return;
  }
  const content = el('div');
  main.append(content);
  loadInto(content, ctx, async () => {
    const item = await api(`/resources/${idPart(id)}`, {ctx, auth: true});
    const section = contentKinds[item.kind];
    const date = item.publishedAt || item.createdAt?.slice(0, 10);
    const [year, month] = (date || '').split('-');
    back.href = item.kind === 'current-affairs' && year && month ?
      `#current-affairs?${new URLSearchParams({year, month})}` : `#${item.kind}`;
    const label = `Back to ${section?.title || 'Learning Resources'}`;
    back.setAttribute('aria-label', label);
    back.title = label;
    content.replaceChildren(...heading(item.title, `Published ${item.publishedAt || item.createdAt?.slice(0, 10) || ''}`),
      el('p', {class: 'muted'}, item.downloadsEnabled ? 'Downloads are enabled for this resource.' : 'View in the app. Downloads are disabled.'));
    if (item.summary || item.body) {
      content.append(el('p', {class: 'lead'}, item.summary), el('div', {class: 'resource-body'}, item.body));
    }
    const media = new URLSearchParams(location.hash.split('?')[1] || '').get('media');
    if (item.media?.video && media !== 'pdf') {
      const videoArea = el('section', {class: 'panel'});
      content.append(videoArea);
      loadInto(videoArea, ctx, async () => {
        const {url} = await api(`/resources/${idPart(id)}/video/link`, {ctx, auth: true});
        const video = el('video', {class: 'chapter-video', controls: '', playsinline: '', preload: 'metadata',
          src: url, controlslist: 'nodownload'});
        const feedback = status();
        video.addEventListener('error', () => say(feedback, 'The video could not load. Reopen this resource to try again.', true));
        ctx.signal.addEventListener('abort', () => { video.pause(); video.removeAttribute('src'); video.load(); }, {once: true});
        const download = item.downloadsEnabled ? saveControl(ctx, {type: 'affairs-video', id: String(id),
          title: item.title, videoLink: `/resources/${idPart(id)}/video/link`}) : null;
        download?.classList.add('video-download-action');
        videoArea.replaceChildren(el('h2', {}, 'Watch Video'), download, video, feedback);
      });
    }
    if (item.media?.pdf && media !== 'video') {
      const reader = el('section', {class: 'affairs-pdf'}, el('h2', {}, 'Read PDF'));
      content.append(reader);
      pdfReader(reader, ctx, {title: item.title, pages: item.media.pdf.pages,
        pagePath: `/resources/${idPart(id)}/pdf/pages`,
        savedItem: item.downloadsEnabled ? {type: 'affairs-pdf', id: String(id), title: item.title,
          pages: item.media.pdf.pages, pagePath: `/resources/${idPart(id)}/pdf/pages`} : null});
    }
  });
}

export async function uploadCurrentAffairsMedia(ctx, files, {required = true, onStatus} = {}) {
  const descriptors = {};
  const media = {};
  for (const [kind, file] of Object.entries(files)) {
    if (!file) continue;
    const extension = file.name.split('.').pop().toLowerCase();
    const type = kind === 'pdf' ?
      (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) && 'application/pdf' :
      ['video/mp4', 'video/webm', 'video/quicktime'].includes(file.type) ? file.type :
        ({mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm'})[extension];
    if (!type || file.size < (kind === 'pdf' ? 1 : 12) ||
        file.size > (kind === 'pdf' ? 12 : 300) * 1024 * 1024) {
      throw new Error(kind === 'pdf' ? 'Choose a PDF up to 12 MB.' : 'Choose an MP4, WebM, or MOV video up to 300 MB.');
    }
    descriptors[kind] = {type, size: file.size};
    media[kind] = file;
  }
  if (!Object.keys(descriptors).length) {
    if (required) throw new Error('Choose a PDF or video to publish.');
    return null;
  }
  const draft = await api('/admin/current-affairs/uploads', {ctx, auth: true, method: 'POST', json: descriptors});
  for (const [kind, descriptor] of Object.entries(descriptors)) {
    onStatus?.(`Uploading ${kind === 'pdf' ? 'PDF' : 'video'}… Keep this screen open.`);
    if (draft.direct) {
      await api(`/admin/current-affairs/uploads/${idPart(draft.id)}/${kind}`, {
        ctx, auth: true, method: 'PUT', binary: media[kind], imageUpload: descriptor.type,
      });
    } else {
      const upload = draft.files[kind];
      const response = await fetch(upload.url, {method: 'PUT', signal: ctx.signal,
        headers: {'Content-Type': descriptor.type, ...upload.headers}, body: media[kind]});
      if (!response.ok) throw new Error(`The ${kind} upload failed (${response.status}). Choose the file and try again.`);
    }
  }
  onStatus?.('Processing files…');
  return draft.id;
}

export function adminContentForm(post, refresh, ctx) {
  const kind = el('select', {required: ''},
    Object.entries(contentKinds).map(([value, config]) => el('option', {value}, config.title)));
  const entryType = el('select', {required: ''},
    el('option', {value: 'resource'}, 'Learning Resource'), el('option', {value: 'test'}, 'Mock / Live Test'));
  const entryTypeField = field('Content Type', entryType);
  const title = el('input', {required: '', maxlength: '120'});
  const published = el('input', {type: 'date', required: '', value: new Date().toISOString().slice(0, 10)});
  const publishedField = field('Publish Date', published, 'Current Affairs uses this year and month in the student archive.');
  const pdf = el('input', {type: 'file', accept: '.pdf,application/pdf'});
  const video = el('input', {type: 'file', accept: '.mp4,.m4v,.webm,.mov,video/mp4,video/webm,video/quicktime'});
  const downloads = el('input', {type: 'checkbox', role: 'switch'});
  const pdfField = field('PDF File (optional)', pdf, 'PDF, up to 12 MB. Students read protected pages inside the app.');
  const videoField = field('Video File (optional)', video, 'MP4, WebM, or MOV, up to 300 MB.');
  const downloadLabel = el('label', {class: 'choice'}, downloads, 'Allow PDF downloads');
  const mediaHint = el('p', {class: 'muted'}, 'PDFs are optional. Downloads are off by default.');
  const mediaFields = el('div', {class: 'affairs-upload'},
    el('div', {class: 'affairs-upload-files'},
      pdfField, videoField),
    downloadLabel,
    mediaHint);
  const questionEntryType = el('select', {required: ''},
    el('option', {value: 'import'}, 'Import File / Questions (JSON)'),
    el('option', {value: 'manual'}, 'Create Test Manually'));
  const testType = el('select', {required: ''},
    el('option', {value: 'mock'}, 'Mock Test — Unlimited Attempts'),
    el('option', {value: 'live'}, 'Live Test — Limited Attempts'));
  const duration = el('input', {type: 'number', min: '10', max: '300', step: '1', required: '', value: '90'});
  const marks = el('input', {type: 'number', min: '0.01', max: '10', step: 'any', required: '', value: '1'});
  const negative = el('input', {type: 'number', min: '0', max: '10', step: 'any', required: '', value: '0'});
  const startsAt = el('input', {type: 'datetime-local', required: ''});
  const expiresAt = el('input', {type: 'datetime-local', required: ''});
  const attempts = el('input', {type: 'number', min: '1', max: '10', step: '1', required: '', value: '1'});
  const questionPaperDownload = el('input', {type: 'checkbox', role: 'switch'});
  const editor = rule(el('textarea', {rows: '12', required: '',
    placeholder: '[{\"prompt\":\"Question text\",\"options\":[\"Option A\",\"Option B\"],\"answer\":0,\"section\":\"General\"}]'}),
  value => {
    try { questionData(value); return ''; } catch (error) { return error.message; }
  });
  const manual = manualQuestions();
  const review = importQuestionReview(editor);
  const subjectManager = subjectQuestionManager(editor, (file, format) =>
    api(`/admin/import?format=${format}`, {ctx, auth: true, method: 'POST', binary: file}));
  const questionFile = el('input', {type: 'file', accept: '.pdf,.docx,.txt'});
  const importFeedback = status();
  const importButton = button('Import Questions', 'secondary');
  const importPanel = el('div', {class: 'question-import-panel'},
    field('Question File (PDF, DOCX, or TXT)', questionFile), importButton, importFeedback);
  importButton.addEventListener('click', () => run(importButton, importFeedback, async () => {
    const file = questionFile.files[0];
    if (!file) throw new Error('Choose a PDF, DOCX, or TXT question file.');
    const format = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'docx', 'txt'].includes(format)) throw new Error('Choose a PDF, DOCX, or TXT question file.');
    const result = await api(`/admin/import?format=${format}`, {ctx, auth: true, method: 'POST', binary: file});
    if (!Array.isArray(result?.questions) || !result.questions.length) throw new Error('No questions were imported.');
    editor.value = JSON.stringify(result.questions, null, 2);
    editor.dispatchEvent(new Event('input', {bubbles: true}));
    const pending = result.questions.filter(question => question.reviewIssues?.length).length;
    say(importFeedback, `${result.questions.length} questions imported.${pending ?
      ` ${pending} highlighted questions need review below.` : ' Review or edit them before publishing.'}`);
  }, 'Importing questions…'));
  const liveFields = el('div', {class: 'test-live-fields'},
    field('Live Test Opens (IST)', startsAt), field('Live Test Closes (IST)', expiresAt),
    field('Allowed Attempts', attempts, 'Live tests allow 1–10 attempts during the scheduled window.'));
  const questionEditorField = field('Questions (JSON)', editor,
    'Review extracted questions and edit prompts, options, answers, and sections before publishing.');
  const questionFields = el('fieldset', {class: 'current-affairs-test-questions upload-fields'},
    field('Question Creation', questionEntryType), importPanel, subjectManager.node,
    review.node, questionEditorField, manual.node);
  const testFields = el('fieldset', {class: 'current-affairs-test-fields upload-fields', hidden: '', disabled: ''},
    field('Test Type', testType), liveFields,
    field('Duration (minutes)', duration), field('Marks Per Correct Answer', marks),
    field('Negative Mark Per Wrong Answer', negative), questionFields,
    el('label', {class: 'choice'}, questionPaperDownload,
      'Enable Question Paper Download after first completed attempt'));
  const updateTestFields = () => {
    const live = testType.value === 'live';
    liveFields.hidden = !live;
    startsAt.disabled = expiresAt.disabled = attempts.disabled = !live;
    const manualMode = questionEntryType.value === 'manual';
    questionEditorField.hidden = importPanel.hidden = subjectManager.node.hidden = manualMode;
    editor.disabled = manualMode;
    manual.node.hidden = !manualMode;
    manual.node.disabled = !manualMode;
    review.node.hidden = review.node.disabled = manualMode;
  };
  testType.addEventListener('change', updateTestFields);
  questionEntryType.addEventListener('change', updateTestFields);
  const submit = button('Publish Resource', null, 'submit');
  const updateFields = () => {
    const affairs = kind.value === 'current-affairs';
    const testMode = affairs && entryType.value === 'test';
    entryTypeField.hidden = !affairs;
    publishedField.hidden = !affairs;
    mediaFields.hidden = testMode;
    videoField.hidden = !affairs;
    video.disabled = !affairs;
    testFields.hidden = !testMode;
    testFields.disabled = !testMode;
    downloadLabel.lastChild.textContent = affairs ? 'Allow PDF and video downloads' : 'Allow PDF downloads';
    mediaHint.textContent = affairs ? 'Upload a PDF, a video, or both. Downloads are off by default.' :
      'PDFs are optional. Downloads are off by default.';
    const hasMedia = Boolean(pdf.files.length || (affairs && video.files.length));
    downloads.disabled = !affairs && !pdf.files.length;
    if (!hasMedia) downloads.checked = false;
    submit.textContent = testMode ? 'Publish Current Affairs Test' : 'Publish Resource';
  };
  pdf.addEventListener('change', updateFields);
  video.addEventListener('change', updateFields);
  kind.addEventListener('change', updateFields);
  entryType.addEventListener('change', updateFields);
  updateFields();
  updateTestFields();
  const feedback = status();
  const fields = el('fieldset', {class: 'upload-fields'}, field('Section', kind), entryTypeField,
    field('Resource Title', title), mediaFields, publishedField, testFields);
  const form = el('form', {}, fields, submit, feedback);
  bindForm(form, submit, feedback, async () => {
    const section = kind.value;
    const json = {title: textValue(title, 'Title'), publishedAt: published.value};
    if (section === 'current-affairs' && entryType.value === 'test') {
      const questions = questionData(questionEntryType.value === 'manual' ?
        JSON.stringify(manual.values()) : editor.value);
      Object.assign(json, {
        contentType: 'test', questions,
        live: testType.value === 'live',
        startsAt: testType.value === 'live' ? startsAt.value : undefined,
        expiresAt: testType.value === 'live' ? expiresAt.value : undefined,
        attemptsLimit: testType.value === 'live' ? attempts.valueAsNumber : 0,
        durationMinutes: duration.valueAsNumber,
        marksPerQuestion: marks.valueAsNumber,
        negativeMark: negative.valueAsNumber,
        questionPaperDownload: questionPaperDownload.checked,
      });
    }
    fields.disabled = true;
    try {
      if (section === 'current-affairs' && entryType.value === 'test') {
        await post(`/admin/content/${section}`, {json});
      } else {
        if (section === 'current-affairs') {
          const files = {pdf: pdf.files[0], video: video.files[0]};
          const uploadId = await uploadCurrentAffairsMedia(ctx, files, {onStatus: message => say(feedback, message)});
          Object.assign(json, {uploadId, downloadsEnabled: downloads.checked});
        } else if (pdf.files[0]) {
          const uploadId = await uploadCurrentAffairsMedia(ctx, {pdf: pdf.files[0]},
            {required: false, onStatus: message => say(feedback, message)});
          if (uploadId) Object.assign(json, {uploadId, downloadsEnabled: downloads.checked});
        }
        await post(`/admin/content/${section}`, {json});
      }
      form.reset();
      subjectManager.reset();
      manual.reset();
      questionFile.value = '';
      questionPaperDownload.checked = false;
      updateTestFields();
      updateFields();
      say(feedback, 'Learning resource published.');
      refresh?.();
    } finally {
      fields.disabled = false;
    }
  }, 'Publishing resource…');
  return form;
}
