import {api} from './services.js';
import {pdfReader} from './ebooks.js?v=pdf-reader-minimal-v2';
import {backLink, bindForm, button, confirmDelete, el, empty, expandableSummary, field, heading, icon, idPart, link, loadInto, panel, rule, run, say, status, textValue} from './ui.js?v=merge-resolved-v1';

async function download(ctx, item) {
  const blob = await api(`/free-materials/${idPart(item.id)}/download`, {ctx, auth: true, blob: true});
  const url = URL.createObjectURL(blob);
  const anchor = el('a', {href: url, download: `${item.title.replace(/[^\w .-]+/g, '_')}.pdf`});
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadButton(ctx, item, feedback) {
  const control = button('Download', 'secondary');
  control.prepend(icon('download', 'line-icon'));
  control.addEventListener('click', () => run(control, feedback, () => download(ctx, item), 'Downloading…'));
  return control;
}

export function showFreeMaterials(main, ctx, action) {
  main.append(...heading('Free study material', 'Explore free PDFs and read them without purchasing a course.'));
  if (!ctx.user) {
    main.append(action.signInLink());
    return;
  }
  const content = el('div', {class: 'grid free-material-grid'});
  main.append(content);
  loadInto(content, ctx, async () => {
    const items = await api('/free-materials', {ctx, auth: true});
    content.replaceChildren(...(items.length ? items.map(item => {
      const feedback = status();
      return el('article', {class: 'panel card free-material-card'}, el('div', {class: 'card-body'},
        icon('files', 'line-icon'),
        expandableSummary(ctx, item.title, el('h2', {}, item.title)),
        el('p', {class: 'muted free-material-pages'}, `${item.pages} pages`),
        el('div', {class: 'actions'}, link('View PDF', `#free-material/${idPart(item.id)}`, 'button'),
          item.downloadsEnabled ? downloadButton(ctx, item, feedback) : null), feedback));
    }) : [empty('No free study material is available yet.')]));
  });
}

export function showFreeMaterial(main, ctx, id) {
  const content = el('div');
  main.append(backLink('Back to Free study material', '#free-materials'), content);
  loadInto(content, ctx, async () => {
    const item = await api(`/free-materials/${idPart(id)}`, {ctx, auth: true});
    const feedback = status();
    content.replaceChildren(...heading(item.title), item.downloadsEnabled ? downloadButton(ctx, item, feedback) : null, feedback);
    pdfReader(content, ctx, {title: item.title, pages: item.pages,
      pagePath: `/free-materials/${idPart(id)}/pages`});
  });
}

export function freeMaterialsAdmin(ctx) {
  const list = el('div', {class: 'manage-list'});
  const feedback = status();
  const content = el('div', {}, list, feedback);
  const pdfInput = required => rule(el('input', {type: 'file', accept: '.pdf,application/pdf', ...(required ? {required: ''} : {})}),
    (_, control) => {
      const file = control.files[0];
      return file && (!/\.pdf$/i.test(file.name) || file.size < 1 || file.size > 12 * 1024 * 1024) ?
        'Choose a PDF up to 12 MB.' : '';
    });
  const editor = (item = null) => {
    const title = el('input', {required: '', maxlength: '120', value: item?.title || ''});
    const pdf = pdfInput(!item);
    const downloads = el('input', {type: 'checkbox', role: 'switch'});
    downloads.checked = Boolean(item?.downloadsEnabled);
    const save = button(item ? 'Save Changes' : 'Publish Material', null, 'submit');
    const result = status();
    const form = el('form', {class: 'manage-editor'}, field('Title', title), field(item ? 'Replace PDF (optional)' : 'Choose File', pdf),
      el('label', {class: 'choice'}, downloads, 'Allow PDF download'), save, result);
    bindForm(form, save, result, async () => {
      const name = textValue(title, 'Title');
      const path = `/admin/free-materials${item ? `/${idPart(item.id)}` : ''}`;
      const file = pdf.files[0];
      const method = item ? 'PUT' : 'POST';
      if (file) {
        const query = new URLSearchParams({title: name, downloadsEnabled: String(downloads.checked)});
        await api(`${path}?${query}`, {ctx, auth: true, method, binary: file});
      } else {
        await api(path, {ctx, auth: true, method, json: {title: name, downloadsEnabled: downloads.checked}});
      }
      form.reset();
      if (item) form.remove();
      say(feedback, item ? 'Material updated.' : 'Material published.');
      await reload();
    }, 'Saving material…');
    return form;
  };
  const reload = async () => {
    const items = await api('/free-materials', {ctx, auth: true});
    list.replaceChildren(...(items.length ? items.map(item => {
      const rowFeedback = status();
      const edit = button('Edit', 'secondary');
      const row = el('article', {class: 'manage-item'},
        el('h3', {}, item.title), el('p', {class: 'muted'},
          `${item.pages} pages · ${item.downloadsEnabled ? 'Downloads on' : 'View only'}`),
        el('div', {class: 'actions'}, edit, confirmDelete(rowFeedback, async () => {
          await api(`/admin/free-materials/${idPart(item.id)}`, {ctx, auth: true, method: 'DELETE'});
          await reload();
          say(feedback, 'Material deleted.');
        }, {question: 'Delete this free study material?'})), rowFeedback);
      edit.addEventListener('click', () => {
        const existing = row.querySelector('form');
        if (existing) existing.remove();
        else row.append(editor(item));
      });
      return row;
    }) : [empty('No free study material published yet.')]));
  };
  return {list: content, add: panel('Publish Free Study Material', editor()), reload: () =>
    loadInto(list, ctx, reload)};
}
