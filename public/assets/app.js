import {showAdmin} from './admin.js?v=cards-support-exam-final';
import {showCatalog, showContentLibrary, showCourse, showDashboard, showMyCourses} from './course.js?v=cards-support-exam-final';
import {api, firebaseAuth} from './services.js?v=ebook-store-final';
import {showSignIn} from './signin.js';
import {showBook, showTest, showVideo} from './study.js?v=cards-support-exam-final';
import {showLearningContent, showNotifications, showProgress} from './reports.js?v=manage-20261122';
import {showDownloads, showReferrals, showTimetable, socialFooter} from './features.js?v=expiry-covers-1';
import {showCourseGroups, showShareRate, showVideos} from './engagement.js?v=expiry-covers-1';
import {showEbook, showEbookStore} from './ebooks.js?v=ist-payment-fixes-final';
import {bindForm, button, el, field, heading, icon, link, panel, run, say, status, textValue} from './ui.js';

const main = document.querySelector('#main');
const nav = document.querySelector('#nav');
const notice = document.querySelector('#notice');
const routes = new Map([
  ['home', 0], ['catalog', 0], ['my-courses', 0], ['test-series', 0], ['book-store', 0], ['materials', 0],
  ['free-tests', 0], ['current-affairs', 0], ['pyqs', 0], ['syllabus', 0], ['progress', 0], ['notifications', 0],
  ['timetable', 0], ['referrals', 0], ['downloads', 0],
  ['videos', 0], ['groups', 0], ['share-app', 0], ['about', 0],
  ['course', 1], ['test', 2], ['book', 2], ['ebook', 1], ['video', 2], ['signin', 0],
  ['profile', 0], ['support', 0], ['admin', 0]
]);
let firebase;
let session;
let view;
let authState = 'idle';
let signingOut = false;
let activeHash;

function route(hash = location.hash) {
  const [path, query] = hash.slice(1).split('?', 2);
  const [page, ...encoded] = (path || 'home').split('/');
  try {
    const args = encoded.map(decodeURIComponent);
    if (routes.get(page) === args.length && args.every(value => value && value !== '.' && value !== '..')) {
      return {page, args, query: new URLSearchParams(query)};
    }
  } catch { /* Invalid percent encoding. */ }
  return {page: 'missing', args: []};
}

function nextAfterSignIn(parsed) {
  const next = parsed.query?.get('next');
  if (!next?.startsWith('#') || ['signin', 'missing'].includes(route(next).page)) return '#home';
  return next;
}

function signInLink(label = 'Sign In') {
  const next = location.hash || '#catalog';
  return link(label, `#signin?${new URLSearchParams({next})}`, 'button');
}

async function startAuth() {
  if (authState === 'loading') return;
  authState = 'loading';
  if (route().page === 'signin') render();
  try {
    firebase = await firebaseAuth();
    firebase.sdk.onAuthStateChanged(firebase.auth, user => {
      const first = authState !== 'ready';
      authState = 'ready';
      if (signingOut && user) return;
      if (user !== (session?.user ?? null)) setSession(user);
      else if (first && ['signin', 'timetable'].includes(route().page)) render();
    });
  } catch {
    authState = 'error';
    if (route().page === 'signin') render();
  }
}

function setSession(user) {
  session?.controller.abort();
  notice.textContent = '';
  session = null;
  if (user) {
    const controller = new AbortController();
    const current = {
      user, controller, signal: controller.signal, pending: true,
      current: () => session === current && !controller.signal.aborted && firebase.auth.currentUser === user
    };
    session = current;
    initializeProfile(current);
  }
  render(true);
}

async function refreshProfile(current) {
  const me = await api('/me', {ctx: current, auth: true});
  if (current.current()) current.me = me;
}

