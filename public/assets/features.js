import {api} from './services.js';
import {pdfReader} from './ebooks.js?v=continuous-reader-v2';
import {openSaved, removeSaved, savedItems, savedPart} from './saved-content.js';
import {bindForm, button, confirmDelete, el, entries, field, heading, icon, idPart, link, loadInto, panel, run, say, status, textValue} from './ui.js';

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
  main.append(...heading('Downloads', 'Content saved on this device. An internet connection is required to check access before opening.'));
  const content = el('div');
  main.append(panel('Saved on This Device',
    el('div', {class: 'tabs', role: 'tablist', 'aria-label': 'Download type'},
      el('button', {type: 'button', class: 'tab', role: 'tab', 'aria-selected': 'true'}, 'PDF'),
      el('button', {type: 'button', class: 'tab', role: 'tab', 'aria-selected': 'false'}, 'Video')),
    content));
  if (!ctx.user) {
    content.append(el('p', {}, 'Sign in to view your downloads.'), action.signInLink());
    return;
  }
  let activeType = 'pdf';
  const tabs = main.querySelectorAll('.tabs .tab');
  tabs.forEach((tab, index) => tab.addEventListener('click', () => {
    activeType = index === 0 ? 'pdf' : 'video';
    tabs.forEach((value, position) => value.setAttribute('aria-selected', String(position === index)));
    load();
  }));
  const load = () => loadInto(content, ctx, async () => {
    const items = (await savedItems(ctx.user.uid)).filter(item =>
      activeType === 'video' ? item.type.includes('video') :
        !item.type.includes('video'));
    content.replaceChildren(...(items.length ? items.map(item => {
      const feedback = status();
      const remove = confirmDelete(feedback, async () => {
        await removeSaved(ctx.user.uid, item.type, item.id);
        load();
      }, {question: 'Remove this saved item?'});
      return el('article', {class: 'download-row'}, el('div', {},
        el('strong', {}, item.title), el('p', {class: 'muted'},
          item.incomplete ? 'Incomplete save. Remove and try again.' : item.type.includes('video') ? 'Video' : `${item.parts} pages`)),
      item.incomplete ? null : link('Open', `#saved/${idPart(item.type)}/${idPart(item.id)}`, 'button'),
      remove, feedback);
    }) : [el('p', {class: 'empty-library'}, 'Nothing saved yet. Open eligible learning content and choose Save to Downloads.')]));
  });
  load();
}

export function showSaved(main, ctx, type, id) {
  const content = el('div');
  main.append(link('Back to Downloads', '#downloads', 'back'), content);
  loadInto(content, ctx, async () => {
    const item = await openSaved(ctx, type, id);
    if (!ctx.current()) return;
    content.replaceChildren(...heading(item.title, 'Saved on this device'));
    if (type.includes('video')) {
      const blob = await savedPart(item, 1);
      if (!ctx.current()) return;
      const url = URL.createObjectURL(blob);
      ctx.signal.addEventListener('abort', () => URL.revokeObjectURL(url), {once: true});
      content.append(el('video', {class: 'chapter-video', src: url, controls: '', controlslist: 'nodownload',
        preload: 'metadata', playsinline: '', 'aria-label': item.title}));
    } else if (type === 'test-pdf' || type === 'test-result-pdf') {
      const blob = await savedPart(item, 1);
      if (!ctx.current()) return;
      const url = URL.createObjectURL(blob);
      ctx.signal.addEventListener('abort', () => URL.revokeObjectURL(url), {once: true});
      content.append(el('iframe', {class: 'saved-pdf', src: url, title: item.title}));
    } else {
      pdfReader(content, ctx, {...item, pages: item.parts, readerTools: true, getPage: page => savedPart(item, page)});
    }
  });
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
