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
export const empty = text => el('p', {class: 'empty'}, text);
export const status = () => el('p', {class: 'status', role: 'status', 'aria-atomic': 'true'});
export const panel = (title, ...children) => el('section', {class: 'panel section'}, el('h2', {}, title), children);
export const idPart = id => encodeURIComponent(String(id));

export function say(node, text, error = false) {
  node.classList.toggle('error', error);
  node.textContent = text;
}

export function field(text, control, hint) {
  const id = `field-${++fieldCount}`;
  control.id = id;
  if (hint) control.setAttribute('aria-describedby', `${id}-hint`);
  return el('div', {class: 'field'}, el('label', {for: id}, text), control,
    hint ? el('small', {id: `${id}-hint`}, hint) : null);
}
let fieldCount = 0;

export function bindForm(form, submit, feedback, action, busy = 'Working…') {
  form.addEventListener('submit', event => {
    event.preventDefault();
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
  const retry = button('Try again', 'secondary');
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

export function textValue(input, label) {
  const value = input.value.trim();
  if (!value) throw new Error(`${label} cannot be blank.`);
  return value;
}
