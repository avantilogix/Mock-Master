import {api} from './services.js';
import {bindForm, button, confirmDelete, el, entries, field, heading, icon, idPart, loadInto, panel, run, say, status, textValue} from './ui.js';

export const socialLinks = [
  ['YouTube', 'youtube', '▶'],
  ['Instagram', 'instagram', '◎'],
  ['Telegram', 'telegram', '➤'],
];

const weekDays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const clock = value => {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return value || '';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
};
const minutesLabel = total => {
  const value = Number.parseInt(total, 10);
  if (!Number.isFinite(value)) return String(total || '');
  const hours = Math.floor(value / 60);
  return [hours && `${hours} hr`, value % 60 && `${value % 60} min`].filter(Boolean).join(' ');
};

export function showTimetable(main, ctx, action) {
  if (!action.personalTimetable) {
    main.append(...heading('Study Timetable', 'See upcoming classes, tests, and revision sessions.'));
    const sessions = el('div', {class: 'timetable'});
    main.append(panel('Published Sessions', sessions));
    loadInto(sessions, ctx, async () => {
      const rows = await api('/timetable', {ctx});
      sessions.replaceChildren(...(rows.length ? rows.map(item => el('article', {class: 'timetable-card'},
        el('div', {class: 'timetable-time'}, el('small', {}, item.day), el('strong', {}, clock(item.startsAt || item.starts_at)),
          el('small', {}, item.duration)),
        el('div', {}, el('h3', {}, item.title), el('p', {class: 'muted'}, item.description)))) :
        [el('p', {class: 'empty'}, 'No timetable sessions have been published yet.')]));
    });
    return;
  }
  main.append(...heading('My Study Timetable', 'Plan your own week of classes, tests, and revision. Only you can see these sessions.'));
  if (!ctx.user) {
    main.append(panel('Your Personal Timetable', el('p', {}, 'Sign in to create a timetable that is saved to your account only.'),
      action.signInLink()));
    return;
  }
  const mine = (path = '', options = {}) => api(`/timetable/mine${path}`, {ctx, auth: true, ...options});
  const day = el('select', {required: ''}, el('option', {value: ''}, 'Choose a Day'),
    weekDays.map(value => el('option', {value}, value)));
  const title = el('input', {required: '', maxlength: '120', placeholder: 'Polity Revision'});
  const start = el('input', {type: 'time', required: ''});
  const duration = el('input', {type: 'number', required: '', min: '5', max: '720', step: '1', inputmode: 'numeric', placeholder: '60'});
  const notes = el('textarea', {rows: '3', maxlength: '1000', placeholder: 'Topics, chapters, or a test to attempt'});
  const save = button('Add to Timetable', null, 'submit');
  const cancel = button('Cancel Edit', 'secondary');
  cancel.hidden = true;
  const feedback = status();
  const formTitle = el('h2', {}, 'Add a Study Session');
  const form = el('form', {class: 'timetable-form'}, el('div', {class: 'form-grid'}, field('Day', day), field('Start Time', start),
    field('Duration (minutes)', duration, 'Between 5 and 720 minutes.')),
  field('Session Title', title), field('Notes (optional)', notes), el('div', {class: 'actions'}, save, cancel), feedback);
  const summary = el('p', {class: 'timetable-summary muted'});
  const list = el('div', {class: 'timetable'});
  let editing = null;
  const setEditing = item => {
    editing = item;
    form.reset();
    if (item) {
      day.value = item.day;
      title.value = item.title;
      start.value = item.startsAt;
      duration.value = Number.parseInt(item.duration, 10) || '';
      notes.value = item.description || '';
    }
    formTitle.textContent = item ? 'Edit Study Session' : 'Add a Study Session';
    save.textContent = item ? 'Save Changes' : 'Add to Timetable';
    cancel.hidden = !item;
  };
  cancel.addEventListener('click', () => { setEditing(null); say(feedback, ''); });
  const load = () => loadInto(list, ctx, async () => {
    const rows = await mine();
    const total = rows.reduce((sum, item) => sum + (Number.parseInt(item.duration, 10) || 0), 0);
    summary.textContent = rows.length ? `${rows.length} ${rows.length === 1 ? 'session' : 'sessions'} · ${minutesLabel(total)} planned each week` : '';
    if (!rows.length) {
      list.replaceChildren(el('div', {class: 'empty-library'}, el('h2', {}, 'Your Week Is Empty'),
        el('p', {class: 'muted'}, 'Add your first study session using the form above.')));
      return;
    }
    list.replaceChildren(...weekDays.filter(name => rows.some(item => item.day === name)).map(name =>
      el('section', {class: 'timetable-day'}, el('h3', {}, name), rows.filter(item => item.day === name).map(item => {
        const rowFeedback = status();
        const edit = button('Edit', 'secondary');
        edit.addEventListener('click', () => {
          setEditing(item);
          say(feedback, `Editing “${item.title}”. Save your changes or cancel.`);
          form.scrollIntoView({behavior: 'smooth', block: 'start'});
          title.focus({preventScroll: true});
        });
        const remove = confirmDelete(rowFeedback, async () => {
          await mine(`/${idPart(item.id)}`, {method: 'DELETE'});
          if (editing?.id === item.id) setEditing(null);
          say(feedback, `“${item.title}” was removed from your timetable.`);
          load();
        }, {question: 'Remove this session?'});
        return el('article', {class: 'timetable-card'},
          el('div', {class: 'timetable-time'}, el('strong', {}, clock(item.startsAt)), el('small', {}, minutesLabel(item.duration))),
          el('div', {}, el('h4', {}, item.title), item.description ? el('p', {class: 'muted'}, item.description) : null,
            rowFeedback),
          el('div', {class: 'actions timetable-actions'}, edit, remove));
      }))));
  });
  bindForm(form, save, feedback, async () => {
    const body = {day: day.value, title: textValue(title, 'Session title'), startsAt: start.value,
      duration: duration.valueAsNumber, description: notes.value.trim()};
    const updating = editing;
    if (updating) await mine(`/${idPart(updating.id)}`, {method: 'PUT', json: body});
    else await mine('', {method: 'POST', json: body});
    setEditing(null);
    say(feedback, updating ? 'Session updated.' : 'Session added to your timetable.');
    load();
  }, 'Saving session…');
  main.append(el('section', {class: 'panel section'}, formTitle, form),
    el('section', {class: 'section'}, el('div', {class: 'section-heading'}, el('h2', {}, 'Your Week'), summary), list));
  load();
}

