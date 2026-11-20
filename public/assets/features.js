import {api} from './services.js';
import {bindForm, button, el, entries, field, heading, idPart, link, loadInto, panel, run, say, status, textValue} from './ui.js';

export const socialLinks = [
  ['YouTube', 'https://www.youtube.com/'],
  ['Instagram', 'https://www.instagram.com/'],
  ['Telegram', 'https://t.me/'],
];

export function showTimetable(main, ctx) {
  main.append(...heading('Study timetable', 'Plan your preparation around upcoming classes, tests, and revision sessions.'));
  const list = el('div', {class: 'timetable'});
  main.append(list);
  loadInto(list, ctx, async () => {
    const rows = await api('/timetable', {ctx});
    list.replaceChildren(...(rows.length ? rows.map(item => el('article', {class: 'timetable-card'},
      el('div', {class: 'timetable-time'}, el('span', {}, item.day), el('strong', {}, item.starts_at || item.startsAt),
        el('small', {}, item.duration)),
      el('div', {}, el('h2', {}, item.title), el('p', {class: 'muted'}, item.description)))) :
      [el('div', {class: 'empty-library'}, el('h2', {}, 'Timetable coming soon'),
        el('p', {class: 'muted'}, 'Your admin will publish upcoming study sessions here.'))]));
  });
}

export function showReferrals(main, ctx, action) {
  main.append(...heading('Refer and grow together', 'Share Mission Selection and keep your preparation community moving.'));
  if (!ctx.user) {
    main.append(panel('Your referral code', el('p', {}, 'Sign in to generate a personal referral code.'), action.signInLink()));
    return;
  }
  const content = el('div');
  main.append(content);
  loadInto(content, ctx, async () => {
    const referral = await api('/referral', {ctx, auth: true});
    const code = el('code', {class: 'referral-code'}, referral.code);
    const copy = button('Copy invite', 'secondary');
    copy.addEventListener('click', async () => {
      const invite = `Prepare with Mission Selection: https://mission-selection-ba819.web.app/#home — use referral code ${referral.code}`;
      await navigator.clipboard.writeText(invite);
      copy.textContent = 'Invite copied';
    });
    const applyInput = el('input', {maxlength: '20', placeholder: 'Enter a friend’s code'});
    const applyButton = button('Apply code', null, 'submit');
    const applyFeedback = status();
    const applyForm = el('form', {class: 'referral-apply'}, field('Have a referral code?', applyInput), applyButton, applyFeedback);
    bindForm(applyForm, applyButton, applyFeedback, async () => {
      await api('/referral/apply', {ctx, auth: true, method: 'POST', json: {code: textValue(applyInput, 'Referral code')}});
      applyForm.reset();
      say(applyFeedback, 'Referral linked successfully.');
    }, 'Linking referral…');
    content.replaceChildren(el('section', {class: 'referral-hero'},
      el('span', {class: 'referral-icon', 'aria-hidden': 'true'}, '↗'), el('h2', {}, 'Your personal code'), code,
      el('p', {class: 'muted'}, `Credits available: ${referral.credits || 0}`), copy),
      referral.referred_by || referral.referredBy ? null : panel('Use a friend’s code', applyForm));
  });
}

export function showPhysicalStore(main, ctx, action) {
  main.append(...heading('Physical Book Store', 'Order printed books with UPI payment proof and delivery tracking.'));
  const books = el('div', {class: 'grid'});
  const orders = el('div');
  main.append(books, ctx.user ? panel('Your physical orders', orders) : null);
  loadInto(books, ctx, async () => {
    const rows = await api('/physical-books', {ctx});
    books.replaceChildren(...(rows.length ? rows.map(item => el('article', {class: 'panel physical-book'},
      el('div', {class: 'book-cover', 'aria-hidden': 'true'}, 'BOOK'), el('h2', {}, item.title),
      el('p', {class: 'muted'}, item.description), el('p', {class: 'price'}, `₹${(item.price / 100).toFixed(2)}`),
      el('small', {class: 'muted'}, `${item.stock} in stock`),
      ctx.user ? orderForm(ctx, item) : action.signInLink('Sign in to order'))) :
      [el('div', {class: 'empty-library'}, el('h2', {}, 'Physical books are coming soon'),
        el('p', {class: 'muted'}, 'Admin can publish stock and fulfil orders from the Admin workspace.'))]));
  });
  if (ctx.user) loadInto(orders, ctx, async () => {
    const rows = await api('/physical-orders', {ctx, auth: true});
    orders.replaceChildren(entries(rows, 'No physical book orders yet.', item => el('div', {class: 'physical-order'},
      el('strong', {}, item.title), el('span', {class: `request-state ${item.status}`}, item.status),
      el('p', {class: 'muted'}, `${item.quantity} × book · ₹${(item.amount / 100).toFixed(2)}`),
      item.tracking ? el('p', {}, `Tracking: ${item.tracking}`) : null,
      item.reviewNote ? el('p', {class: 'muted'}, item.reviewNote) : null)));
  });
}

