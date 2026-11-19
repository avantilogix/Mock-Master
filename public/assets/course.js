import {api} from './services.js';
import {bindForm, button, el, entries, field, heading, idPart, link, loadInto, panel, run, say, status, textValue} from './ui.js';

const inr = new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR'});
export const priceText = paise => inr.format(paise / 100);
export const owns = (me, id) => me?.purchases?.some(purchase => String(purchase) === String(id));

export function showCatalog(main, ctx, me) {
  const list = el('div', {class: 'grid'});
  main.append(el('section', {class: 'hero'},
    el('div', {class: 'hero-copy'}, el('p', {class: 'eyebrow'}, 'Your preparation partner'),
      ...heading('Choose your mission. Own your result.', 'Build exam-day confidence with focused mock tests, secure study books, and a learning community built around your goal.'),
      el('div', {class: 'hero-actions'}, link('Explore missions', '#available-courses', 'button'),
        link(me ? 'View your profile' : 'Sign in with mobile', me ? '#profile' : '#signin', 'button secondary')),
      el('div', {class: 'hero-proof'}, el('span', {}, 'Mobile OTP access'), el('span', {}, 'Protected content'), el('span', {}, 'Verified UPI payments'))),
    el('div', {class: 'hero-art', 'aria-hidden': 'true'}, el('strong', {}, 'Stay mission ready'), el('div', {class: 'progress-ring'}, '01'), el('small', {}, 'Pick a mission. Start practising.'))),
  el('div', {class: 'stat-strip', 'aria-label': 'Mission Selection benefits'},
    el('div', {class: 'stat-tile'}, el('strong', {}, 'Practice tests'), el('span', {}, 'Focused question sets')),
    el('div', {class: 'stat-tile'}, el('strong', {}, 'Secure e-books'), el('span', {}, 'Read without downloads')),
    el('div', {class: 'stat-tile'}, el('strong', {}, 'Course groups'), el('span', {}, 'Learn with your peers'))),
  el('section', {class: 'section', id: 'available-courses'},
    el('div', {class: 'section-heading'}, el('div', {}, el('h2', {}, 'Explore preparation courses'), el('p', {}, 'Choose a course and unlock its complete study space.'))),
    list),
  el('section', {class: 'section'}, el('div', {class: 'section-heading'}, el('h2', {}, 'Everything you need to prepare')),
    el('div', {class: 'grid feature-grid'},
      el('article', {class: 'feature'}, el('span', {class: 'feature-icon', 'aria-hidden': 'true'}, '✓'), el('div', {}, el('h3', {}, 'Focused exam practice'), el('p', {}, 'Take clear mock tests and review your score whenever you are ready.'))),
      el('article', {class: 'feature'}, el('span', {class: 'feature-icon', 'aria-hidden': 'true'}, '▤'), el('div', {}, el('h3', {}, 'Built-in PDF reader'), el('p', {}, 'Study online with your verified mobile number watermarked on each page.'))),
      el('article', {class: 'feature'}, el('span', {class: 'feature-icon', 'aria-hidden': 'true'}, '↗'), el('div', {}, el('h3', {}, 'Simple UPI payment'), el('p', {}, 'Pay with any UPI app, submit the reference, and unlock after admin approval.'))))));
  loadInto(list, ctx, async () => {
    const courses = await api('/courses', {ctx});
    list.replaceChildren(...(courses.length ? courses.map((course, index) => {
      const owned = owns(me, course.id);
      const cover = el('div', {class: `card-cover alt-${index % 3}`},
        el('span', {}, owned ? 'Your learning space' : 'Mock tests + e-books'));
      const body = el('div', {class: 'card-body'}, owned ? el('span', {class: 'badge'}, 'Purchased') : null,
        el('h3', {}, course.title), el('p', {class: 'description'}, course.description), el('div', {class: 'spacer'}),
        el('div', {class: 'card-footer'}, owned ? el('span', {class: 'muted'}, 'Continue learning') : el('p', {class: 'price'}, priceText(course.price)),
          el('a', {class: 'button', href: `#course/${idPart(course.id)}`,
            'aria-label': `${owned ? 'Open' : 'View'} course: ${course.title}`}, owned ? 'Open course' : 'View')));
      return el('article', {class: 'panel card'}, cover, body);
    }) : [el('p', {class: 'empty'}, 'No courses are available yet. Check back soon for new study material.')]));
  });
}