async function initializeProfile(current) {
  try {
    await refreshProfile(current);
    const examPreference = localStorage.getItem('missionExam');
    if (examPreference && current.me?.examPreference !== examPreference) {
      const result = await api('/me', {ctx: current, auth: true, method: 'PUT', json: {examPreference}});
      if (current.current()) current.me.examPreference = result?.examPreference || examPreference;
    }
  } catch (error) {
    if (current.current()) current.error = error.message;
  } finally {
    if (current.current()) {
      current.pending = false;
      const parsed = route();
      if (parsed.page === 'signin' && current.me?.admin) location.replace('#admin');
      else render(main.contains(document.activeElement));
    }
  }
}

function renderNav(parsed) {
  const catalogActive = ['catalog', 'course', 'test', 'book', 'test-series', 'book-store', 'materials'].includes(parsed.page);
  const navLink = (label, short, glyph, href, active) => el('a', {href, 'data-short': short, 'aria-label': label, 'aria-current': active ? 'page' : null},
    el('span', {class: 'nav-indicator'}, icon(glyph, 'line-icon')), el('span', {class: 'nav-label', 'data-short': short}, label));
  nav.replaceChildren(navLink('Home', 'Home', 'home', '#home', parsed.page === 'home'),
    navLink('Missions', 'Store', 'missions', '#catalog', catalogActive),
    navLink('My Courses', 'My', 'courses', '#my-courses', parsed.page === 'my-courses'),
    navLink('Progress', 'Stats', 'progress', '#progress', parsed.page === 'progress'),
    session ? navLink('Profile', 'Me', 'profile', '#profile', parsed.page === 'profile') : navLink('Sign In', 'Sign in', 'profile', '#signin', parsed.page === 'signin'));
  if (session?.me?.admin) nav.append(navLink('Admin', 'Admin', 'admin', '#admin', parsed.page === 'admin'));
  nav.style.setProperty('--nav-count', nav.children.length);
}

function profileUnavailable() {
  const feedback = status();
  const current = session;
  if (current?.pending) {
    say(feedback, 'Loading your account…');
    return feedback;
  }
  say(feedback, current?.error || 'Your account could not load.', true);
  const retry = button('Retry Account Lookup', 'secondary');
  retry.addEventListener('click', () => run(retry, feedback, async () => {
    await refreshProfile(current);
    if (current.current()) render(true);
  }, 'Loading your account…'));
  return el('div', {}, feedback, retry);
}