function orderForm(ctx, item) {
  const details = el('details', {class: 'shipping-order'}, el('summary', {}, 'Order now'));
  const quantity = el('input', {type: 'number', min: '1', max: String(Math.min(5, item.stock)), value: '1', required: ''});
  const reference = el('input', {required: '', maxlength: '80', placeholder: 'UPI transaction reference'});
  const fullName = el('input', {required: '', maxlength: '100', autocomplete: 'name'});
  const phone = el('input', {required: '', maxlength: '10', inputmode: 'numeric', autocomplete: 'tel-national'});
  const line1 = el('input', {required: '', maxlength: '300', autocomplete: 'address-line1'});
  const line2 = el('input', {maxlength: '300', autocomplete: 'address-line2'});
  const city = el('input', {required: '', maxlength: '100', autocomplete: 'address-level2'});
  const state = el('input', {required: '', maxlength: '100', autocomplete: 'address-level1'});
  const pin = el('input', {required: '', inputmode: 'numeric', maxlength: '6', autocomplete: 'postal-code'});
  const submit = button(`Submit ₹${(item.price / 100).toFixed(2)} payment`, null, 'submit');
  const feedback = status();
  const form = el('form', {}, field('Quantity', quantity), field('UPI reference', reference),
    field('Full name', fullName), field('Delivery mobile', phone), field('Address line 1', line1),
    field('Address line 2 (optional)', line2), field('City', city), field('State', state),
    field('PIN code', pin), submit, feedback);
  bindForm(form, submit, feedback, async () => {
    await api('/physical-orders', {ctx, auth: true, method: 'POST', json: {
      bookId: item.id, quantity: quantity.valueAsNumber, reference: textValue(reference, 'UPI reference'),
      address: {fullName: textValue(fullName, 'Full name'), phone: phone.value.replace(/\D/g, ''),
        line1: textValue(line1, 'Address'), line2: line2.value, city: textValue(city, 'City'),
        state: textValue(state, 'State'), pin: textValue(pin, 'PIN code')},
    }});
    form.reset();
    say(feedback, 'Physical book order submitted for admin review.');
  }, 'Submitting order…');
  details.append(form);
  return details;
}

export function showDownloads(main, ctx, action) {
  main.append(...heading('Downloads', 'Protected PDF pages and approved digital content for your purchased missions.'));
  if (!ctx.user) {
    main.append(panel('Your downloads', el('p', {}, 'Sign in to access watermarked study-book pages.'),
      action.signInLink()));
    return;
  }
  const content = el('div');
  main.append(panel('Protected downloads',
    el('p', {}, 'Original PDFs remain private. Download one watermarked PNG page at a time.'),
    content));
  loadInto(content, ctx, async () => {
    const courses = await api('/courses', {ctx});
    const me = await api('/me', {ctx, auth: true});
    const owned = courses.filter(course => me.purchases.some(id => String(id) === String(course.id)));
    const rows = [];
    for (const course of owned) {
      const material = await api(`/courses/${idPart(course.id)}`, {ctx, auth: true});
      for (const book of material.books) {
        const page = el('input', {type: 'number', min: '1', max: String(book.pages), value: '1'});
        const download = button('Download protected page');
        const feedback = status();
        download.addEventListener('click', () => buttonDownload(ctx, book.id, page, download, feedback));
        rows.push(el('article', {class: 'download-row'}, el('div', {}, el('strong', {}, book.title),
          el('p', {class: 'muted'}, `${course.title} · ${book.pages} pages`)),
          field('Page', page), download, feedback));
      }
    }
    content.replaceChildren(...(rows.length ? rows : [el('p', {class: 'empty-library'},
      'No purchased books are available for download yet.')]));
  });
}

async function buttonDownload(ctx, bookId, pageInput, control, feedback) {
  run(control, feedback, async () => {
    const page = pageInput.valueAsNumber;
    if (!Number.isSafeInteger(page) || page < 1 || page > Number(pageInput.max)) throw new Error('Choose a valid page number.');
    const blob = await api(`/books/${idPart(bookId)}/pages/${page}/download`, {ctx, auth: true, image: true});
    const url = URL.createObjectURL(blob);
    const anchor = el('a', {href: url, download: `mission-selection-page-${page}.png`});
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(feedback, 'Protected page downloaded.');
  }, 'Preparing protected page…');
}

export function socialFooter(ctx) {
  const target = el('div', {class: 'social-links', 'aria-label': 'Social media'});
  api('/social', {ctx}).then(values => {
    const links = socialLinks.filter(([, fallback]) => fallback).filter(([label]) => values[label.toLowerCase()]);
    target.replaceChildren(...links.map(([label]) => el('a',
      {href: values[label.toLowerCase()], target: '_blank', rel: 'noopener noreferrer'}, label)));
  }).catch(() => {});
  return target;
}