export function showCourse(main, ctx, session, action) {
  const id = action.id;
  const path = `/courses/${idPart(id)}`;
  const intro = el('div', {class: 'course-intro'}, el('h1', {}, 'Course details'));
  const access = el('section', {class: 'panel section course-access'});
  const reviews = el('div');
  const owned = owns(session?.me, id);
  main.append(link('All courses', '#catalog', 'back'), intro, access, panel('Course reviews', reviews));

  loadInto(access, ctx, async () => {
    const courses = await api('/courses', {ctx});
    const course = courses.find(item => String(item.id) === id);
    if (!course) {
      access.replaceChildren(el('p', {class: 'empty'}, 'This course is no longer listed in the catalog.'));
      return;
    }
    intro.replaceChildren(el('div', {}, el('span', {class: 'eyebrow'}, 'Mock tests · E-books · Discussion'),
      ...heading(course.title), el('p', {class: 'lead description'}, course.description)),
      owned ? el('span', {class: 'badge'}, 'Purchased') : el('p', {class: 'price'}, priceText(course.price)));
    if (owned) {
      access.className = 'section';
      showMaterials(access, ctx, path, id);
    } else {
      access.replaceChildren(el('h2', {}, 'Course access'));
      if (!session) {
        access.append(el('p', {}, 'Sign in to purchase this course or access material you already own.'),
          action.signInLink('Sign in to continue'));
      } else if (!session.me) {
        access.append(action.profileUnavailable());
      } else {
        access.append(el('p', {}, 'Pay by UPI, submit the transaction reference, and unlock the course after admin approval.'));
        showManualPayment(access, ctx, session, course, path, action);
      }
    }
  });

  const list = el('div');
  reviews.append(list);
  const refreshReviews = () => loadInto(list, ctx, async () => {
    const rows = await api(`${path}/reviews`, {ctx});
    list.replaceChildren(entries(rows, 'No reviews yet.', entry => [
      el('strong', {}, entry.name), el('p', {class: 'muted'}, `${entry.rating} out of 5`),
      el('p', {class: 'entry-text'}, entry.text)
    ]));
  });
  refreshReviews();
  if (owned) {
    const rating = el('select', {required: ''}, el('option', {value: ''}, 'Choose a rating'),
      [5, 4, 3, 2, 1].map(value => el('option', {value}, `${value} out of 5`)));
    const text = el('textarea', {rows: '3', required: '', maxlength: '1000'});
    const submit = button('Save review', null, 'submit');
    const feedback = status();
    const form = el('form', {}, field('Rating', rating), field('Your review', text), submit, feedback);
    reviews.append(el('div', {class: 'section'}, el('h3', {}, 'Write or update your review'), form));
    bindForm(form, submit, feedback, async () => {
      await api(`${path}/reviews`, {ctx, auth: true, method: 'PUT',
        json: {rating: Number(rating.value), text: textValue(text, 'Review')}});
      say(feedback, 'Review saved.');
      refreshReviews();
    }, 'Saving review…');
  }
}

function showMaterials(access, ctx, path, id) {
  loadInto(access, ctx, async () => {
    const {tests, books, messages} = await api(path, {ctx, auth: true});
    const messageList = el('div');
    const refresh = items => messageList.replaceChildren(entries(items,
      'There are no messages yet. Start the discussion with a question or a study tip.', entry => [
        el('strong', {}, entry.name), el('p', {class: 'entry-text'}, entry.text)
      ]));
    refresh(messages);
    const text = el('textarea', {rows: '3', required: '', maxlength: '1000'});
    const submit = button('Post message', null, 'submit');
    const feedback = status();
    const form = el('form', {class: 'section'}, field('Your message', text), submit, feedback);
    bindForm(form, submit, feedback, async () => {
      await api(`${path}/messages`, {ctx, auth: true, method: 'POST', json: {text: textValue(text, 'Message')}});
      form.reset();
      try {
        const updated = await api(path, {ctx, auth: true});
        refresh(updated.messages);
        say(feedback, 'Message posted.');
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        say(feedback, 'Message posted. Reopen this course to refresh the discussion.', true);
      }
    }, 'Posting message…');
    access.replaceChildren(el('div', {class: 'grid'},
      panel('Practice tests', entries(tests, 'No practice tests have been published for this course yet.', test =>
        link(test.title, `#test/${idPart(id)}/${idPart(test.id)}`, 'material-link'))),
      panel('Study books', entries(books, 'No study books have been added to this course yet.', book => [
        link(book.title, `#book/${idPart(id)}/${idPart(book.id)}`, 'material-link'), el('p', {class: 'muted'}, `${book.pages} protected pages`)
      ]))), panel('Course discussion', messageList, form));
  });
}

