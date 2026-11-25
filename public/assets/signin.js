import {bindForm, button, el, field, heading, rule, say, status} from './ui.js';
import {examPreferenceField} from './exam-preferences.js';
import {hasPhoneSignIn, verifyPasswordForPhoneUser} from './password-verification.js';
import {beginTemporaryPhoneSession, persistCompletedPhoneSession} from './auth-persistence.js';

const usernameEmail = username => `${username.toLowerCase()}@accounts.mission-selection.invalid`;

function authError(error) {
  const messages = {
    'auth/invalid-phone-number': 'Enter a valid phone number including the country code.',
    'auth/invalid-verification-code': 'That code is incorrect. Check your SMS and try again.',
    'auth/code-expired': 'That code expired. Use “Change Number or Resend” to request a new one.',
    'auth/session-expired': 'That code expired. Use “Change Number or Resend” to request a new one.',
    'auth/too-many-requests': 'Too many attempts. Wait a while before trying again.',
    'auth/quota-exceeded': 'SMS verification is temporarily unavailable. Try again later.',
    'auth/operation-not-allowed': 'Phone verification is not available right now. Please contact support.',
    'auth/network-request-failed': 'Check your connection and try again.',
    'auth/captcha-check-failed': 'We could not securely verify this request. Please try again.',
    'auth/unauthorized-domain': 'This domain is not authorized in Firebase. Add it under Authentication → Settings → Authorized domains.',
    'auth/invalid-app-credential': 'We could not securely verify this app. Please contact support.',
    'auth/app-not-authorized': 'Phone sign-in is unavailable for this app. Please contact support.',
    'auth/billing-not-enabled': 'Firebase SMS delivery requires a billing-enabled project. Upgrade to the Blaze plan and retry.',
    'auth/missing-client-identifier': 'Phone verification could not identify this browser. Reload the page and retry.'
  };
  const raw = String(error.message || '').toLowerCase();
  const detail = /region|country|unsupported sms/i.test(raw)
    ? 'SMS delivery to this mobile number is not available right now. Please contact support.'
    : messages[error.code] || 'We could not send your code. Please try again or contact support.';
  return new Error(`${detail}${error.code && !messages[error.code] ? ` (${error.code})` : ''}`);
}