function showProfile(ctx) {
  const phone = ctx.user.phoneNumber || session.me?.phone;
  const feedback = status();
  const signOut = button('Sign Out', 'secondary');
  signOut.addEventListener('click', async () => {
    if (signingOut) return;
    signingOut = true;
    setSession(null);
    try {
      await firebase.sdk.signOut(firebase.auth);
      notice.textContent = 'Signed out.';
    } catch {
      setSession(firebase.auth.currentUser);
      notice.textContent = 'Could not sign out. Please try again.';
    } finally {
      signingOut = false;
      if (firebase.auth.currentUser !== (session?.user ?? null)) setSession(firebase.auth.currentUser);
    }
  });
  const name = session.me?.name || 'Student';
  const disable = button('Disable My Account', 'danger secondary');
  disable.addEventListener('click', () => run(disable, feedback, async () => {
    if (!window.confirm('Disable your account? You will need support to reactivate it.')) return;
    await api('/me/disable', {ctx, auth: true, method: 'POST'});
    await firebase.sdk.signOut(firebase.auth);
  }, 'Disabling account…'));
  const account = panel('Account');
  const accountSummary = el('div', {class: 'profile-summary'});
  const accountEditor = el('div', {class: 'profile-editor', hidden: ''});
  account.append(accountSummary, accountEditor,
    el('div', {class: 'profile-purchase section'},
      el('div', {}, el('strong', {}, String(session.me?.purchases?.length || 0)), el('span', {class: 'muted'}, 'Courses Unlocked')),
      el('div', {}, el('strong', {}, 'Secure'), el('span', {class: 'muted'}, 'Protected Learning Access'))));
  main.append(...heading('Your Learning Space', 'Manage your profile and keep your preparation moving forward.'), account);
  if (!session.me) {
    main.append(panel('Display Name', profileUnavailable()));
    return;
  }
  const input = el('input', {required: '', autocomplete: 'name', maxlength: '100'});
  input.value = session.me.name || '';
  const exam = el('select', {required: ''},
    el('option', {value: ''}, 'Choose your target exam'),
    ['UPSC Civil Services', 'SSC CGL', 'Railway Exams', 'Banking Exams', 'State PSC', 'Police / Defence', 'Other Government Exams']
      .map(value => el('option', {value}, value)));
  exam.value = session.me.examPreference || '';
  const save = button('Save Profile', null, 'submit');
  const cancel = button('Cancel', 'secondary');
  const form = el('form', {}, field('Display Name', input), field('Target Exam', exam),
    el('div', {class: 'actions'}, save, cancel), feedback);
  const showSavedName = () => {
    const edit = button('', 'icon-button secondary');
    edit.setAttribute('aria-label', 'Edit profile');
    edit.title = 'Edit profile';
    edit.append(icon('edit', 'line-icon'));
    edit.addEventListener('click', () => {
      accountEditor.hidden = false;
      edit.hidden = true;
      input.focus();
    });
    accountSummary.replaceChildren(
      el('div', {class: 'profile-avatar'}, 
        el('div', {class: 'avatar', 'aria-hidden': 'true'}, (session.me.name || 'S').slice(0, 1).toUpperCase()), edit),
      el('div', {class: 'profile-identity'}, el('div', {class: 'profile-name-row'},
        el('h3', {}, session.me.name || 'Student')),
        el('p', {class: 'muted'}, `Mobile: ${phone || 'Unavailable'}`),
        el('p', {class: 'profile-exam'}, session.me.examPreference || 'Choose your target exam')));
  };
  cancel.addEventListener('click', () => {
    input.value = session.me.name || '';
    exam.value = session.me.examPreference || '';
    accountEditor.hidden = true;
    accountSummary.querySelector('.icon-button')?.removeAttribute('hidden');
  });
  bindForm(form, save, feedback, async () => {
    const name = textValue(input, 'Display name');
    const result = await api('/me', {ctx, auth: true, method: 'PUT',
      json: {name, examPreference: exam.value}});
    session.me.name = typeof result?.name === 'string' ? result.name : name;
    session.me.examPreference = typeof result?.examPreference === 'string' ? result.examPreference : exam.value;
    localStorage.setItem('missionExam', session.me.examPreference);
    say(feedback, 'Profile saved.');
    showSavedName();
    accountEditor.hidden = true;
  }, 'Saving name…');
  const profileAction = (iconName, title, description, href) => {
    const row = link('', href, 'profile-menu-row');
    row.append(icon(iconName, 'line-icon profile-menu-icon'),
      el('span', {}, el('strong', {}, title), el('small', {}, description)),
      el('span', {class: 'profile-menu-arrow', 'aria-hidden': 'true'}, '→'));
    return row;
  };
  main.append(
    panel('My Learning', el('div', {class: 'profile-menu'},
      profileAction('missions', 'Explore Courses', 'Browse missions and available content', '#catalog'),
      profileAction('courses', 'My Courses', 'Continue purchased missions', '#my-courses'),
      profileAction('chat', 'Course Groups', 'Open purchaser-only text groups', '#groups'),
      profileAction('progress', 'Progress Reports', 'Review scores, accuracy, and test attempts', '#progress'))),
    panel('Community', el('div', {class: 'profile-menu'},
      profileAction('gift', 'Referrals', 'Share your code and view earned credits', '#referrals'),
      profileAction('share', 'Share & Rate App', 'Invite friends or review Mission Selection', '#share-app')),
      el('div', {class: 'profile-social'}, el('span', {class: 'muted'}, 'Follow Mission Selection'),
        socialFooter(ctx))),
    panel('About Mission Selection',
      el('div', {class: 'profile-about'}, el('span', {class: 'about-mini-mark', 'aria-hidden': 'true'}, 'MS'),
        el('div', {}, el('h3', {}, 'Choose. Prepare. Achieve.'),
          el('p', {class: 'muted'},
            'A focused preparation app for mock tests, chapter-wise materials, current affairs, videos, progress reports, and protected course communities.'),
          link('Read Full Story', '#about', 'profile-about-link')))),
    panel('Account Actions', el('div', {class: 'account-actions'}, signOut),
      el('div', {class: 'danger-zone'}, el('div', {}, el('strong', {}, 'Disable Account'),
        el('p', {class: 'muted'}, 'You can contact support later to request reactivation.')), disable, feedback)));
  accountEditor.replaceChildren(form);
  showSavedName();
  accountEditor.hidden = true;
}