function showManualPayment(target, ctx, session, course, path, action) {
  loadInto(target, ctx, async () => {
    const {amount, payment, order} = await api(`${path}/payment`, {ctx, auth: true});
    if (order?.status === 'pending') {
      const refresh = button('Check approval status', 'secondary');
      const feedback = status();
      refresh.addEventListener('click', () => run(refresh, feedback, async () => {
        await action.refreshProfile(session);
        if (owns(session.me, course.id)) action.purchased(course.title);
        else say(feedback, 'Your payment is still waiting for admin approval.');
      }, 'Checking status…'));
      target.replaceChildren(el('div', {class: 'payment-status pending'},
        el('span', {class: 'status-icon', 'aria-hidden': 'true'}, '◷'), el('h2', {}, 'Payment submitted'),
        el('p', {}, 'Your payment proof is with the admin. Course access is unlocked after confirmation.'),
        el('dl', {class: 'payment-summary'}, el('dt', {}, 'Amount'), el('dd', {}, priceText(amount)),
          el('dt', {}, 'UPI reference'), el('dd', {}, order.reference)), refresh, feedback));
      return;
    }
    if (!payment.configured) {
      target.replaceChildren(el('div', {class: 'payment-status'},
        el('h2', {}, 'Payments are being configured'),
        el('p', {}, 'UPI details are not available yet. Contact support before making a payment.'),
        link('Contact support', '#support', 'button secondary')));
      return;
    }
    const reference = el('input', {required: '', maxlength: '80', autocomplete: 'off', placeholder: 'Example: 418276930125'});
    const note = el('textarea', {rows: '2', maxlength: '500', placeholder: 'Optional note from your payment app'});
    const submit = button('Submit for admin approval', null, 'submit');
    const feedback = status();
    const form = el('form', {class: 'payment-proof'},
      field('UPI transaction reference', reference, 'Copy the reference shown after your payment succeeds.'),
      field('Payment note (optional)', note), submit, feedback);
    bindForm(form, submit, feedback, async () => {
      await api(`${path}/payment`, {ctx, auth: true, method: 'POST',
        json: {reference: textValue(reference, 'UPI transaction reference'), note: note.value.trim()}});
      showManualPayment(target, ctx, session, course, path, action);
    }, 'Submitting payment…');
    target.replaceChildren(el('div', {class: 'manual-payment'},
      el('div', {class: 'payment-steps'}, el('span', {}, '1'),
        el('div', {}, el('h2', {}, `Pay ${priceText(amount)}`),
          el('p', {class: 'muted'}, `Use your preferred UPI app to pay ${payment.payeeName}.`))),
      el('div', {class: 'payment-grid'},
        el('div', {class: 'qr-card'}, el('img', {src: payment.qr,
          alt: `UPI QR code to pay ${payment.payeeName}`, width: '220', height: '220'}),
          el('strong', {}, payment.payeeName), el('code', {}, payment.upiId)),
        el('div', {class: 'payment-instructions'}, el('h3', {}, 'After paying'),
          el('ol', {}, el('li', {}, 'Keep the successful payment screen or SMS.'),
            el('li', {}, 'Copy its transaction reference.'), el('li', {}, 'Submit the reference below for admin approval.')),
          order?.status === 'rejected' ? el('div', {class: 'rejection', role: 'alert'},
            el('strong', {}, 'Payment not approved'), el('p', {}, order.reviewNote || 'Check the payment and submit again.')) : null)),
      el('div', {class: 'payment-form-panel'}, el('span', {}, '2'),
        el('div', {}, el('h3', {}, 'Submit payment proof'), form))));
  });
}