export function showReferrals(main, ctx, action) {
  main.append(...heading('Refer and Grow Together', 'Share Mission Selection and keep your preparation community moving.'));
  if (!ctx.user) {
    main.append(panel('Your Referral Code', el('p', {}, 'Sign in to generate a personal referral code.'), action.signInLink()));
    return;
  }
  const content = el('div');
  main.append(content);
  loadInto(content, ctx, async () => {
    const referral = await api('/referral', {ctx, auth: true});
    const code = el('code', {class: 'referral-code'}, referral.code);
    const copy = button('Copy Invite', 'secondary');
    copy.addEventListener('click', async () => {
      const invite = `Prepare with Mission Selection: https://mission-selection-ba819.web.app/#home — use referral code ${referral.code}`;
      await navigator.clipboard.writeText(invite);
      copy.textContent = 'Invite Copied';
    });
    const applyInput = el('input', {required: '', maxlength: '20', autocapitalize: 'characters', placeholder: 'Enter a friend’s code', 'data-label': 'Referral code'});
    const applyButton = button('Apply Code', null, 'submit');
    const applyFeedback = status();
    const applyForm = el('form', {class: 'referral-apply'}, field('Have a Referral Code?', applyInput), applyButton, applyFeedback);
    bindForm(applyForm, applyButton, applyFeedback, async () => {
      await api('/referral/apply', {ctx, auth: true, method: 'POST', json: {code: textValue(applyInput, 'Referral code')}});
      applyForm.reset();
      say(applyFeedback, 'Referral linked successfully.');
    }, 'Linking referral…');
    content.replaceChildren(...[el('section', {class: 'referral-hero'},
      el('span', {class: 'referral-icon', 'aria-hidden': 'true'}, '↗'), el('h2', {}, 'Your Personal Code'), code,
      el('p', {class: 'muted'}, `Credits available: ₹${referral.credits || 0}`), copy),
      referral.referred_by || referral.referredBy ? null : panel('Use a Friend’s Code', applyForm)].filter(Boolean));
  });
}

