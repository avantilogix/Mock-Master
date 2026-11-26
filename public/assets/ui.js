export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child !== null && child !== undefined) node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

export const heading = (title, description) => [
  el('h1', {}, title),
  description && el('p', {class: 'lead'}, description)
].filter(Boolean);

export const link = (text, href, className) => el('a', {href, class: className}, text);
export const button = (text, className, type = 'button') => el('button', {class: className, type}, text);
export function iconAction(control, name, label) {
  control.replaceChildren(icon(name, 'line-icon'));
  control.classList.add('icon-action');
  control.setAttribute('aria-label', label);
  control.title = label;
  return control;
}
export function icon(name, className) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(namespace, 'use');
  use.setAttribute('href', `/assets/icons.svg?v=course-material-file-icon-v1#${name}`);
  svg.append(use);
  return svg;
}
export const empty = text => el('p', {class: 'empty'}, text);
export const status = () => el('p', {class: 'status', role: 'status', 'aria-atomic': 'true'});
export const panel = (title, ...children) => el('section', {class: 'panel section'}, el('h2', {}, title), children);
export const idPart = id => encodeURIComponent(String(id));

export function say(node, text, error = false) {
  node.classList.toggle('error', error);
  node.textContent = text;
}

const controlSelector = 'input:not([type="radio"]):not([type="checkbox"]), select, textarea';
const textTypes = ['text', 'tel', 'url', 'email', 'search', 'textarea'];

export function field(text, control, hint) {
  const id = `field-${++fieldCount}`;
  const input = control.matches(controlSelector) ? control : control.querySelector(controlSelector) || control;
  input.id = id;
  input.dataset.label ||= text.replace(/\s*\((?:optional[^)]*|only if needed)\)\s*$/i, '').replace(/\?$/, '');
  input.setAttribute('aria-describedby', [`${id}-error`, hint && `${id}-hint`].filter(Boolean).join(' '));
  const wrapper = el('div', {class: input.required ? 'field required' : 'field'}, el('label', {for: id}, text), control,
    el('small', {id: `${id}-error`, class: 'field-error', hidden: ''}),
    hint ? el('small', {id: `${id}-hint`}, hint) : null);
  const recheck = () => { if (input.getAttribute('aria-invalid') === 'true') fieldError(input, errorFor(input)); };
  input.addEventListener('input', recheck);
  input.addEventListener('change', recheck);
  input.addEventListener('blur', () => { if (input.value.trim()) fieldError(input, errorFor(input)); });
  return wrapper;
}
let fieldCount = 0;

// Attach an extra check to a control; `check(value, control)` returns an error message or ''.
export function rule(control, check) {
  control.validate = check;
  return control;
}

function errorFor(control) {
  if (control.disabled || control.closest('[hidden]')) return '';
  const label = control.dataset.label || 'This field';
  const value = control.value.trim();
  const state = control.validity;
  const type = control.tagName === 'TEXTAREA' ? 'textarea' : control.type;
  if (state.valueMissing || (control.required && textTypes.includes(type) && !value)) {
    return type === 'file' ? 'Choose a file to upload.' : `${label} is required.`;
  }
  if (state.badInput) return `Enter a valid number for ${label}.`;
  if (state.typeMismatch) return type === 'url' ? 'Enter a valid link starting with https://' : `Enter a valid ${label}.`;
  if (state.patternMismatch) return control.dataset.patternMessage || `Enter a valid ${label}.`;
  if (state.tooShort) return `${label} must be at least ${control.minLength} characters.`;
  if (state.tooLong || (control.maxLength > 0 && control.value.length > control.maxLength)) {
    return `${label} must be ${control.maxLength} characters or fewer.`;
  }
  if (state.rangeUnderflow) return `${label} must be at least ${control.min}.`;
  if (state.rangeOverflow) return `${label} must be ${control.max} or less.`;
  if (state.stepMismatch) return `${label} must be a whole number.`;
  return control.validate?.(value, control) || '';
}

export function fieldError(control, message = '') {
  const wrapper = control.closest('.field');
  const error = wrapper?.querySelector('.field-error');
  if (!error) return !message;
  error.textContent = message;
  error.hidden = !message;
  wrapper.classList.toggle('invalid', Boolean(message));
  if (message) control.setAttribute('aria-invalid', 'true');
  else control.removeAttribute('aria-invalid');
  return !message;
}

export function checkField(control) {
  const valid = fieldError(control, errorFor(control));
  if (!valid) control.focus();
  return valid;
}

export function validate(form) {
  let first;
  for (const control of form.querySelectorAll(controlSelector)) {
    if (!control.closest('.field')) continue;
    if (!fieldError(control, errorFor(control))) first ||= control;
  }
  first?.focus();
  return !first;
}

export function bindForm(form, submit, feedback, action, busy = 'Working…') {
  form.noValidate = true;
  form.addEventListener('reset', () => {
    for (const control of form.querySelectorAll('[aria-invalid="true"]')) fieldError(control);
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    if (submit.disabled) return;
    if (!validate(form)) {
      say(feedback, 'Please correct the fields highlighted in red.', true);
      return;
    }
    say(feedback, '');
    run(submit, feedback, action, busy);
  });
}

export async function run(control, feedback, action, busy = 'Working…') {
  if (control.disabled) return;
  control.disabled = true;
  if (busy) say(feedback, busy);
  try {
    await action();
  } catch (error) {
    if (error.name !== 'AbortError' && feedback.isConnected) say(feedback, error.message, true);
  } finally {
    control.disabled = false;
  }
}

export function loadInto(target, ctx, action) {
  const feedback = status();
  const retry = button('Try Again', 'secondary');
  const load = () => {
    target.replaceChildren(feedback);
    run(retry, feedback, async () => {
      try {
        await action();
      } catch (error) {
        if (ctx.current() && error.name !== 'AbortError') target.append(retry);
        throw error;
      }
    }, 'Loading…');
  };
  retry.addEventListener('click', load);
  load();
}

export function entries(items, fallback, render) {
  return items.length ? el('ul', {class: 'entries'}, items.map(item => el('li', {}, render(item)))) : empty(fallback);
}

export function formatDate(value, withTime = true) {
  if (!value) return 'Date not recorded';
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return 'Date not recorded';
  return date.toLocaleString('en-IN', {...(withTime && value.length > 10 ?
    {day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit'} :
    { day: 'numeric', month: 'short', year: 'numeric' }), timeZone: 'Asia/Kolkata'});
}

// A delete button that asks for confirmation inline before running `action`.
export function confirmDelete(feedback, action, {label = 'Delete', question = 'Delete this item?', busy = 'Deleting…'} = {}) {
  const wrapper = el('div', {class: 'confirm-delete'});
  const start = iconAction(button('', 'danger secondary'), 'trash', label);
  const yes = button('Yes, Delete', 'danger');
  const no = button('Cancel', 'secondary');
  const prompt = el('div', {class: 'confirm-prompt', role: 'alert'}, el('span', {}, question), yes, no);
  const show = asking => {
    wrapper.replaceChildren(asking ? prompt : start);
    (asking ? no : start).focus();
  };
  start.addEventListener('click', () => show(true));
  no.addEventListener('click', () => show(false));
  yes.addEventListener('click', () => run(yes, feedback, action, busy));
  wrapper.append(start);
  return wrapper;
}

export function textValue(input, label) {
  const value = input.value.trim();
  if (!value) {
    const message = `${label} is required.`;
    fieldError(input, message);
    throw new Error(message);
  }
  return value;
}
