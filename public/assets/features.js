import {api} from './services.js';
import {pdfReader} from './ebooks.js?v=pdf-reader-minimal-v2';
import {openSaved, removeSaved, savedItems, savedPart} from './saved-content.js?v=download-icon-controls-v1';
import {backLink, bindForm, button, confirmDelete, el, entries, field, heading, icon, iconAction, idPart, link, loadInto, panel, run, say, status, textValue} from './ui.js?v=previous-only-back-v1';

export const socialLinks = [
  ['YouTube', 'youtube', '▶'],
  ['Instagram', 'instagram', '◎'],
  ['Telegram', 'telegram', '➤'],
];

const clock = value => {
  const [hours, minutes] = String(value || '').split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return value || '';
  return `${hours % 12 || 12}:${String(minutes).padStart(2, '0')} ${hours < 12 ? 'AM' : 'PM'}`;
};
export function showTimetable(main, ctx) {
  main.append(...heading('Study timetable', 'See upcoming classes, tests, and revision sessions.'));
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
}

export function showReferrals(main, ctx, action) {
  main.append(...heading('Refer and grow together', 'Share Mission Selection and keep your preparation community moving.'));
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
  const search = el('input', {type: 'search', placeholder: 'Search saved PDFs'});
  const searchField = field('Search PDFs', search);
  searchField.classList.add('downloads-search');
  searchField.hidden = !ctx.user;
  main.append(panel('Saved on This Device',
    el('div', {class: 'tabs', role: 'tablist', 'aria-label': 'Download type'},
      el('button', {type: 'button', class: 'tab', role: 'tab', 'aria-selected': 'true'}, 'PDF'),
      el('button', {type: 'button', class: 'tab', role: 'tab', 'aria-selected': 'false'}, 'Video')),
    searchField, content));
  if (!ctx.user) {
    content.append(el('p', {}, 'Sign in to view your downloads.'), action.signInLink());
    return;
  }
  let activeType = 'pdf';
  const searches = {pdf: '', video: ''};
  let saved = null;
  search.addEventListener('input', () => {
    searches[activeType] = search.value;
    if (saved) render();
  });
  const tabs = main.querySelectorAll('.tabs .tab');
  tabs.forEach((tab, index) => tab.addEventListener('click', () => {
    activeType = index === 0 ? 'pdf' : 'video';
    tabs.forEach((value, position) => value.setAttribute('aria-selected', String(position === index)));
    const label = activeType === 'pdf' ? 'PDFs' : 'videos';
    searchField.querySelector('label').textContent = `Search ${label}`;
    search.placeholder = `Search saved ${label}`;
    search.value = searches[activeType];
    if (saved) render();
  }));
  const render = () => {
    const items = saved.filter(item =>
      activeType === 'video' ? item.type.includes('video') :
        !item.type.includes('video'));
    const query = searches[activeType].trim().toLocaleLowerCase();
    const matches = items.filter(item => item.title.toLocaleLowerCase().includes(query));
    content.replaceChildren(...(matches.length ? matches.map(item => {
      const feedback = status();
      const remove = confirmDelete(feedback, async () => {
        await removeSaved(ctx.user.uid, item.type, item.id);
        saved = saved.filter(entry => entry.key !== item.key);
        render();
      }, {question: 'Remove this saved item?'});
      const open = item.incomplete ? null : iconAction(
        link('', `#saved/${idPart(item.type)}/${idPart(item.id)}`, 'secondary icon-button'),
        'eye', `Open ${item.title}`);
      return el('article', {class: 'download-row'},
        el('div', {class: 'download-row-copy'}, el('strong', {}, item.title),
          el('p', {class: 'muted'},
            item.incomplete ? 'Incomplete save. Remove and try again.' :
              item.type.includes('video') ? 'Video' : `${item.parts} pages`)),
        el('div', {class: 'download-row-actions'}, open, remove), feedback);
    }) : [el('p', {class: 'empty-library'}, items.length && query ?
      `No saved ${activeType === 'pdf' ? 'PDFs' : 'videos'} match your search.` :
      'Nothing saved yet. Open eligible learning content and choose Save to Downloads.')]));
  };
  loadInto(content, ctx, async () => {
    saved = await savedItems(ctx.user.uid);
    if (ctx.current()) render();
  });
}

export function showSaved(main, ctx, type, id) {
  const content = el('div');
  main.append(backLink('Back to Downloads', '#downloads'), content);
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
      pdfReader(content, ctx, {...item, pages: item.parts, getPage: page => savedPart(item, page)});
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