export function showSignIn(main, ctx, firebase, startAuth, initState, authFlow = {}) {
  main.append(el('section', {class: 'auth-layout'},
    el('div', {class: 'auth-story'}, el('span', {class: 'eyebrow'}, 'Mission Selection Account'),
      ...heading('Start Your Mission.'),
      el('p', {class: 'lead'}, 'Sign in securely to access purchased missions, practice tests, protected books, and course discussions.'),
      el('div', {class: 'auth-benefits'},
        el('span', {}, '✓ Secure mobile OTP'),
        el('span', {}, '✓ Purchases stay with your number'),
        el('span', {}, '✓ Continue on any supported phone'))),
    el('div', {class: 'auth-card'}, el('div', {class: 'auth-card-title'},
      el('img', {class: 'auth-icon', src: '/assets/logo.png?v=logo-20261120', alt: '', width: '80', height: '80'}),
      el('div', {}, el('h2', {}, 'Welcome Back'), el('p', {class: 'muted'}, 'Sign in or create your student account.'))),
      el('div', {id: 'auth-form'}))));
  const section = main.querySelector('#auth-form');
  if (!firebase || initState !== 'ready') {
    const feedback = status();
    section.append(feedback);
    if (initState === 'error') {
      say(feedback, 'Phone sign-in could not load.', true);
      const retry = button('Retry Sign-In');
      retry.addEventListener('click', startAuth);
      section.append(retry);
    } else say(feedback, 'Preparing phone sign-in…');
    return;
  }
  const {sdk, auth, passwordAuth} = firebase;
  const phone = el('input', {type: 'tel', autocomplete: 'tel-national', inputmode: 'numeric', required: '',
    maxlength: '11', placeholder: '98765 43210'});
  rule(phone, value => /^[6-9]\d{9}$/.test(value.replace(/\D/g, '')) ? '' :
    'Enter a 10-digit mobile number starting with 6, 7, 8, or 9.');
  phone.addEventListener('input', () => {
    const digits = phone.value.replace(/\D/g, '').slice(0, 10);
    phone.value = digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
  });
  let savedExams = [];
  try { savedExams = JSON.parse(localStorage.getItem('missionExams') || '[]'); }
  catch { savedExams = localStorage.getItem('missionExam') || ''; }
  const exams = examPreferenceField(savedExams);
  exams.node.addEventListener('change', () => localStorage.setItem('missionExams', JSON.stringify(exams.value())));
  const captcha = el('div', {id: 'captcha'});
  let verifier;
  const clearVerifier = () => {
    verifier?.clear();
    verifier = null;
    captcha.replaceChildren();
  };
  ctx.signal.addEventListener('abort', clearVerifier, {once: true});

  function showPhone(focus = false) {
    const feedback = status();
    const submit = button('Send OTP', null, 'submit');
    const phoneControl = el('div', {class: 'phone-control'},
      el('span', {class: 'country-prefix', 'aria-hidden': 'true'}, '+91'), phone);
    const form = el('form', {}, field('Exams You Are Preparing For', exams.node,
      'Select one or multiple exams. You can change these later from Profile.'),
      field('Mobile Number', phoneControl, 'Enter your 10-digit Indian mobile number. Standard SMS rates may apply.'),
      captcha, submit, feedback);
    if (auth.dummy) form.prepend(el('p', {class: 'dummy-login-note'},
      'Local dummy sign-in: enter any mobile number and use OTP 123456. Use 99999 99999 to sign in as admin.'));
    section.replaceChildren(form);
    if (focus) phone.focus();
    bindForm(form, submit, feedback, async () => {
      if (!exams.value().length) throw new Error('Choose at least one exam to continue.');
      const localNumber = phone.value.replace(/\D/g, '');
      if (!/^[6-9]\d{9}$/.test(localNumber)) throw new Error('Enter a 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
      const number = `+91${localNumber}`;
      try {
        verifier ||= new sdk.RecaptchaVerifier(auth, captcha, {size: 'invisible'});
        const confirmation = await sdk.signInWithPhoneNumber(auth, number, verifier);
        if (ctx.current()) {
          clearVerifier();
          showCode(number, confirmation);
        }
      } catch (error) {
        clearVerifier();
        throw authError(error);
      }
    }, '');
  }

  function showCode(number, confirmation) {
    const code = el('input', {type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', required: '',
      pattern: '[0-9]{6}', maxlength: '6', 'data-pattern-message': 'Enter the 6-digit code sent to your mobile.'});
    code.addEventListener('input', () => { code.value = code.value.replace(/\D/g, '').slice(0, 6); });
    const submit = button('Verify and Sign In', null, 'submit');
    const resend = button('Change Number or Resend', 'secondary');
    const feedback = status();
    const form = el('form', {}, el('p', {}, `Code sent to ${number}.`),
      field('6-Digit OTP', code), el('div', {class: 'actions'}, submit, resend), feedback);
    section.replaceChildren(form);
    code.focus();
    resend.addEventListener('click', () => showPhone(true));
    bindForm(form, submit, feedback, async () => {
      resend.disabled = true;
      authFlow.begin?.();
      try {
        if (!auth.dummy) await beginTemporaryPhoneSession(sdk, auth);
        const result = await confirmation.confirm(code.value);
        const user = result?.user || auth.currentUser;
        if (!user) throw new Error('Phone verification completed without an account. Retry sign-in.');
        if (!ctx.current()) {
          await sdk.signOut(auth);
          authFlow.cancel?.();
          return;
        }
        if (auth.dummy) {
          authFlow.complete?.(user);
          return;
        }
        if (user.providerData.some(provider => provider.providerId === 'password')) {
          showPasswordCheck(user);
        } else {
          showAccountSetup(user);
        }
      } catch (error) {
        authFlow.cancel?.();
        throw authError(error);
      } finally {
        resend.disabled = false;
      }
    }, 'Verifying code…');
  }

  function showAccountSetup(user) {
    const username = el('input', {type: 'text', autocomplete: 'username', required: '', minlength: '3', maxlength: '30',
      pattern: '[A-Za-z0-9][A-Za-z0-9._-]{2,29}'});
    rule(username, value => /^[A-Za-z0-9][A-Za-z0-9._-]{2,29}$/.test(value) ? '' :
      'Use 3–30 letters, numbers, dots, underscores, or hyphens; start with a letter or number.');
    const password = el('input', {type: 'password', autocomplete: 'new-password', required: '', minlength: '8', maxlength: '128'});
    const confirmPassword = el('input', {type: 'password', autocomplete: 'new-password', required: '', minlength: '8', maxlength: '128'});
    const feedback = status();
    const submit = button('Create Account', null, 'submit');
    const form = el('form', {},
      el('p', {class: 'muted'}, 'Phone verified. Set your username and password to finish creating your account. You will need both your phone OTP and password each time you sign in.'),
      field('Username', username), field('Set Password', password, 'Use at least 8 characters.'),
      field('Confirm Password', confirmPassword), submit, feedback);
    section.replaceChildren(form);
    username.focus();
    bindForm(form, submit, feedback, async () => {
      if (password.value !== confirmPassword.value) throw new Error('The passwords do not match.');
      const selectedUsername = username.value.trim().toLowerCase();
      try {
        const linked = await sdk.linkWithCredential(user,
          sdk.EmailAuthProvider.credential(usernameEmail(selectedUsername), password.value));
        await sdk.updateProfile(linked.user, {displayName: selectedUsername});
        await completeVerifiedLogin(linked.user);
      } catch (error) {
        throw accountError(error);
      }
    }, 'Creating your account…');
  }

  function showPasswordCheck(user) {
    const username = el('input', {type: 'text', autocomplete: 'username', required: '', minlength: '3', maxlength: '30',
      pattern: '[A-Za-z0-9][A-Za-z0-9._-]{2,29}', value: user.displayName || ''});
    const password = el('input', {type: 'password', autocomplete: 'current-password', required: '', minlength: '8', maxlength: '128'});
    const feedback = status();
    const submit = button('Continue to Mission Selection', null, 'submit');
    const reset = button('Reset Password', 'secondary');
    const form = el('form', {},
      el('p', {class: 'muted'}, `Phone verified${user.displayName ? ` for ${user.displayName}` : ''}. Enter your account username and password to continue.`),
      field('Username', username), field('Password', password), el('div', {class: 'actions'}, submit, reset), feedback);
    section.replaceChildren(form);
    password.focus();
    bindForm(form, submit, feedback, async () => {
      const selectedUsername = username.value.trim().toLowerCase();
      if (user.email !== usernameEmail(selectedUsername)) throw new Error('That username does not match this verified mobile account.');
      try {
        await verifyPasswordForPhoneUser(sdk, passwordAuth, user, user.email, password.value);
        await completeVerifiedLogin(user);
      } catch (error) {
        throw accountError(error);
      }
    }, 'Checking your account…');
    reset.addEventListener('click', () => showPasswordReset(user));
  }

  function showPasswordReset(user) {
    const password = el('input', {type: 'password', autocomplete: 'new-password', required: '', minlength: '8', maxlength: '128'});
    const confirmPassword = el('input', {type: 'password', autocomplete: 'new-password', required: '', minlength: '8', maxlength: '128'});
    const feedback = status();
    const submit = button('Set New Password', null, 'submit');
    const back = button('Back to Sign In', 'secondary');
    const form = el('form', {},
      el('p', {class: 'muted'}, 'Your phone has been verified for this sign-in. Set a new password to continue.'),
      field('New Password', password), field('Confirm New Password', confirmPassword),
      el('div', {class: 'actions'}, submit, back), feedback);
    section.replaceChildren(form);
    password.focus();
    back.addEventListener('click', () => showPasswordCheck(user));
    bindForm(form, submit, feedback, async () => {
      if (password.value !== confirmPassword.value) throw new Error('The passwords do not match.');
      try {
        await sdk.updatePassword(user, password.value);
        await completeVerifiedLogin(user);
      } catch (error) {
        throw accountError(error);
      }
    }, 'Updating your password…');
  }

  async function completeVerifiedLogin(user) {
    if (await hasPhoneSignIn(user)) {
      try {
        await persistCompletedPhoneSession(sdk, auth, user);
      } catch (error) {
        throw Object.assign(new Error('Could not save your sign-in on this device. Please try again.'), {
          code: 'auth/session-persistence-failed', cause: error,
        });
      }
      authFlow.complete?.(user);
      return;
    }
    const retry = button('Verify Phone Again');
    const feedback = status();
    retry.addEventListener('click', async () => {
      retry.disabled = true;
      try {
        await sdk.signOut(auth);
        authFlow.cancel?.();
        showPhone(true);
      } catch (error) {
        retry.disabled = false;
        say(feedback, 'Could not restart phone verification. Please try again.', true);
      }
    });
    section.replaceChildren(el('p', {class: 'muted'},
      'Your account changes were saved. Verify your phone again to finish signing in.'), retry, feedback);
  }
  showPhone();
}

function accountError(error) {
  const messages = {
    'auth/email-already-in-use': 'That username is already taken. Choose another.',
    'auth/weak-password': 'Choose a password with at least 8 characters.',
    'auth/invalid-email': 'Choose a valid username.',
    'auth/credential-already-in-use': 'That username is already linked to another account. Choose another.',
    'auth/wrong-password': 'The password is incorrect. Try again or reset it after phone verification.',
    'auth/invalid-credential': 'The username or password is incorrect. Try again or reset it after phone verification.',
    'auth/provider-already-linked': 'This account already has a password. Sign in again and enter it to continue.',
    'auth/requires-recent-login': 'Phone verification is required again before changing your password.',
    'auth/user-mismatch': 'That username does not match this verified mobile account.',
    'auth/session-persistence-failed': 'Could not save your sign-in on this device. Please try again.',
    'auth/network-request-failed': 'Check your connection and try again.',
  };
  return new Error(messages[error.code] || `Account setup failed${error.code ? ` (${error.code})` : ''}. Please try again.`);
}