function showSupport(ctx) {
  main.append(...heading('How Can We Help?', 'Find a quick answer below or send our support team a message.'),
    el('section', {class: 'support-faq section'},
      el('details', {}, el('summary', {}, 'When will my course unlock?'), el('p', {}, 'After the admin matches your UPI transaction and approves the request. Return to the course and check approval status.')),
      el('details', {}, el('summary', {}, 'Why is my mobile number on book pages?'), el('p', {}, 'It identifies the licensed reader and helps protect paid content. This app serves protected page images rather than the original PDF.')),
      el('details', {}, el('summary', {}, 'Can I use the same course on another phone?'), el('p', {}, 'Yes. Sign in with the same verified mobile number to restore the purchases linked to your account.'))));
  if (!ctx.user) {
    main.append(panel('Contact Support', el('p', {}, 'Sign in so the support team can identify your account.'), signInLink()));
    return;
  }
  const text = el('textarea', {rows: '5', required: '', maxlength: '2000', 'data-label': 'Message'});
  const send = button('Send Message', null, 'submit');
  const feedback = status();
  const form = el('form', {class: 'narrow'}, field('Your Message', text, 'Do not include passwords, SMS codes, or card information.'), send, feedback);
  bindForm(form, send, feedback, async () => {
    await api('/support', {ctx, auth: true, method: 'POST', json: {text: textValue(text, 'Message')}});
    form.reset();
    say(feedback, 'Your message was sent to support.');
  }, 'Sending message…');
  main.append(panel('Contact Support', form));
}

