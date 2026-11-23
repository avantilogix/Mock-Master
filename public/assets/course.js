import {api} from './services.js';
import {coverGallery} from './publishing-media.js';
import {bindForm, button, el, entries, field, formatDate, heading, icon, idPart, link, loadInto, panel, rule, run, say, status, textValue} from './ui.js';

export const upiReference = control => rule(control, value =>
  /^[A-Za-z0-9][A-Za-z0-9 _/.-]{2,79}$/.test(value) ? '' :
    'Enter a valid UPI transaction reference (3–80 letters, numbers, spaces, or . _ / -).');

const inr = new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR'});
export const priceText = paise => inr.format(paise / 100);
export const owns = (me, id) => me?.purchases?.some(purchase => String(purchase) === String(id));

function expiryLabel(course) {
  if (!course.expiresOn) return null;
  return el('p', {class: `course-expiry${course.expired ? ' expired' : ''}`},
    course.expired ? 'Expired on ' : 'Access through ',
    el('time', {datetime: course.expiresOn}, formatDate(course.expiresOn, false)), ' (IST)');
}

const shortcut = (glyph, title, description, href, tone = '') => el('a',
  {class: `shortcut ${tone}`, href},
  el('span', {class: 'shortcut-icon'}, icon(glyph, 'line-icon')),
  el('strong', {}, title), el('small', {}, description));

function courseCard(course, index, me) {
  const owned = owns(me, course.id);
  const cover = coverGallery(course) || el('div', {class: `card-cover alt-${index % 3}`},
    el('span', {}, owned ? 'Your Learning Space' : 'Mock Tests + E-Books'));
  const body = el('div', {class: 'card-body'}, owned ? el('span', {class: 'badge'}, 'Purchased') : null,
    el('h3', {}, course.title), expiryLabel(course), el('p', {class: 'description tile-description'}, course.description),
    el('div', {class: 'spacer'}),
    link('Read more', `#course/${idPart(course.id)}`, 'text-link tile-read-more'),
    el('div', {class: 'card-footer'}, course.expired ? el('span', {class: 'muted'}, 'Access closed') :
      owned ? el('span', {class: 'muted'}, 'Continue Learning') : el('p', {class: 'price'}, priceText(course.price)),
      el('a', {class: 'button', href: `#course/${idPart(course.id)}`,
        'aria-label': `${owned && !course.expired ? 'Open' : 'View'} course: ${course.title}`}, owned && !course.expired ? 'Open Course' : 'View Details')));
  return el('article', {class: 'panel card'}, cover, body);
}

