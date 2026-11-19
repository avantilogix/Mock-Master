import {api, loadCheckout} from './services.js';
import {bindForm, button, el, entries, field, heading, idPart, link, loadInto, panel, run, say, status, textValue} from './ui.js';

const inr = new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR'});
export const priceText = paise => inr.format(paise / 100);
export const owns = (me, id) => me?.purchases?.some(purchase => String(purchase) === String(id));

export function showCatalog(main, ctx, me) {
  const list = el('div', {class: 'grid'});
  main.append(el('div', {class: 'hero'}, el('p', {class: 'eyebrow'}, 'Learn · Practice · Improve'),
    ...heading('Build confidence with practice', 'Explore courses with mock tests and study books. Pick a course and learn at your own pace.')),
  el('section', {class: 'section'}, el('h2', {}, 'Available courses'), list));
  loadInto(list, ctx, async () => {
    const courses = await api('/courses', {ctx});
    list.replaceChildren(...(courses.length ? courses.map(course => {
      const owned = owns(me, course.id);
      return el('article', {class: 'panel card'}, owned ? el('span', {class: 'badge'}, 'Purchased') : null,
        el('h3', {}, course.title), el('p', {class: 'description'}, course.description),
        el('div', {class: 'spacer'}), owned ? null : el('p', {class: 'price'}, priceText(course.price)),
        el('a', {class: 'button', href: `#course/${idPart(course.id)}`,
          'aria-label': `${owned ? 'Open' : 'View'} course: ${course.title}`}, owned ? 'Open course' : 'View course'));
    }) : [el('p', {class: 'empty'}, 'No courses are available yet. Check back soon for new study material.')]));
  });
}

export function showCourse(main, ctx, session, action) {
  const id = action.id;
  const path = `/courses/${idPart(id)}`;
  const intro = el('div', {}, el('h1', {}, 'Course details'));
  const access = el('section', {class: 'panel section'});
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
    intro.replaceChildren(...heading(course.title),
      el('p', {class: 'lead description'}, course.description),
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
        access.append(el('p', {}, 'Purchase this course to unlock tests, books, and the course discussion.'));
        showCheckout(access, ctx, session, course, path, action);
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
        link(test.title, `#test/${idPart(id)}/${idPart(test.id)}`, 'back'))),
      panel('Study books', entries(books, 'No study books have been added to this course yet.', book => [
        link(book.title, `#book/${idPart(id)}/${idPart(book.id)}`, 'back'), el('p', {class: 'muted'}, `${book.pages} pages`)
      ]))), panel('Course discussion', messageList, form));
  });
}

function showCheckout(target, ctx, session, course, path, action) {
  const pay = button(`Pay ${priceText(course.price)}`);
  const feedback = status();
  const key = String(course.id);
  const payments = session.payments;

  async function finish(payment) {
    if (!payment.verified) {
      say(feedback, 'Verifying your payment…');
      try {
        await api(`${path}/verify`, {ctx: session, auth: true, method: 'POST', json: payment.details});
        payment.verified = true;
        payment.details = null;
      } catch (error) {
        if (!session.current()) return;
        throw new Error(`Payment was received by checkout but could not be verified. Retry verification instead of paying again. ${error.message}`);
      }
    }
    try {
      await action.refreshProfile(session);
    } catch (error) {
      if (!session.current()) return;
      throw new Error(`Payment verified, but your course access could not refresh. Try refreshing access again. ${error.message}`);
    }
    if (!owns(session.me, key)) throw new Error('Payment verified. Course access is not available yet; try refreshing access again.');
    payments.delete(key);
    action.purchased(course.title);
  }

  function updateButton() {
    const pending = payments.get(key);
    pay.textContent = pending ? (pending.verified ? 'Refresh course access' : 'Retry payment verification') : `Pay ${priceText(course.price)}`;
  }

  pay.addEventListener('click', () => run(pay, feedback, async () => {
    const pending = payments.get(key);
    try {
      if (pending) {
        if (!pending.task) pending.task = finish(pending).finally(() => { pending.task = null; });
        await pending.task;
        return;
      }
      const Razorpay = await loadCheckout();
      const order = await api(`${path}/order`, {ctx, auth: true, method: 'POST'});
      await new Promise((resolve, reject) => {
        let settled = false;
        const done = () => { ctx.signal.removeEventListener('abort', close); resolve(); };
        const close = () => {
          if (!settled) {
            settled = true;
            checkout.close?.();
            done();
          }
        };
        const checkout = new Razorpay({
          key: order.key, order_id: order.id, amount: order.amount, currency: order.currency,
          name: 'Mock Master', description: course.title,
          handler(response) {
            if (settled || !session.current()) return;
            settled = true;
            const payment = {details: {
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature
            }, verified: false};
            payments.set(key, payment);
            payment.task = finish(payment).finally(() => { payment.task = null; });
            payment.task.then(done, error => {
              ctx.signal.removeEventListener('abort', close);
              reject(error);
            });
          },
          modal: {ondismiss() {
            if (settled) return;
            settled = true;
            say(feedback, 'Checkout closed before verification.');
            done();
          }}
        });
        checkout.on('payment.failed', () => {
          if (!settled && ctx.current()) say(feedback, 'Payment failed. Retry in checkout or close it to try later.', true);
        });
        ctx.signal.addEventListener('abort', close, {once: true});
        try {
          checkout.open();
        } catch {
          ctx.signal.removeEventListener('abort', close);
          reject(new Error('Checkout could not open. Please try again.'));
        }
      });
    } finally {
      updateButton();
    }
  }, 'Preparing checkout…'));
  updateButton();
  target.append(pay, feedback);
}