function render(focus = false) {
  const parsed = route();
  activeHash = location.hash;
  view?.abort();
  view = new AbortController();
  const current = session;
  const ctx = {
    user: current?.user, signal: view.signal, publishingMedia: firebase?.publishingMedia,
    current: () => !ctx.signal.aborted && session === current && (!current || current.current())
  };
  main.replaceChildren();
  main.dataset.page = parsed.page;
  renderNav(parsed);
  const needSignIn = () => main.append(...heading('Sign In to Continue', 'This area is available after you sign in with your mobile number.'), signInLink());
  const [courseId, itemId] = parsed.args;

  switch (parsed.page) {
    case 'home': showDashboard(main, ctx, current?.me); break;
    case 'catalog': showCatalog(main, ctx, current?.me); break;
    case 'my-courses': showMyCourses(main, ctx, current?.me, {signInLink}); break;
    case 'test-series':
    case 'materials': showContentLibrary(main, ctx, current?.me, parsed.page, {signInLink}); break;
    case 'book-store': showEbookStore(main, ctx, {signInLink}); break;
    case 'progress': showProgress(main, ctx, {signInLink}); break;
    case 'notifications': showNotifications(main, ctx, {signInLink}); break;
    case 'timetable': showTimetable(main, ctx, {signInLink, personalTimetable: firebase?.personalTimetable}); break;
    case 'referrals': showReferrals(main, ctx, {signInLink}); break;
    case 'downloads': showDownloads(main, ctx, {signInLink}); break;
    case 'videos': showVideos(main); break;
    case 'groups': showCourseGroups(main, ctx, current?.me, {signInLink}); break;
    case 'share-app': showShareRate(main); break;
    case 'about':
      main.append(...heading('About Mission Selection', 'Choose. Prepare. Achieve.'),
        el('section', {class: 'about-hero'},
          el('div', {class: 'about-mark', 'aria-hidden': 'true'}, 'MS'),
          el('h2', {}, 'Focused preparation. One trusted learning space.'),
          el('p', {class: 'lead'},
            'Mission Selection brings mock tests, chapter-wise study materials, current affairs, videos, progress reports, and purchaser-only course groups into one mobile-first preparation app.')),
        panel('How Mission Selection Helps', el('ul', {class: 'about-list'},
          el('li', {}, el('strong', {}, 'Prepare with purpose'), ' — choose a mission and practise with structured tests and study material.'),
          el('li', {}, el('strong', {}, 'Track real progress'), ' — review scores, accuracy, attempts, and mission performance.'),
          el('li', {}, el('strong', {}, 'Stay current'), ' — browse year/month-wise current affairs, PYQs, syllabus, and a study timetable.'),
          el('li', {}, el('strong', {}, 'Learn together'), ' — use private discussion groups available only to purchased-course members.'))),
        panel('Secure Access', el('p', {},
          'Course access is unlocked only after admin review of the UPI or QR payment proof. Digital books are rendered page by page with the verified mobile number watermarked on the image; original PDF files are never shared directly.')),
        panel('Student Support', el('p', {},
          'Learners can manage their profile, submit support requests, view notifications, and access protected downloads from their account.')));
      break;
    case 'free-tests':
    case 'current-affairs':
    case 'pyqs':
    case 'syllabus': showLearningContent(main, ctx, parsed.page, {signInLink}); break;
    case 'course':
      showCourse(main, ctx, current, {
        id: courseId, signInLink, profileUnavailable, refreshProfile,
        purchased: title => {
          if (!current.current()) return;
          notice.textContent = `Payment approved. You now have access to ${title}.`;
          const visible = route();
          if ((visible.page === 'course' && visible.args[0] === courseId) || visible.page === 'catalog') render(true);
        }
      });
      break;
    case 'signin':
      if (current) {
        if (current.pending) {
          main.append(...heading('Signing You In'), el('p', {class: 'muted'}, 'Preparing your account…'));
          break;
        }
        const next = current.me?.admin ? '#admin' : nextAfterSignIn(parsed);
        main.append(...heading('You’re Signed In'), link('Continue', next, 'button'));
        location.replace(next);
      } else {
        showSignIn(main, ctx, firebase, startAuth, authState);
      }
      break;
    case 'support': showSupport(ctx); break;
    case 'profile': if (current) showProfile(ctx); else needSignIn(); break;
    case 'test': if (current) showTest(main, ctx, courseId, itemId, current.user.phoneNumber); else needSignIn(); break;
    case 'book': if (current) showBook(main, ctx, courseId, itemId); else needSignIn(); break;
    case 'ebook': showEbook(main, ctx, courseId, {signInLink}); break;
    case 'video': if (current) showVideo(main, ctx, courseId, itemId); else needSignIn(); break;
    case 'admin':
      if (!current) needSignIn();
      else if (!current.me) main.append(...heading('Admin Workspace'), profileUnavailable());
      else if (!current.me.admin) {
        const refresh = button('Refresh Admin Access', 'secondary');
        const feedback = status();
        refresh.addEventListener('click', () => run(refresh, feedback, async () => {
          await refreshProfile(current);
          if (current.me?.admin) location.hash = '#admin';
          else say(feedback, 'Admin access is not assigned to this account. Contact support.', true);
        }, 'Checking account…'));
        main.append(...heading('Admin Access Required', 'The server must verify your Firebase account before the Admin tab appears.'),
          el('div', {class: 'actions'}, refresh, link('Back to Missions', '#catalog', 'button')), feedback);
      }
      else showAdmin(main, ctx);
      break;
    default: main.append(...heading('Page Not Found'), link('Back to Courses', '#catalog', 'button'));
  }
  if (focus) main.focus();
}

window.addEventListener('hashchange', () => {
  if (location.hash !== activeHash) {
    notice.textContent = '';
    render(true);
  }
});
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  main.focus();
});
render();
startAuth();