export function showDashboard(main, ctx, me) {
  const name = me?.name?.trim() || 'Learner';
  const courses = el('div', {class: 'grid'});
  const missionCount = el('strong', {}, String(me?.purchases?.length || 0));
  main.append(
    el('section', {class: 'dashboard-welcome'},
      el('div', {}, el('p', {class: 'eyebrow'}, 'Mission Selection'), el('h1', {}, `Hello, ${name}`),
        el('p', {class: 'lead'}, 'Your next selection starts with today’s practice. Pick up where you left off.')),
      el('div', {class: 'dashboard-score'}, el('span', {}, me ? 'Your Missions' : 'Available Missions'), missionCount,
        link(me ? 'Open My Courses' : 'Sign In to Begin', me ? '#my-courses' : '#signin', 'button'))),
    el('section', {class: 'section'},
      el('div', {class: 'section-heading'}, el('h2', {}, 'Start Learning'), link('View All Missions', '#catalog')),
      el('div', {class: 'shortcut-grid'},
        shortcut('courses', 'My Courses', 'Continue purchased learning', '#my-courses', 'mint'),
        shortcut('test', 'Test Series', 'Practice exam questions', '#test-series', 'blue'),
        shortcut('star', 'Free Tests', 'Try open practice content', '#free-tests', 'mint'),
        shortcut('courses', 'Book Store', 'Find secure study books', '#book-store', 'orange'),
        shortcut('files', 'Study Materials', 'Open your saved PDFs', '#materials', 'purple'),
        shortcut('news', 'Current Affairs', 'Daily exam updates', '#current-affairs', 'rose'),
        shortcut('progress', 'Progress', 'Accuracy and attempts', '#progress', 'yellow'),
        shortcut('bell', 'Notifications', 'Course and payment updates', '#notifications', 'blue'),
        shortcut('history', 'Previous Year Questions', 'Practice earlier questions', '#pyqs', 'mint'),
        shortcut('news', 'Syllabus', 'View topics and learning plan', '#syllabus', 'purple'),
        shortcut('calendar', 'Timetable', 'Plan your study week', '#timetable', 'blue'),
        shortcut('gift', 'Refer & Earn', 'Share your personal code', '#referrals', 'yellow'),
        shortcut('download', 'Downloads', 'Save approved content', '#downloads', 'purple'),
        shortcut('play', 'YouTube Videos', 'Watch focused lessons', '#videos', 'rose'),
        shortcut('chat', 'Course Groups', 'Discuss with purchasers', '#groups', 'blue'),
        shortcut('share', 'Share & Rate', 'Invite and review', '#share-app', 'yellow'),
        shortcut('profile', me ? 'Profile' : 'Sign In', me ? 'Manage your account' : 'Use your mobile number', me ? '#profile' : '#signin', 'yellow'))),
    el('section', {class: 'section'},
      el('div', {class: 'section-heading'}, el('h2', {}, me?.purchases?.length ? 'Continue Learning' : 'Popular Missions'),
        link('Browse Catalog', '#catalog')),
      courses));
  loadInto(courses, ctx, async () => {
    const rows = await api('/courses', {ctx});
    if (!me) missionCount.textContent = String(rows.length);
    const selected = me?.purchases?.length ? rows.filter(course => owns(me, course.id)) : rows.slice(0, 3);
    courses.replaceChildren(...(selected.length ? selected.map(courseCardWithProfile(me)) :
      [el('p', {class: 'empty'}, me ? 'No purchased missions yet. Explore the catalog to begin.' : 'Explore available missions and sign in when you are ready.')]));
  });
}

const courseCardWithProfile = me => (course, index) => courseCard(course, index, me);

export function showMyCourses(main, ctx, me, action) {
  main.append(...heading('My Courses', 'Continue your purchased missions, mock tests, study books, and course discussions.'));
  if (!ctx.user) {
    main.append(panel('Your Learning Library', el('p', {}, 'Sign in to restore courses purchased with your mobile number.'),
      action.signInLink()));
    return;
  }
  const list = el('div', {class: 'grid'});
  main.append(list);
  loadInto(list, ctx, async () => {
    const rows = await api('/courses', {ctx});
    const purchased = rows.filter(course => owns(me, course.id));
    list.replaceChildren(...(purchased.length ? purchased.map(courseCardWithProfile(me)) :
      [el('div', {class: 'empty-library'}, el('h2', {}, 'Your First Mission Is Waiting'),
        el('p', {class: 'muted'}, 'Purchase a course and it will appear here automatically.'),
        link('Explore Missions', '#catalog', 'button'))]));
  });
}

function chapterGroups(books, videos) {
  const subjects = new Map();
  const add = (item, key) => {
    if (!subjects.has(item.subject)) subjects.set(item.subject, new Map());
    const chapters = subjects.get(item.subject);
    if (!chapters.has(item.chapter)) chapters.set(item.chapter, {books: [], videos: []});
    chapters.get(item.chapter)[key].push(item);
  };
  books.forEach(book => add(book, 'books'));
  videos.forEach(video => add(video, 'videos'));
  return subjects;
}

function chapterFolders(subjects, courseId) {
  const sortNames = ([a], [b]) => a.localeCompare(b, undefined, {numeric: true});
  if (!subjects.size) return el('p', {class: 'empty'}, 'No study books or videos have been added to this course yet.');
  return el('div', {class: 'subject-list'}, [...subjects].sort(sortNames).map(([subject, chapters]) =>
    el('details', {class: 'subject-folder', open: ''},
      el('summary', {}, el('strong', {}, subject), el('span', {}, `${chapters.size} chapters`)),
      el('div', {class: 'chapter-list'}, [...chapters].sort(sortNames).map(([chapter, {books, videos}]) =>
        el('section', {class: 'chapter-group', 'aria-label': chapter},
          el('h3', {class: 'chapter-name'}, chapter),
          books.map(book => el('div', {class: 'chapter-book'}, coverGallery(book, 'book-gallery'),
            link(`PDF · ${book.title}`, `#book/${idPart(courseId)}/${idPart(book.id)}`, 'chapter-link'))),
          videos.map(video => link(`Video · ${video.title}`, `#video/${idPart(courseId)}/${idPart(video.id)}`, 'chapter-link video-link'))))))));
}