export function showDownloads(main, ctx, action) {
  main.append(...heading('Downloads', 'Protected PDF pages and approved digital content for your purchased missions.'));
  const content = el('div');
  const videoContent = el('div');
  const tabs = [['pdf', 'PDF', content], ['video', 'Video', videoContent]].map(([key, label, body]) => {
    const tab = el('button', {type: 'button', class: 'tab', role: 'tab', id: `downloads-tab-${key}`,
      'aria-controls': `downloads-panel-${key}`}, label);
    const tabPanel = el('div', {role: 'tabpanel', id: `downloads-panel-${key}`, 'aria-labelledby': tab.id}, body);
    return {tab, tabPanel};
  });
  const select = (index, focus = false) => tabs.forEach(({tab, tabPanel}, position) => {
    const active = position === index;
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
    tabPanel.hidden = !active;
    if (active && focus) tab.focus();
  });
  tabs.forEach(({tab}, index) => {
    tab.addEventListener('click', () => select(index));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      select((index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length, true);
    });
  });
  select(0);
  const loader = el('div');
  main.append(panel('Protected Downloads',
    el('div', {class: 'tabs', role: 'tablist', 'aria-label': 'Download type'}, ...tabs.map(({tab}) => tab)),
    el('p', {}, 'Download the complete protected PDF. Your verified mobile number is watermarked on every page.'),
    loader, ...tabs.map(({tabPanel}) => tabPanel)));
  if (!ctx.user) {
    content.append(el('p', {}, 'Sign in to download protected PDF pages.'), action.signInLink());
    videoContent.append(el('p', {}, 'Sign in to download chapter videos.'), action.signInLink());
    return;
  }
  loadInto(loader, ctx, async () => {
    const courses = await api('/courses', {ctx});
    const me = await api('/me', {ctx, auth: true});
    const owned = courses.filter(course => !course.expired && course.downloadsEnabled &&
      me.purchases.some(id => String(id) === String(course.id)));
    const rows = [];
    const videoRows = [];
    for (const course of owned) {
      const material = await api(`/courses/${idPart(course.id)}`, {ctx, auth: true});
      for (const book of material.books) {
        const download = button('Download PDF');
        const feedback = status();
        download.prepend(icon('download', 'line-icon'));
        download.addEventListener('click', () => buttonDownload(ctx, book.id, download, feedback));
        rows.push(el('article', {class: 'download-row'}, el('div', {}, el('strong', {}, book.title),
          el('p', {class: 'muted'}, `${course.title} · ${book.subject} · ${book.chapter} · ${book.pages} pages`)),
          download, feedback));
      }
      for (const video of material.videos || []) {
        const download = button('Download Video');
        const feedback = status();
        download.addEventListener('click', () => videoDownload(ctx, video, download, feedback));
        videoRows.push(el('article', {class: 'download-row video-row'}, el('div', {}, el('strong', {}, video.title),
          el('p', {class: 'muted'}, `${course.title} · ${video.subject} · ${video.chapter} · ${sizeText(video.size)}`)),
          download, feedback));
      }
    }
    loader.replaceChildren();
    content.replaceChildren(...(rows.length ? rows : [el('p', {class: 'empty-library'},
      'No purchased books are available for download yet.')]));
    videoContent.replaceChildren(...(videoRows.length ? videoRows : [el('p', {class: 'empty-library'},
      'No purchased videos are available for download yet.')]));
  });
}

const sizeText = bytes => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

async function videoDownload(ctx, video, control, feedback) {
  run(control, feedback, async () => {
    const {url} = await api(`/videos/${idPart(video.id)}/link?download=1`, {ctx, auth: true});
    const anchor = el('a', {href: url, download: '', referrerpolicy: 'no-referrer'});
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    say(feedback, 'Video download started.');
  }, 'Preparing video…');
}

async function buttonDownload(ctx, bookId, control, feedback) {
  run(control, feedback, async () => {
    const blob = await api(`/books/${idPart(bookId)}/download`, {ctx, auth: true, blob: true});
    const url = URL.createObjectURL(blob);
    const anchor = el('a', {href: url, download: `mission-selection-book-${bookId}.pdf`});
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(feedback, 'Protected PDF downloaded.');
  }, 'Preparing protected PDF…');
}

export function socialFooter(ctx) {
  const target = el('div', {class: 'social-links', 'aria-label': 'Social media'});
  api('/social', {ctx}).then(values => {
    const links = socialLinks.filter(([, key]) => values[key]);
    target.replaceChildren(...links.map(([label, key, mark]) => el('a',
      {href: values[key], target: '_blank', rel: 'noopener noreferrer', class: `social-icon ${key}`,
        'aria-label': label, title: label}, icon(key, 'social-brand-icon'))));
  }).catch(() => {});
  return target;
}
