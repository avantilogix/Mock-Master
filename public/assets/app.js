import {showAdmin} from './admin.js?v=phase2-20261120';
import {showCatalog, showContentLibrary, showCourse, showDashboard, showMyCourses} from './course.js?v=phase2-20261120';
import {api, firebaseAuth} from './services.js';
import {showSignIn} from './signin.js';
import {showBook, showTest} from './study.js';
import {showLearningContent, showNotifications, showProgress} from './reports.js?v=phase3-20261120';
import {showDownloads, showPhysicalStore, showReferrals, showTimetable, socialFooter} from './features.js?v=phase3-20261120';
import {bindForm, button, el, field, heading, link, panel, run, say, status, textValue} from './ui.js';

const main = document.querySelector('#main');
const nav = document.querySelector('#nav');
const notice = document.querySelector('#notice');
const routes = new Map([
  ['home', 0], ['catalog', 0], ['my-courses', 0], ['test-series', 0], ['book-store', 0], ['materials', 0],
  ['free-tests', 0], ['current-affairs', 0], ['pyqs', 0], ['syllabus', 0], ['progress', 0], ['notifications', 0],
  ['timetable', 0], ['referrals', 0], ['physical-books', 0], ['downloads', 0],
  ['course', 1], ['test', 2], ['book', 2], ['signin', 0],
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

function signInLink(label = 'Sign in') {
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
      else if (first && route().page === 'signin') render();
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
  const navLink = (label, icon, href, active) => el('a', {href, 'data-icon': icon, 'aria-current': active ? 'page' : null}, label);
  nav.replaceChildren(navLink('Home', '⌂', '#home', parsed.page === 'home'),
    navLink('Missions', '▦', '#catalog', catalogActive),
    navLink('My Courses', '✓', '#my-courses', parsed.page === 'my-courses'),
    navLink('Progress', '↗', '#progress', parsed.page === 'progress'),
    session ? navLink('Profile', '●', '#profile', parsed.page === 'profile') : navLink('Sign in', '●', '#signin', parsed.page === 'signin'));
  if (session?.me?.admin) nav.append(navLink('Admin', '⚙', '#admin', parsed.page === 'admin'));
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
  const retry = button('Retry account lookup', 'secondary');
  retry.addEventListener('click', () => run(retry, feedback, async () => {
    await refreshProfile(current);
    if (current.current()) render(true);
  }, 'Loading your account…'));
  return el('div', {}, feedback, retry);
}

function showProfile(ctx) {
  const phone = ctx.user.phoneNumber || session.me?.phone;
  const feedback = status();
  const signOut = button('Sign out', 'secondary');
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
  const disable = button('Disable my account', 'danger secondary');
  disable.addEventListener('click', () => run(disable, feedback, async () => {
    if (!window.confirm('Disable your account? You will need support to reactivate it.')) return;
    await api('/me/disable', {ctx, auth: true, method: 'POST'});
    await firebase.sdk.signOut(firebase.auth);
  }, 'Disabling account…'));
  main.append(...heading('Your learning space', 'Manage your profile and keep your preparation moving forward.'),
    panel('Account', el('div', {class: 'profile-summary'},
      el('div', {class: 'avatar', 'aria-hidden': 'true'}, name.slice(0, 1).toUpperCase()),
      el('div', {}, el('h3', {}, name), el('p', {class: 'muted'}, `Mobile: ${phone || 'Unavailable'}`),
        el('p', {class: 'account-id'}, 'Firebase account ID: ', el('code', {}, session.me.uid || 'Unavailable')))),
      el('div', {class: 'profile-purchase section'},
        el('div', {}, el('strong', {}, String(session.me?.purchases?.length || 0)), el('span', {class: 'muted'}, 'Courses unlocked')),
        el('div', {}, el('strong', {}, 'Secure'), el('span', {class: 'muted'}, 'Protected learning access'))),
      el('div', {class: 'actions section'}, link('Explore courses', '#catalog', 'button'),
        link('Referrals', '#referrals', 'button secondary'), socialFooter(ctx), signOut, disable)));
  if (!session.me) {
    main.append(panel('Display name', profileUnavailable()));
    return;
  }
  const input = el('input', {required: '', autocomplete: 'name', maxlength: '100'});
  input.value = session.me.name || '';
  const save = button('Save name', null, 'submit');
  const form = el('form', {}, field('Display name', input), save, feedback);
  bindForm(form, save, feedback, async () => {
    const name = textValue(input, 'Display name');
    const result = await api('/me', {ctx, auth: true, method: 'PUT', json: {name}});
    session.me.name = typeof result?.name === 'string' ? result.name : name;
    say(feedback, 'Display name saved.');
  }, 'Saving name…');
  main.append(panel('Display name', el('div', {class: 'narrow'}, form)));
}

function showSupport(ctx) {
  main.append(...heading('How can we help?', 'Find a quick answer below or send our support team a message.'),
    el('section', {class: 'support-faq section'},
      el('details', {}, el('summary', {}, 'When will my course unlock?'), el('p', {}, 'After the admin matches your UPI transaction and approves the request. Return to the course and check approval status.')),
      el('details', {}, el('summary', {}, 'Why is my mobile number on book pages?'), el('p', {}, 'It identifies the licensed reader and helps protect paid content. This app serves protected page images rather than the original PDF.')),
      el('details', {}, el('summary', {}, 'Can I use the same course on another phone?'), el('p', {}, 'Yes. Sign in with the same verified mobile number to restore the purchases linked to your account.'))));
  if (!ctx.user) {
    main.append(panel('Contact support', el('p', {}, 'Sign in so the support team can identify your account.'), signInLink()));
    return;
  }
  const text = el('textarea', {rows: '5', required: '', maxlength: '2000'});
  const send = button('Send message', null, 'submit');
  const feedback = status();
  const form = el('form', {class: 'narrow'}, field('How can we help?', text, 'Do not include passwords, SMS codes, or card information.'), send, feedback);
  bindForm(form, send, feedback, async () => {
    await api('/support', {ctx, auth: true, method: 'POST', json: {text: textValue(text, 'Message')}});
    form.reset();
    say(feedback, 'Your message was sent to support.');
  }, 'Sending message…');
  main.append(panel('Contact support', form));
}

function render(focus = false) {
  const parsed = route();
  activeHash = location.hash;
  view?.abort();
  view = new AbortController();
  const current = session;
  const ctx = {
    user: current?.user, signal: view.signal,
    current: () => !ctx.signal.aborted && session === current && (!current || current.current())
  };
  main.replaceChildren();
  renderNav(parsed);
  const needSignIn = () => main.append(...heading('Sign in to continue', 'This area is available after you sign in with your mobile number.'), signInLink());
  const [courseId, itemId] = parsed.args;

  switch (parsed.page) {
    case 'home': showDashboard(main, ctx, current?.me); break;
    case 'catalog': showCatalog(main, ctx, current?.me); break;
    case 'my-courses': showMyCourses(main, ctx, current?.me, {signInLink}); break;
    case 'test-series':
    case 'book-store':
    case 'materials': showContentLibrary(main, ctx, current?.me, parsed.page, {signInLink}); break;
    case 'progress': showProgress(main, ctx, {signInLink}); break;
    case 'notifications': showNotifications(main, ctx, {signInLink}); break;
    case 'timetable': showTimetable(main, ctx); break;
    case 'referrals': showReferrals(main, ctx, {signInLink}); break;
    case 'physical-books': showPhysicalStore(main, ctx, {signInLink}); break;
    case 'downloads': showDownloads(main, ctx, {signInLink}); break;
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
        const next = nextAfterSignIn(parsed);
        main.append(...heading('You’re signed in'), link('Continue', next, 'button'));
        location.replace(next);
      } else {
        showSignIn(main, ctx, firebase, startAuth, authState);
      }
      break;
    case 'support': showSupport(ctx); break;
    case 'profile': if (current) showProfile(ctx); else needSignIn(); break;
    case 'test': if (current) showTest(main, ctx, courseId, itemId, current.user.phoneNumber); else needSignIn(); break;
    case 'book': if (current) showBook(main, ctx, courseId, itemId); else needSignIn(); break;
    case 'admin':
      if (!current) needSignIn();
      else if (!current.me) main.append(...heading('Admin workspace'), profileUnavailable());
      else if (!current.me.admin) {
        const refresh = button('Refresh admin access', 'secondary');
        const feedback = status();
        refresh.addEventListener('click', () => run(refresh, feedback, async () => {
          await refreshProfile(current);
          if (current.me?.admin) location.hash = '#admin';
          else say(feedback, `Admin access is not assigned to Firebase account ID ${current.me?.uid || 'unknown'}.`, true);
        }, 'Checking account…'));
        main.append(...heading('Admin access required', 'The server must verify your Firebase account before the Admin tab appears.'),
          el('div', {class: 'actions'}, refresh, link('Back to missions', '#catalog', 'button')), feedback);
      }
      else showAdmin(main, ctx);
      break;
    default: main.append(...heading('Page not found'), link('Back to courses', '#catalog', 'button'));
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