export function showContentLibrary(main, ctx, me, kind, action) {
  const config = {
    'test-series': { title: 'Test Series', icon: '✓', description: 'Choose a purchased mission and start a published mock test.', empty: 'Tests become available after you purchase a mission.', item: 'tests' },
    'book-store': { title: 'Book Store', icon: '▤', description: 'Browse missions that include protected digital study books.', empty: 'No digital books are currently listed.', item: 'books' },
    'materials': { title: 'Study Materials', icon: '⌑', description: 'Open secure PDF books and chapter videos from your purchased missions.', empty: 'No purchased study materials yet.', item: 'books' },
  }[kind];
  main.append(...heading(config.title, config.description));
  const content = el('div');
  main.append(el('section', {class: 'library-panel'}, content));
  if (kind === 'materials' && !ctx.user) {
    content.replaceChildren(el('div', {class: 'empty-library'}, el('span', {class: 'shortcut-icon'}, config.icon),
      el('h2', {}, 'Sign In to Open Your Library'), action.signInLink('Sign In')));
    return;
  }
  loadInto(content, ctx, async () => {
    const rows = await api('/courses', {ctx});
    const selected = kind === 'materials' ? rows.filter(course => owns(me, course.id) && !course.expired) : rows;
    if (!selected.length) {
      content.replaceChildren(el('div', {class: 'empty-library'}, el('h2', {}, config.empty),
        link('Explore Missions', '#catalog', 'button secondary')));
      return;
    }
    const folders = await Promise.all(selected.map(async course => {
      if (kind === 'book-store' || !owns(me, course.id) || course.expired) {
        return el('article', {class: 'library-folder'},
          el('span', {class: 'folder-icon', 'aria-hidden': 'true'}, config.icon),
          el('div', {}, el('h2', {}, course.title), expiryLabel(course), el('p', {class: 'muted'}, course.description)),
          link(course.expired ? 'View Details' : owns(me, course.id) ? 'Open Mission' : `View at ${priceText(course.price)}`,
            `#course/${idPart(course.id)}`, 'button secondary'));
      }
      const material = await api(`/courses/${idPart(course.id)}`, {ctx, auth: true});
      if (config.item === 'books') {
        const subjects = chapterGroups(material.books, material.videos || []);
        const chapterCount = [...subjects.values()].reduce((sum, chapters) => sum + chapters.size, 0);
        return el('article', {class: 'course-material'},
          el('div', {class: 'course-material-head'},
            el('span', {class: 'folder-icon', 'aria-hidden': 'true'}, config.icon),
            el('div', {}, el('h2', {}, course.title), el('p', {class: 'muted'},
              `${subjects.size} subjects · ${chapterCount} chapters`))),
          chapterFolders(subjects, course.id));
      }
      return el('article', {class: 'library-folder'},
        el('span', {class: 'folder-icon', 'aria-hidden': 'true'}, config.icon),
        el('div', {class: 'library-folder-content'},
          el('h2', {}, course.title),
          entries(material[config.item], config.empty, item => el('div', {class: 'test-series-row'},
           el('div', {}, el('strong', {}, item.title), item.live ? el('span', {class: 'badge live-badge'},
             `Live · ${formatDate(item.startsAt)} IST · ${item.durationMinutes} min`) : null),
           link('Start Test', `#test/${idPart(course.id)}/${idPart(item.id)}`, 'button secondary')))));
    }));
    content.replaceChildren(...folders);
  });
}

