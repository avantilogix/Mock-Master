import {bindForm, button, el, field, heading, run, say, status, textValue} from './ui.js';

function authError(error) {
  const messages = {
    'auth/invalid-phone-number': 'Enter a valid phone number including the country code.',
    'auth/invalid-verification-code': 'That code is incorrect. Check your SMS and try again.',
    'auth/code-expired': 'That code expired. Use “Change number or resend” to request a new one.',
    'auth/session-expired': 'That code expired. Use “Change number or resend” to request a new one.',
    'auth/too-many-requests': 'Too many attempts. Wait a while before trying again.',
    'auth/quota-exceeded': 'SMS verification is temporarily unavailable. Try again later.',
    'auth/network-request-failed': 'Check your connection and try again.',
    'auth/captcha-check-failed': 'The reCAPTCHA check failed. Please try again.',
    'auth/unauthorized-domain': 'Phone sign-in is not enabled for this site.'
  };
  return new Error(messages[error.code] || 'Phone verification could not finish. Please try again.');
}

export function showSignIn(main, ctx, firebase, startAuth, initState) {
  main.append(...heading('Sign in', 'Use your mobile number to receive a one-time code by SMS.'));
  const section = el('div', {class: 'panel narrow'});
  main.append(section);
  if (!firebase || initState !== 'ready') {
    const feedback = status();
    section.append(feedback);
    if (initState === 'error') {
      say(feedback, 'Phone sign-in could not load.', true);
      const retry = button('Retry sign-in');
      retry.addEventListener('click', startAuth);
      section.append(retry);
    } else say(feedback, 'Preparing phone sign-in…');
    return;
  }
  const {sdk, auth} = firebase;
  const phone = el('input', {type: 'tel', autocomplete: 'tel', required: '', placeholder: '+91'});
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
    const submit = button('Send code', null, 'submit');
    const form = el('form', {}, field('Mobile number', phone, 'Include the +91 country code for your Indian mobile number. Standard SMS rates may apply.'),
      captcha, submit, feedback);
    section.replaceChildren(form);
    if (focus) phone.focus();
    bindForm(form, submit, feedback, async () => {
      const number = textValue(phone, 'Mobile number').replace(/[\s()-]/g, '');
      if (!/^\+91[6-9]\d{9}$/.test(number)) {
        throw new Error('Enter +91 followed by a 10-digit Indian mobile number starting with 6, 7, 8, or 9.');
      }
      try {
        verifier ||= new sdk.RecaptchaVerifier(auth, captcha, {size: 'normal'});
        const confirmation = await sdk.signInWithPhoneNumber(auth, number, verifier);
        if (ctx.current()) {
          clearVerifier();
          showCode(number, confirmation);
        }
      } catch (error) {
        clearVerifier();
        throw authError(error);
      }
    }, 'Sending code… Complete the reCAPTCHA if prompted.');
  }

  function showCode(number, confirmation) {
    const code = el('input', {type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', required: '',
      pattern: '[0-9]{6}', maxlength: '6'});
    const submit = button('Verify and sign in', null, 'submit');
    const resend = button('Change number or resend', 'secondary');
    const feedback = status();
    const form = el('form', {}, el('p', {}, `Code sent to ${number}.`),
      field('Six-digit code', code), el('div', {class: 'actions'}, submit, resend), feedback);
    section.replaceChildren(form);
    code.focus();
    resend.addEventListener('click', () => showPhone(true));
    form.addEventListener('submit', event => {
      event.preventDefault();
      run(submit, feedback, async () => {
        resend.disabled = true;
        try {
          await confirmation.confirm(code.value);
        } catch (error) {
          throw authError(error);
        } finally {
          resend.disabled = false;
        }
      }, 'Verifying code…');
    });
  }
  showPhone();
}
