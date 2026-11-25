import {showAdmin} from './admin.js?v=public-learning-resources-v3';
import {showAdminCourseWorkspace} from './admin-course-workspace.js';
import {showCatalog, showContentLibrary, showCourse, showDashboard, showMyCourses} from './course.js?v=public-learning-resources-v3';
import {api, firebaseAuth} from './services.js?v=persistent-session';
import {showSignIn} from './signin.js?v=persistent-session';
import {showBook, showLeaderboard, showTest, showVideo} from './study.js?v=sectionwise-test-ui';
import {showLearningContent, showNotifications, showProgress, showResource} from './reports.js?v=public-learning-resources-v3';
import {showDownloads, showReferrals, showSaved, showTimetable, socialFooter} from './features.js?v=stable-mobile-admin-downloads';
import {showCourseGroups, showShareRate, showVideos} from './engagement.js?v=youtube-rotate-v2';
import {showEbook, showEbookDemo, showEbookStore} from './ebooks.js?v=continuous-reader-v2';
import {examPreferenceField, normalizeExamPreferences} from './exam-preferences.js';
import {verifyPasswordForPhoneUser} from './password-verification.js';
import {bindForm, button, el, field, heading, icon, idPart, link, loadInto, panel, run, say, status, textValue} from './ui.js';

const main = document.querySelector('#main');
const nav = document.querySelector('#nav');
const notice = document.querySelector('#notice');
const routes = new Map([
  ['home', 0], ['catalog', 0], ['my-courses', 0], ['test-series', 0], ['book-store', 0], ['materials', 0],
  ['current-affairs', 0], ['pyqs', 0], ['syllabus', 0], ['progress', 0], ['notifications', 0],
  ['timetable', 0], ['referrals', 0], ['downloads', 0],
  ['videos', 0], ['groups', 0], ['share-app', 0], ['about', 0], ['privacy', 0], ['terms', 0], ['copyright', 0], ['saved', 2],
  ['course', 1], ['test', 2], ['book', 2], ['ebook', 1], ['ebook-demo', 1], ['resource', 1], ['video', 2], ['leaderboard', 2], ['signin', 0],
  ['profile', 0], ['support', 0], ['admin', 0], ['admin-course', 1], ['admin-publish-test', 2]
]);
let firebase;
let session;
let view;
let authState = 'idle';
let signingOut = false;
let phoneLoginPending = false;
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
      if (phoneLoginPending) return;
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

function completePhoneLogin(user) {
  phoneLoginPending = false;
  authState = 'ready';
  setSession(user);
}

async function refreshProfile(current) {
  const me = await api('/me', {ctx: current, auth: true});
  if (current.current()) current.me = me;
}

async function initializeProfile(current) {
  try {
    await refreshProfile(current);
    if (!current.me?.name && current.user.displayName) {
      await api('/me', {ctx: current, auth: true, method: 'PUT', json: {name: current.user.displayName}});
      if (current.current()) current.me.name = current.user.displayName;
    }
    let localExams = [];
    try { localExams = JSON.parse(localStorage.getItem('missionExams') || '[]'); }
    catch { localExams = normalizeExamPreferences(localStorage.getItem('missionExam')); }
    localExams = normalizeExamPreferences(localExams);
    if (localExams.length && JSON.stringify(current.me?.examPreferences || []) !== JSON.stringify(localExams)) {
      const result = await api('/me', {ctx: current, auth: true, method: 'PUT', json: {examPreferences: localExams}});
      if (current.current()) current.me.examPreferences = result?.examPreferences || localExams;
    }
  } catch (error) {
    if (current.current()) current.error = error.message;
  } finally {
    if (current.current()) {
      current.pending = false;
      const parsed = route();
      if (parsed.page === 'signin' && current.me?.admin) {
        const next = nextAfterSignIn(parsed);
        location.replace(next === '#home' ? '#admin' : next);
      }
      else render(main.contains(document.activeElement));
    }
  }
}