export function showCatalog(main, ctx, me) {
  const list = el('div', {class: 'grid'});
  main.append(el('section', {class: 'hero'},
    el('div', {class: 'hero-copy'}, el('p', {class: 'eyebrow'}, 'Your Preparation Partner'),
      ...heading('Choose Your Mission. Own Your Result.', 'Build exam-day confidence with focused mock tests, secure study books, and a learning community built around your goal.'),
      el('div', {class: 'hero-actions'}, link('Explore Missions', '#catalog', 'button'),
        link(me ? 'View Your Profile' : 'Sign In with Mobile', me ? '#profile' : '#signin', 'button secondary')),
      el('div', {class: 'hero-proof'}, el('span', {}, 'Mobile OTP Access'), el('span', {}, 'Protected Content'), el('span', {}, 'Verified UPI Payments'))),
    el('div', {class: 'hero-art', 'aria-hidden': 'true'}, el('strong', {}, 'Stay Mission Ready'), el('div', {class: 'progress-ring'}, '01'), el('small', {}, 'Pick a mission. Start practising.'))),
  el('div', {class: 'stat-strip', 'aria-label': 'Mission Selection benefits'},
    el('div', {class: 'stat-tile'}, el('strong', {}, 'Practice Tests'), el('span', {}, 'Focused question sets')),
    el('div', {class: 'stat-tile'}, el('strong', {}, 'Secure E-Books'), el('span', {}, 'Read without downloads')),
    el('div', {class: 'stat-tile'}, el('strong', {}, 'Course Groups'), el('span', {}, 'Learn with your peers'))),
  el('section', {class: 'section', id: 'available-courses'},
    el('div', {class: 'section-heading'}, el('div', {}, el('h2', {}, 'Explore Preparation Courses'), el('p', {}, 'Choose a course and unlock its complete study space.'))),
    list),
  el('section', {class: 'section'}, el('div', {class: 'section-heading'}, el('h2', {}, 'Everything You Need to Prepare')),
    el('div', {class: 'grid feature-grid'},
      el('article', {class: 'feature'}, el('span', {class: 'feature-icon', 'aria-hidden': 'true'}, '✓'), el('div', {}, el('h3', {}, 'Focused Exam Practice'), el('p', {}, 'Take clear mock tests and review your score whenever you are ready.'))),
      el('article', {class: 'feature'}, el('span', {class: 'feature-icon', 'aria-hidden': 'true'}, '▤'), el('div', {}, el('h3', {}, 'Built-In PDF Reader'), el('p', {}, 'Study online with your verified mobile number watermarked on each page.'))),
      el('article', {class: 'feature'}, el('span', {class: 'feature-icon', 'aria-hidden': 'true'}, '↗'), el('div', {}, el('h3', {}, 'Simple UPI Payment'), el('p', {}, 'Pay with any UPI app, submit the reference, and unlock after admin approval.'))))));
  loadInto(list, ctx, async () => {
    const courses = await api('/courses', {ctx});
    list.replaceChildren(...(courses.length ? courses.map(courseCardWithProfile(me)) :
      [el('p', {class: 'empty'}, 'No courses are available yet. Check back soon for new study material.')]));
  });
}

export function showCourse(main, ctx, session, action) {
  const id = action.id;
  const path = `/courses/${idPart(id)}`;
  const intro = el('div', {class: 'course-intro'}, el('h1', {}, 'Course Details'));
  const media = el('div', {class: 'course-detail-media', hidden: ''});
  const access = el('section', {class: 'panel section course-access'});
  const reviews = el('div');
  const owned = owns(session?.me, id);
  main.append(link('All Courses', '#catalog', 'back'), intro, media, access, panel('Course Reviews', reviews));

  loadInto(access, ctx, async () => {
    const courses = await api('/courses', {ctx});
    const course = courses.find(item => String(item.id) === id);
    if (!course) {
      access.replaceChildren(el('p', {class: 'empty'}, 'This course is no longer listed in the catalog.'));
      return;
    }
    intro.replaceChildren(el('div', {}, el('span', {class: 'eyebrow'}, 'Mock tests · E-books · Discussion'),
      ...heading(course.title), expiryLabel(course), el('p', {class: 'lead description'}, course.description)),
      ...(owned ? [el('span', {class: 'badge'}, 'Purchased')] :
        course.expired ? [] : [el('p', {class: 'price'}, priceText(course.price))]));
    const gallery = coverGallery(course);
    if (gallery) {
      media.hidden = false;
      media.append(gallery);
    }
    if (course.expired) {
      access.replaceChildren(el('h2', {}, 'Course Expired'),
        el('p', {}, 'This course is closed to new purchases and study access.'),
        link('Explore Active Courses', '#catalog', 'button secondary'));
    } else if (owned) {
      access.className = 'section';
      showMaterials(access, ctx, path, id);
      showReviewForm();
    } else {
      access.replaceChildren(el('h2', {}, 'Course Access'));
      if (!session) {
        access.append(el('p', {}, 'Sign in to purchase this course or access material you already own.'),
          action.signInLink('Sign In to Continue'));
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
  function showReviewForm() {
    const rating = el('select', {required: ''}, el('option', {value: ''}, 'Choose a Rating'),
      [5, 4, 3, 2, 1].map(value => el('option', {value}, `${value} out of 5`)));
    const text = el('textarea', {rows: '3', required: '', maxlength: '1000'});
    const submit = button('Save Review', null, 'submit');
    const feedback = status();
    const form = el('form', {}, field('Rating', rating), field('Your Review', text), submit, feedback);
    reviews.append(el('div', {class: 'section'}, el('h3', {}, 'Write or Update Your Review'), form));
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
    const {tests, books, videos = [], messages} = await api(path, {ctx, auth: true});
    const messageList = el('div');
    const refresh = items => messageList.replaceChildren(entries(items,
      'There are no messages yet. Start the discussion with a question or a study tip.', entry => [
        el('strong', {}, entry.name), el('p', {class: 'entry-text'}, entry.text)
      ]));
    refresh(messages);
    const text = el('textarea', {rows: '3', required: '', maxlength: '1000'});
    const submit = button('Post Message', null, 'submit');
    const feedback = status();
    const form = el('form', {class: 'section'}, field('Your Message', text), submit, feedback);
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
    access.replaceChildren(panel('Practice & Live Tests', entries(tests, 'No practice tests have been published for this course yet.', test =>
      el('div', {class: 'test-series-row'},
        el('div', {}, link(test.title, `#test/${idPart(id)}/${idPart(test.id)}`, 'material-link'),
          test.live ? el('span', {class: 'badge live-badge'},
            `Live · ${formatDate(test.startsAt)} IST · ${test.durationMinutes} min`) : null),
        link('Start', `#test/${idPart(id)}/${idPart(test.id)}`, 'button secondary')))),
    panel('Study Materials by Chapter', chapterFolders(chapterGroups(books, videos), id)),
    panel('Course Discussion', messageList, form));
  });
}

function showManualPayment(target, ctx, session, course, path, action) {
  loadInto(target, ctx, async () => {
    const {amount, credits = 0, payment, order} = await api(`${path}/payment`, {ctx, auth: true});
    if (order?.status === 'pending') {
      const refresh = button('Check Approval Status', 'secondary');
      const feedback = status();
      refresh.addEventListener('click', () => run(refresh, feedback, async () => {
        await action.refreshProfile(session);
        if (owns(session.me, course.id)) action.purchased(course.title);
        else say(feedback, 'Your payment is still waiting for admin approval.');
      }, 'Checking status…'));
      target.replaceChildren(el('div', {class: 'payment-status pending'},
        el('span', {class: 'status-icon', 'aria-hidden': 'true'}, '◷'), el('h2', {}, 'Payment Submitted'),
        el('p', {}, 'Your payment proof is with the admin. Course access is unlocked after confirmation.'),
        el('dl', {class: 'payment-summary'}, el('dt', {}, 'Amount'), el('dd', {}, priceText(amount)),
          el('dt', {}, 'UPI reference'), el('dd', {}, order.reference)), refresh, feedback));
      return;
    }
    if (!payment.configured) {
      target.replaceChildren(el('div', {class: 'payment-status'},
        el('h2', {}, 'Payments Are Being Configured'),
        el('p', {}, 'UPI details are not available yet. Contact support before making a payment.'),
        link('Contact Support', '#support', 'button secondary')));
      return;
    }
    const methodButtons = el('div', {class: 'payment-methods'});
    const methodPanel = el('div');
    const renderMethod = method => {
      methodButtons.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.method === method)));
      if (method === 'upi') {
        methodPanel.replaceChildren(el('div', {class: 'upi-details'},
          el('span', {}, 'UPI ID'), el('strong', {}, payment.upiId), el('small', {}, `Payee: ${payment.payeeName}`)));
      } else {
        methodPanel.replaceChildren(el('div', {class: 'qr-card'}, el('img', {src: payment.qr,
          alt: `Payment QR for ${payment.payeeName || 'Mission Selection'}`, width: '220', height: '220'}),
          el('strong', {}, payment.payeeName || 'Mission Selection'),
          payment.customQr ? el('small', {}, 'Scan using your UPI application') : el('small', {}, payment.upiId)));
      }
    };
    const methods = payment.method === 'both' ? ['upi', 'qr'] : [payment.method];
    for (const method of methods) {
      const control = button(method === 'upi' ? 'Pay by UPI ID' : 'Scan QR Code', 'secondary');
      control.dataset.method = method;
      control.addEventListener('click', () => renderMethod(method));
      methodButtons.append(control);
    }
    const reference = upiReference(el('input', {required: '', maxlength: '80', autocomplete: 'off', placeholder: 'Example: 418276930125'}));
    const useCredits = el('input', {type: 'checkbox'});
    const creditPanel = credits > 0 ? el('label', {class: 'credit-option'},
      useCredits, el('span', {}, `Use available credits: ₹${credits}`)) : null;
    const note = el('textarea', {rows: '2', maxlength: '500', placeholder: 'Optional note from your payment app'});
    const submit = button('Submit for Admin Approval', null, 'submit');
    const feedback = status();
    const amountMessage = el('p', {class: 'due-amount'});
    const updateAmount = () => {
      const due = Math.max(0, amount - (useCredits.checked ? Math.min(credits, Math.ceil(amount / 100)) * 100 : 0));
      amountMessage.textContent = `Amount to pay: ${priceText(due)}`;
      reference.required = due > 0;
      reference.closest('.field').hidden = due === 0;
    };
    useCredits.addEventListener('change', updateAmount);
    const form = el('form', {class: 'payment-proof'}, creditPanel, amountMessage,
      field('UPI Transaction Reference', reference, 'Copy the reference shown after your payment succeeds.'),
      field('Payment Note (optional)', note), submit, feedback);
    bindForm(form, submit, feedback, async () => {
      const result = await api(`${path}/payment`, {ctx, auth: true, method: 'POST',
        json: {reference: reference.required ? textValue(reference, 'UPI transaction reference') : reference.value.trim(),
          note: note.value.trim(), useCredits: useCredits.checked}});
      if (result.status === 'approved') {
        await action.refreshProfile(session);
        action.purchased(course.title);
        return;
      }
      showManualPayment(target, ctx, session, course, path, action);
    }, 'Submitting payment…');
    target.replaceChildren(el('div', {class: 'manual-payment'},
      el('div', {class: 'payment-steps'}, el('span', {}, '1'),
        el('div', {}, el('h2', {}, `Pay ${priceText(amount)}`),
          el('p', {class: 'muted'}, `Use your preferred UPI app to pay ${payment.payeeName}.`))),
      el('div', {class: 'payment-grid'},
        el('div', {class: 'payment-choice'}, methodButtons, methodPanel),
        el('div', {class: 'payment-instructions'}, el('h3', {}, 'After Paying'),
          el('ol', {}, el('li', {}, 'Keep the successful payment screen or SMS.'),
            el('li', {}, 'Copy its transaction reference.'), el('li', {}, 'Submit the reference below for admin approval.')),
          order?.status === 'rejected' ? el('div', {class: 'rejection', role: 'alert'},
            el('strong', {}, 'Payment Not Approved'), el('p', {}, order.reviewNote || 'Check the payment and submit again.')) : null)),
      el('div', {class: 'payment-form-panel'}, el('span', {}, '2'),
        el('div', {}, el('h3', {}, 'Submit Payment Proof'), form))));
    renderMethod(methods[0]);
    updateAmount();
  });
}