function renderNav(parsed) {
  const catalogActive = ['catalog', 'course', 'test', 'book', 'ebook', 'ebook-demo', 'test-series', 'book-store', 'materials'].includes(parsed.page);
  const navLink = (label, short, glyph, href, active) => el('a', {href, 'data-short': short, 'aria-label': label, 'aria-current': active ? 'page' : null},
    el('span', {class: 'nav-indicator'}, icon(glyph, 'line-icon')), el('span', {class: 'nav-label', 'data-short': short}, label));
  nav.replaceChildren(navLink('Home', 'Home', 'home', '#home', parsed.page === 'home'),
    navLink('All Courses', 'Courses', 'missions', '#catalog', catalogActive),
    navLink('My Courses', 'My', 'courses', '#my-courses', parsed.page === 'my-courses'),
    navLink('Downloads', 'Downloads', 'download', '#downloads', parsed.page === 'downloads'),
    session ? navLink('Profile', 'Me', 'profile', '#profile', parsed.page === 'profile') : navLink('Sign In', 'Sign in', 'profile', '#signin', parsed.page === 'signin'));
  if (session?.me?.admin) nav.append(navLink('Admin', 'Admin', 'admin', '#admin',
    parsed.page === 'admin' || parsed.page === 'admin-course'));
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
  const passwordFeedback = status();
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
  const exams = examPreferenceField(session.me.examPreferences || session.me.examPreference);
  const save = button('Save Profile', null, 'submit');
  const cancel = button('Cancel', 'secondary');
  const form = el('form', {}, field('Display Name', input), field('Target Exams', exams.node,
    'Choose one or multiple exams to personalize your preparation.'),
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
        el('p', {class: 'profile-exam'}, normalizeExamPreferences(session.me.examPreferences || session.me.examPreference)
          .join(' · ') || 'Choose your target exams')));
  };
  cancel.addEventListener('click', () => {
    input.value = session.me.name || '';
    exams.set(session.me.examPreferences || session.me.examPreference);
    accountEditor.hidden = true;
    accountSummary.querySelector('.icon-button')?.removeAttribute('hidden');
  });
  bindForm(form, save, feedback, async () => {
    const name = textValue(input, 'Display name');
    const selectedExams = exams.value();
    if (!selectedExams.length) throw new Error('Choose at least one target exam.');
    const result = await api('/me', {ctx, auth: true, method: 'PUT',
      json: {name, examPreferences: selectedExams}});
    session.me.name = typeof result?.name === 'string' ? result.name : name;
    session.me.examPreferences = Array.isArray(result?.examPreferences) ? result.examPreferences : selectedExams;
    localStorage.setItem('missionExams', JSON.stringify(session.me.examPreferences));
    localStorage.removeItem('missionExam');
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
  const passwordDialog = el('dialog', {class: 'password-dialog'});
  const passwordTitle = el('h2', {}, 'Change Password');
  const currentPassword = el('input', {type: 'password', autocomplete: 'current-password', required: '', minlength: '8', maxlength: '128'});
  const newPassword = el('input', {type: 'password', autocomplete: 'new-password', required: '', minlength: '8', maxlength: '128'});
  const confirmPassword = el('input', {type: 'password', autocomplete: 'new-password', required: '', minlength: '8', maxlength: '128'});
  const passwordForm = el('form', {},
    field('Current Password', currentPassword),
    field('New Password', newPassword, 'Use at least 8 characters.'),
    field('Confirm New Password', confirmPassword));
  const showHide = el('label', {class: 'choice'}, el('input', {type: 'checkbox'}), 'Show passwords');
  showHide.querySelector('input').addEventListener('change', event => {
    const type = event.target.checked ? 'text' : 'password';
    currentPassword.type = type;
    newPassword.type = type;
    confirmPassword.type = type;
  });
  const cancelPassword = button('Cancel', 'secondary');
  const updatePassword = button('Update Password', null, 'submit');
  passwordForm.append(showHide,
    el('div', {class: 'actions'}, cancelPassword, updatePassword), passwordFeedback);
  passwordDialog.append(passwordTitle, passwordForm);
  cancelPassword.addEventListener('click', () => passwordDialog.close());
  passwordDialog.addEventListener('close', () => passwordForm.reset());
  const changePassword = button('Change Password', 'secondary');
  changePassword.addEventListener('click', () => {
    passwordFeedback.textContent = '';
    passwordDialog.showModal();
    currentPassword.focus();
  });
  bindForm(passwordForm, updatePassword, passwordFeedback, async () => {
    if (newPassword.value !== confirmPassword.value) throw new Error('The new passwords do not match.');
    if (currentPassword.value === newPassword.value) throw new Error('The new password must be different from the current password.');
    const user = firebase.auth.currentUser;
    if (!user?.email) throw new Error('This account does not have a password credential.');
    const tokenResult = await user.getIdTokenResult();
    if (tokenResult.signInProvider !== 'phone') {
      throw new Error('Phone verification is required before changing your password.');
    }
    try {
      await verifyPasswordForPhoneUser(firebase.sdk, firebase.passwordAuth, user, user.email, currentPassword.value);
      await firebase.sdk.updatePassword(user, newPassword.value);
      passwordDialog.close();
      say(feedback, 'Password updated. Use your new password at the next sign-in.');
    } catch (error) {
      if (error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') {
        throw new Error('The current password is incorrect.');
      }
      if (error.code === 'auth/weak-password') throw new Error('Choose a password with at least 8 characters.');
      if (error.code === 'auth/requires-recent-login') throw new Error('Sign in again before changing your password.');
      throw error;
    }
  }, 'Updating password…');
  main.append(
    panel('My Learning', el('div', {class: 'profile-menu'},
      profileAction('missions', 'Explore Courses', 'Browse missions and available content', '#catalog'),
      profileAction('courses', 'My Courses', 'Continue purchased missions', '#my-courses'),
      profileAction('chat', 'Course Groups', 'Open purchaser-only text groups', '#groups'),
      profileAction('progress', 'Progress Reports', 'Review scores, accuracy, and test attempts', '#progress'))),
    panel('Purchase Receipts', receiptList(ctx)),
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
    panel('Privacy & Legal', el('div', {class: 'profile-menu'},
      profileAction('admin', 'Privacy Policy', 'How your account and learning data are used', '#privacy'),
      profileAction('files', 'Terms & Conditions', 'Purchase, content, community, and account rules', '#terms'),
      profileAction('files', 'Copyright Policy', 'Rights and permitted use of learning content', '#copyright'))),
    panel('Account Actions', el('div', {class: 'account-actions'}, changePassword, signOut),
      el('div', {class: 'danger-zone'}, el('div', {}, el('strong', {}, 'Disable Account'),
        el('p', {class: 'muted'}, 'You can contact support later to request reactivation.')), disable, feedback)));
  main.append(passwordDialog);
  accountEditor.replaceChildren(form);
  showSavedName();
  accountEditor.hidden = true;
}

function receiptList(ctx) {
  const target = el('div', {class: 'receipt-list'});
  loadInto(target, ctx, async () => {
    const receipts = await api('/receipts', {ctx, auth: true});
    if (!receipts.length) {
      target.replaceChildren(el('p', {class: 'muted'}, 'Approved course receipts will appear here.'));
      return;
    }
    target.replaceChildren(...receipts.map(receipt => {
      const feedback = status();
      const download = button('Download Receipt', 'secondary');
      download.addEventListener('click', () => run(download, feedback, async () => {
        const blob = await api(`/courses/${idPart(receipt.course)}/receipt.pdf`, {ctx, auth: true, blob: true});
        const url = URL.createObjectURL(blob);
        const anchor = el('a', {href: url, download: `${receipt.title}-receipt.pdf`});
        document.body.append(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        say(feedback, 'Receipt downloaded.');
      }, 'Preparing receipt…'));
      return el('article', {class: 'receipt-row'},
        el('div', {}, el('strong', {}, receipt.title),
          el('small', {class: 'muted'}, `${new Intl.NumberFormat('en-IN', {style:'currency', currency:'INR'})
            .format(receipt.amount / 100)} · ${receipt.reference || 'UPI approved'}`)),
        download, feedback);
    }));
  });
  return target;
}

function showLegalPage(type) {
  if (type === 'copyright') {
    main.append(...heading('Copyright Policy'),
      panel('Ownership and Personal Use', el('p', {}, 'Mission Selection and its licensors retain rights in their respective materials. Purchased access is personal and does not transfer copyright or ownership.')),
      panel('Permitted Use', el('p', {}, 'Use learning materials for your own study, subject to your access terms and applicable law. Do not redistribute, sell, publish, or commercially use the materials without permission from the rights holder. Do not bypass access controls or remove attribution or watermarks.')),
      panel('Report a Concern', el('p', {}, 'If you believe content infringes your rights, contact Support with the content location, a description of the work, and information needed to review the claim.'), link('Contact Support', '#support', 'button secondary')));
    return;
  }
  if (type === 'privacy') {
    main.append(
      ...heading('Privacy Policy', 'Last updated: 25 November 2026'),
      panel('Our Commitment', el('p', {}, 'Mission Selection respects your privacy and uses personal information only to operate, secure, and improve the learning service. This policy explains what we collect, why we collect it, and the choices available to you.')),
      panel('Information We Collect', el('ul', {class: 'legal-list'},
        el('li', {}, el('strong', {}, 'Account information: '), 'verified mobile number, username, Firebase account identifier, display name, and target exam. Password credentials are managed by Firebase Authentication; Mission Selection does not collect an email address or receive or store your plaintext password.'),
        el('li', {}, el('strong', {}, 'Learning information: '), 'course purchases, test attempts, scores, saved progress, timetable entries, and support requests.'),
        el('li', {}, el('strong', {}, 'Payment information: '), 'UPI transaction reference, amount, payment note, and approval status. Mission Selection does not collect your UPI PIN, bank password, or complete bank-account credentials.'),
        el('li', {}, el('strong', {}, 'Technical information: '), 'basic device, security, error, and service-log information required to keep the application reliable.'))),
      panel('How Information Is Used', el('ul', {class: 'legal-list'},
        el('li', {}, 'Verify your identity with phone OTP and your account password, and restore purchases on the same mobile number.'),
        el('li', {}, 'Provide courses, mock tests, protected books, videos, groups, downloads, notifications, and progress reports.'),
        el('li', {}, 'Review payment proof, approve access, prevent misuse, and support refunds or disputes where applicable.'),
        el('li', {}, 'Detect fraud, protect paid content, respond to support requests, and meet legal or security obligations.'))),
      panel('Content Protection', el('p', {}, 'Protected PDF pages may display your verified mobile number or another account-linked mark. Original source files are not intentionally provided through the reader. Saved learning content is stored on your device within the app and requires an online access check to open. Native Android versions may prevent screenshots and screen recording; browser and operating-system limitations can still affect protection.')),
      panel('Sharing and Service Providers', el('p', {}, 'We use infrastructure providers including Firebase for authentication, hosting, databases, and storage. We do not sell personal information. Information may be shared with authorized administrators, payment verification staff, service providers under appropriate safeguards, or authorities when legally required.')),
      panel('Retention and Security', el('p', {}, 'Information is retained while needed to provide the service, keep purchase records, resolve disputes, maintain security, and comply with applicable law. We use access controls, authenticated requests, protected storage, and restricted administration, but no internet service can guarantee absolute security.')),
      panel('Your Choices', el('ul', {class: 'legal-list'},
        el('li', {}, 'Update your display name and target exam from Profile.'),
        el('li', {}, 'Request account deactivation from Profile or contact support.'),
        el('li', {}, 'Request access, correction, or deletion of eligible personal information through Support. Some transaction and entitlement records may need to be retained.'),
        el('li', {}, 'You may sign out or stop using the application, but previously approved purchases and legal records may remain subject to retention requirements.'))),
      panel('Children and Policy Changes', el('p', {}, 'Mission Selection is not intended for children below the age that requires parent or guardian consent. Parents or guardians should supervise use. This policy may be updated when features or legal requirements change; the latest version and date will be shown here.')),
      panel('Contact', el('p', {}, 'For privacy questions or requests, open the Support section and send a message from your signed-in account.'), link('Contact Support', '#support', 'button')));
  } else {
    main.append(
      ...heading('Terms & Conditions', 'Last updated: 25 November 2026'),
      panel('Acceptance and Eligibility', el('p', {}, 'By creating an account or using Mission Selection, you agree to these terms. You must provide a genuine, verified Indian mobile number and use the application lawfully. If you are a minor or require guardian consent, use the service under appropriate supervision.')),
      panel('Account Responsibilities', el('ul', {class: 'legal-list'},
        el('li', {}, 'Keep control of your verified mobile number, one-time passwords, username, and password. Sign-in requires a phone OTP and your account password.'),
        el('li', {}, 'Do not share, sell, rent, transfer, or provide access to another person’s paid account.'),
        el('li', {}, 'Provide accurate profile, payment, and support information.'),
        el('li', {}, 'Mission Selection may restrict or disable accounts involved in abuse, fraud, security risks, or repeated violations.'))),
      panel('Courses, E-Books, and Payments', el('ul', {class: 'legal-list'},
        el('li', {}, 'Prices, content, availability, expiry dates, and access limits are shown in the application and may change before a new purchase.'),
        el('li', {}, 'Access is granted only after the submitted payment proof is verified and approved by an administrator.'),
        el('li', {}, 'A payment that is pending, rejected, reversed, disputed, or found to be inaccurate does not create an entitlement.'),
        el('li', {}, 'Refund, cancellation, or correction requests must be sent through Support with the relevant transaction details. Eligibility depends on the purchase, access already provided, and applicable law.'))),
      panel('Mock Tests and Results', el('p', {}, 'Tests may have start times, expiry dates, duration limits, attempt limits, marking schemes, negative marks, and sections. The server’s authoritative time and submission record determine access and results. Practice content is for preparation and does not guarantee exam results, selection, ranking, or outcomes.')),
      panel('Protected Digital Content', el('ul', {class: 'legal-list'},
        el('li', {}, 'You receive a personal, limited, non-transferable right to access purchased learning content for the stated access period.'),
        el('li', {}, 'Do not copy, redistribute, publish, resell, reverse-engineer, remove watermarks, bypass access controls, or use automated extraction tools.'),
        el('li', {}, 'An approved protected E-Book download is licensed only to your account and may still contain a mobile-number watermark.'),
        el('li', {}, 'Content providers and authors retain their rights. Purchase grants access, not ownership of the underlying intellectual property.'))),
      panel('Copyright and Reporting', el('p', {}, 'Mission Selection and its licensors retain copyright and other rights in their respective materials. You may use authorized content for your personal learning only, subject to applicable law. Do not remove attribution or watermarks, share copies, repost, sell, or use the content commercially without the rights holder’s permission.'),
        el('p', {}, 'If you believe content infringes your rights, contact Support with the content location, a description of the work, and information needed to review the claim. Mission Selection may review and act on reports as appropriate.'),
        link('Contact Support', '#support', 'button secondary')),
      panel('Community and Support Conduct', el('p', {}, 'Course discussions, support requests, reviews, and other user submissions must be respectful and lawful. Do not post harassment, abusive material, spam, misleading information, personal data of others, confidential exam content, malware, or links intended to harm users. We may moderate or remove violating content.')),
      panel('Availability and Changes', el('p', {}, 'Features, courses, schedules, tests, and content may be updated, corrected, paused, or removed. We aim for reliable service but do not warrant uninterrupted availability. Temporary maintenance, network issues, third-party outages, or security measures may affect access.')),
      panel('Limitation and Governing Process', el('p', {}, 'To the extent permitted by applicable law, Mission Selection is not liable for indirect loss, device/network failures, user payment mistakes, or outcomes of competitive examinations. Nothing in these terms excludes rights or responsibilities that cannot lawfully be excluded. Disputes should first be raised through Support so they can be reviewed.')),
      panel('Questions or Updates', el('p', {}, 'We may update these terms when the service changes. Continued use after an updated version becomes effective indicates acceptance of the revised terms.'), link('Contact Support', '#support', 'button')));
  }
}

function showSupport(ctx) {
  main.append(...heading('How Can We Help?', 'Find a quick answer below or send our support team a message.'),
    el('section', {class: 'support-faq section'},
      el('details', {}, el('summary', {}, 'When will my course unlock?'), el('p', {}, 'After the admin matches your UPI transaction and approves the request. Return to the course and check approval status.')),
      el('details', {}, el('summary', {}, 'Why is my mobile number on some book pages?'), el('p', {}, 'It identifies the licensed reader and helps protect paid content. Course pages do not display this mark when downloads are enabled.')),
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
  let parsed = route();
  if (!session && parsed.page !== 'signin') {
    const next = location.hash || '#home';
    history.replaceState(null, '', `#signin?${new URLSearchParams({next})}`);
    parsed = route();
  }
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
  const backTargets = {
    'my-courses': '#home', 'test-series': '#home', 'book-store': '#home', 'materials': '#home',
    'progress': '#profile', 'notifications': '#home', 'timetable': '#home', 'referrals': '#profile',
    'downloads': '#home', 'videos': '#home', 'groups': '#profile', 'share-app': '#profile',
    'about': '#profile', 'privacy': '#profile', 'terms': '#profile', 'copyright': '#profile',
    'current-affairs': '#home', 'pyqs': '#home', 'syllabus': '#home', 'support': '#profile',
    'profile': '#home', 'course': '#catalog', 'ebook': '#book-store', 'admin': '#home',
    'admin-course': '#admin', 'admin-publish-test': parsed.page === 'admin-publish-test' ?
      `#admin-course/${idPart(parsed.args[0])}` : '#admin',
  };
  if (backTargets[parsed.page]) {
    const back = link('', backTargets[parsed.page], 'page-back');
    const label = parsed.page === 'admin' ? 'Back to Home' : parsed.page === 'admin-course' ? 'Back to Admin' :
      parsed.page === 'admin-publish-test' ? 'Back to Course Workspace' : 'Back';
    back.append(icon('back', 'line-icon'), el('span', {}, label));
    main.append(back);
  }
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
    case 'privacy':
    case 'copyright':
    case 'terms': showLegalPage(parsed.page); break;
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
          'Course access is unlocked only after admin review of the UPI or QR payment proof. Digital books are rendered page by page; original PDF files are not provided by the reader. Course pages are watermarked when downloads are disabled.')),
        panel('Student Support', el('p', {},
          'Learners can manage their profile, submit support requests, view notifications, and access protected downloads from their account.')));
      break;
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
        showSignIn(main, ctx, firebase, startAuth, authState, {
          begin: () => { phoneLoginPending = true; },
          cancel: () => { phoneLoginPending = false; },
          complete: completePhoneLogin,
        });
      }
      break;
    case 'support': showSupport(ctx); break;
    case 'profile': if (current) showProfile(ctx); else needSignIn(); break;
    case 'test': if (current) showTest(main, ctx, courseId, itemId, current.user.phoneNumber); else needSignIn(); break;
    case 'leaderboard': if (current) showLeaderboard(main, ctx, courseId, itemId); else needSignIn(); break;
    case 'book': if (current) showBook(main, ctx, courseId, itemId); else needSignIn(); break;
    case 'ebook': showEbook(main, ctx, courseId, {signInLink}); break;
    case 'ebook-demo': showEbookDemo(main, ctx, courseId); break;
    case 'resource': showResource(main, ctx, courseId, {signInLink}); break;
    case 'video': if (current) showVideo(main, ctx, courseId, itemId); else needSignIn(); break;
    case 'saved': if (current) showSaved(main, ctx, courseId, itemId); else needSignIn(); break;
    case 'admin':
    case 'admin-publish-test':
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
      else showAdmin(main, ctx, parsed.page === 'admin-publish-test' ? {courseId, folderId: itemId} : null);
      break;
    case 'admin-course':
      if (!current) needSignIn();
      else if (!current.me) main.append(...heading('Course Workspace'), profileUnavailable());
      else if (!current.me.admin) {
        main.append(...heading('Admin Access Required',
          'The server must verify your account before you can organize course content.'));
      } else showAdminCourseWorkspace(main, ctx, courseId);
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
