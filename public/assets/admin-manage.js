import {api} from './services.js';
import {contentKinds} from './reports.js?v=manage-20261122';
import {coverPicker} from './publishing-media.js';
import {bindForm, button, confirmDelete, el, field, formatDate, idPart, loadInto, rule, run, say, status, textValue} from './ui.js';

const rupees = paise => new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR'}).format(paise / 100);
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const megabytes = bytes => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
export const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const input = (value, maxlength, attrs = {}) => {
  const control = el('input', {required: '', maxlength: String(maxlength), ...attrs});
  control.value = value ?? '';
  return control;
};
const area = (value, maxlength, rows = 3, required = true) => {
  const control = el('textarea', {rows: String(rows), maxlength: String(maxlength), ...(required ? {required: ''} : {})});
  control.value = value ?? '';
  return control;
};

// Each type describes how its rows are summarised, which fields can be edited, and how deletion is explained.
function types({rupeeInput, toPaise, questionData, priceHint, courses}) {
  const price = value => {
    const control = rupeeInput();
    control.value = String(value / 100);
    return control;
  };
  const chapterFields = item => {
    const title = input(item.title, 120);
    const subject = input(item.subject, 100);
    const chapter = input(item.chapter, 120);
    return {
      fields: [field('Title', title), field('Subject', subject), field('Chapter', chapter)],
      values: () => ({title: textValue(title, 'Title'), subject: textValue(subject, 'Subject'), chapter: textValue(chapter, 'Chapter')}),
    };
  };
  return {
    courses: {
      label: 'Courses', noun: 'course', empty: 'No courses created yet. Use Create a Course above.',
      details: item => [rupees(item.price), plural(item.tests, 'test'), plural(item.materials, 'study item'),
        plural(item.enrollments, 'enrolment'), ...(item.expiresOn ? [`Expiry: ${formatDate(item.expiresOn, false)} (IST)`] : [])],
      text: item => item.description,
      edit(item) {
        const title = input(item.title, 120);
        const description = area(item.description, 2000);
        const amount = price(item.price);
        return {
          fields: [field('Course Title', title), field('Description', description), field('Price (₹)', amount, priceHint)],
          values: () => ({title: textValue(title, 'Title'), description: textValue(description, 'Description'), price: toPaise(amount)}),
        };
      },
      remove: item => item.enrollments ?
        {blocked: 'Students have purchased or requested this course, so it can be edited but not deleted.'} :
        item.linkedVideos || item.tests || item.materials ?
          {blocked: 'Remove or unlink this course’s published content before deleting it.'} :
          {question: 'Delete this course?'},
    },
    tests: {
      label: 'Tests', noun: 'test', course: true, empty: 'No tests published yet.',
      details: item => [plural(item.questions.length, 'question'), plural(item.attempts, 'student attempt')],
      edit(item) {
        const title = input(item.title, 120);
        const questions = rule(area(JSON.stringify(item.questions, null, 2), 200000, 10), value => {
          try { questionData(value); return ''; } catch (error) { return error.message; }
        });
        questions.classList.add('json');
        questions.spellcheck = false;
        return {
          fields: [field('Test Title', title), field('Questions (JSON)', questions,
            'Each question needs a prompt, at least two options, and a zero-based answer.')],
          values: () => ({title: textValue(title, 'Test title'), questions: questionData(questions.value)}),
        };
      },
      remove: item => item.attempts ? {blocked: 'This test has student results and cannot be deleted.'} :
        {question: 'Delete this test?'},
    },
    books: {
      label: 'Study Books', noun: 'study book', course: true, empty: 'No PDF study books uploaded yet.',
      details: item => [`${item.subject} › ${item.chapter}`, plural(item.pages, 'page')],
      edit: chapterFields,
      remove: () => ({question: 'Delete this PDF study book?'}),
    },
    chapterVideos: {
      label: 'Chapter Videos', noun: 'chapter video', course: true, empty: 'No chapter videos uploaded yet.',
      details: item => [`${item.subject} › ${item.chapter}`, megabytes(item.size)],
      edit: chapterFields,
      remove: () => ({question: 'Delete this chapter video file?'}),
    },
    videos: {
      label: 'YouTube Videos', noun: 'video', course: true, empty: 'No YouTube videos published yet.',
      details: item => [item.courseTitle ? '' : 'All students', `youtu.be/${item.videoId}`].filter(Boolean),
      text: item => item.description,
      edit(item) {
        const title = input(item.title, 120);
        const description = area(item.description, 1000);
        const course = el('select', {}, el('option', {value: ''}, 'All Students (No Specific Course)'),
          courses().map(entry => el('option', {value: entry.id}, entry.title)));
        course.value = item.course || '';
        return {
          fields: [field('Course', course), field('Video Title', title), field('Description', description)],
          values: () => ({course: course.value, title: textValue(title, 'Video title'), description: textValue(description, 'Description')}),
        };
      },
      remove: () => ({question: 'Delete this YouTube video from the library?'}),
    },
    resources: {
      label: 'Learning Resources', noun: 'resource', empty: 'No learning resources published yet.',
      details: item => [contentKinds[item.kind]?.title || item.kind],
      date: item => item.publishedAt || item.createdAt,
      text: item => item.summary,
      edit(item) {
        const title = input(item.title, 120);
        const summary = area(item.summary, 300, 2);
        const body = area(item.body, 10000, 7);
        const published = el('input', {type: 'date', required: ''});
        published.value = (item.publishedAt || item.createdAt || '').slice(0, 10);
        return {
          fields: [field('Publish Date', published), field('Resource Title', title), field('Short Summary', summary), field('Content', body)],
          values: () => ({title: textValue(title, 'Title'), summary: textValue(summary, 'Summary'), body: textValue(body, 'Content'),
            publishedAt: published.value}),
        };
      },
      remove: () => ({question: 'Delete this learning resource?'}),
    },
    physicalBooks: {
      label: 'Physical Books', noun: 'physical book', empty: 'No physical books published yet.',
      details: item => [rupees(item.price), `${item.stock} in stock`, item.active ? 'Visible in store' : 'Hidden from store',
        plural(item.orders, 'order')],
      text: item => item.description,
      edit(item) {
        const title = input(item.title, 120);
        const description = area(item.description, 2000);
        const amount = price(item.price);
        const stock = el('input', {type: 'number', min: '0', max: '10000', step: '1', required: '', value: String(item.stock)});
        const visible = el('input', {type: 'checkbox'});
        visible.checked = Boolean(item.active);
        return {
          fields: [field('Book Title', title), field('Description', description), field('Price (₹)', amount, priceHint),
            field('Stock', stock), el('label', {class: 'choice'}, visible, 'Show this book in the store')],
          values: () => ({title: textValue(title, 'Book title'), description: textValue(description, 'Description'),
            price: toPaise(amount), stock: stock.valueAsNumber, active: visible.checked}),
        };
      },
      remove: item => item.orders ?
        {label: 'Hide from Store', question: 'This book has orders, so it will be hidden instead of deleted. Continue?'} :
        {question: 'Delete this physical book?'},
    },
    schedules: {
      label: 'Timetable', noun: 'session', empty: 'No timetable sessions published yet.',
      details: item => [item.day, item.startsAt, item.duration], text: item => item.description,
      edit(item) {
        const title = input(item.title, 120);
        const day = el('select', {required: ''}, weekdays.map(value => el('option', {value}, value)));
        day.value = item.day;
        const startsAt = el('input', {type: 'time', required: '', value: item.startsAt});
        const duration = input(item.duration, 30);
        const description = area(item.description, 1000);
        return {
          fields: [field('Session Title', title), field('Day', day), field('Start Time', startsAt),
            field('Duration', duration), field('Description', description)],
          values: () => ({title: textValue(title, 'Session title'), day: day.value, startsAt: startsAt.value,
            duration: textValue(duration, 'Duration'), description: textValue(description, 'Description')}),
        };
      },
      remove: () => ({question: 'Delete this timetable session?'}),
    },
  };
}

export function publishedManager({ctx, onChange, ...helpers}) {
  const config = types(helpers);
  const keys = Object.keys(config);
  let data = Object.fromEntries(keys.map(key => [key, []]));
  let active = 'courses';
  let openEditor = null;
  const tabButtons = keys.map(key => {
    const tab = button(config[key].label, 'tab');
    tab.setAttribute('role', 'tab');
    tab.id = `published-tab-${key}`;
    tab.setAttribute('aria-controls', 'published-items');
    tab.dataset.type = key;
    tab.addEventListener('click', () => select(key));
    tab.addEventListener('keydown', event => {
      const step = {ArrowRight: 1, ArrowLeft: -1}[event.key];
      if (!step) return;
      event.preventDefault();
      const next = keys[(keys.indexOf(key) + step + keys.length) % keys.length];
      select(next);
      tabButtons[keys.indexOf(next)].focus();
    });
    return tab;
  });
  const tabs = el('div', {class: 'tabs manage-tabs', role: 'tablist', 'aria-label': 'Published content type'}, tabButtons);
  const search = el('input', {type: 'search', placeholder: 'Search by title, course, subject, or chapter', 'aria-label': 'Search published content'});
  const courseFilter = el('select', {'aria-label': 'Filter by course'});
  const refreshButton = button('Refresh', 'secondary');
  const count = el('p', {class: 'manage-count muted', role: 'status'});
  const feedback = status();
  const list = el('div', {class: 'manage-list', role: 'tabpanel', id: 'published-items', tabindex: '0'});
  const body = el('div');

  function select(key) {
    active = key;
    openEditor = null;
    tabs.hidden = true;
    node.querySelector('.manage-toolbar').hidden = true;
    render();
  }
  const fillCourses = () => {
    const chosen = courseFilter.value;
    courseFilter.replaceChildren(el('option', {value: ''}, 'All Courses'),
      ...data.courses.map(item => el('option', {value: item.id}, item.title)));
    courseFilter.value = data.courses.some(item => item.id === chosen) ? chosen : '';
  };
  function render() {
    const type = config[active];
    list.setAttribute('aria-labelledby', `published-tab-${active}`);
    for (const tab of tabButtons) {
      const selected = tab.dataset.type === active;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      tab.replaceChildren(config[tab.dataset.type].label, el('span', {class: 'tab-count'}, data[tab.dataset.type].length));
    }
    courseFilter.hidden = !type.course;
    const term = search.value.trim().toLowerCase();
    const rows = data[active].filter(item => (!type.course || !courseFilter.value || item.course === courseFilter.value) &&
      (!term || [item.title, item.courseTitle, item.subject, item.chapter, item.description, item.summary]
        .some(value => String(value || '').toLowerCase().includes(term))));
    count.textContent = data[active].length ? `Showing ${rows.length} of ${plural(data[active].length, type.noun)}` : '';
    if (!rows.length) {
      list.replaceChildren(el('p', {class: 'empty'}, data[active].length ? 'No items match your search or course filter.' : type.empty));
      return;
    }
    list.replaceChildren(...rows.map(item => card(type, item)));
  }
  function card(type, item) {
    const key = active;
    const rowFeedback = status();
    const edit = button(openEditor === item.id ? 'Close Editor' : 'Edit', 'secondary');
    const removal = type.remove(item);
    const remove = removal.blocked ? el('p', {class: 'manage-note muted'}, removal.blocked) :
      confirmDelete(rowFeedback, async () => {
        const result = await api(`/admin/published/${key}/${idPart(item.id)}`, {ctx, auth: true, method: 'DELETE'});
        say(feedback, result?.warning || (result?.archived ? `“${item.title}” is now hidden from the store.` : `“${item.title}” was deleted.`), Boolean(result?.warning));
        if (openEditor === item.id) openEditor = null;
        await reload();
        onChange?.(key);
      }, {label: removal.label || 'Delete', question: removal.question});
    const article = el('article', {class: 'manage-item'},
      el('div', {class: 'manage-main'},
        el('div', {class: 'manage-title'}, el('h3', {}, item.title),
          item.courseTitle ? el('span', {class: 'badge'}, item.courseTitle) : null),
        el('p', {class: 'manage-date'}, el('span', {class: 'manage-date-label'}, 'Published'), ' ',
          el('time', {datetime: (type.date || (row => row.createdAt))(item) || ''}, formatDate((type.date || (row => row.createdAt))(item)))),
        el('ul', {class: 'manage-details'}, type.details(item).map(detail => el('li', {}, detail))),
        type.text?.(item) ? el('p', {class: 'manage-text muted'}, type.text(item)) : null),
      el('div', {class: 'actions manage-actions'}, edit, remove), rowFeedback);
    if (active === 'tests') {
      const results = button('View Results', 'secondary');
      const pdf = button('Export PDF', 'secondary');
      results.addEventListener('click', () => run(results, rowFeedback, async () => {
        const result = await api(`/admin/tests/${idPart(item.id)}/results`, {ctx, auth: true});
        const summary = el('div', {class: 'result-table'}, el('h4', {}, `${result.results.length} submissions`),
          ...result.results.map(row => el('article', {class: 'result-table-row'},
            el('div', {class: 'result-student'},
              el('strong', {}, row.name || 'Student'),
              el('span', {}, row.phone || 'Phone unavailable')),
            el('div', {class: 'result-value'},
              el('strong', {}, `${row.score}/${row.maxMarks || 0}`),
              el('span', {}, 'marks')),
            el('time', {class: 'result-date', datetime: row.createdAt || ''},
              formatDate(row.createdAt)))));
        article.querySelector('.result-table')?.remove();
        article.append(summary);
        say(rowFeedback, '');
      }, 'Loading results…'));
      pdf.addEventListener('click', () => run(pdf, rowFeedback, async () => {
        const token = await ctx.user.getIdToken();
        const response = await fetch(`/api/admin/tests/${idPart(item.id)}/results.pdf`,
          {headers: {Authorization: ['Bearer', token].join(' ')}});
        if (!response.ok) throw new Error(`Could not export results (${response.status}).`);
        const url = URL.createObjectURL(await response.blob());
        const anchor = el('a', {href: url, download: `${item.title}-results.pdf`});
        document.body.append(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        say(rowFeedback, 'Result PDF downloaded.');
      }, 'Preparing PDF…'));
      article.querySelector('.manage-actions').append(results, pdf);
    }
    edit.addEventListener('click', () => {
      openEditor = openEditor === item.id ? null : item.id;
      render();
      if (openEditor) list.querySelector('.manage-editor input, .manage-editor textarea, .manage-editor select')?.focus();
    });
    if (openEditor === item.id) article.append(editor(type, item));
    return article;
  }
  function editor(type, item) {
    const key = active;
    const {fields, values} = type.edit(item);
    const covers = ctx.publishingMedia && ['courses', 'books', 'physicalBooks'].includes(key) ?
      coverPicker(ctx, {existing: item.images, required: false}) : null;
    const expiry = ctx.publishingMedia && key === 'courses' ?
      el('input', {type: 'date', required: item.expiresOn ? '' : null, value: item.expiresOn || ''}) : null;
    const save = button('Save Changes', null, 'submit');
    const cancel = button('Cancel', 'secondary');
    const editFeedback = status();
    const form = el('form', {class: 'manage-editor'}, el('h4', {}, `Edit ${type.noun.replace(/\b\w/g, letter => letter.toUpperCase())}`), fields,
      expiry ? field('Course Expiry Date', expiry, 'Access ends after this date, India time.') : null, covers?.node,
      el('div', {class: 'actions'}, save, cancel), editFeedback);
    cancel.addEventListener('click', () => { openEditor = null; render(); });
    bindForm(form, save, editFeedback, async () => {
      const patch = values();
      const images = await covers?.upload();
      await api(`/admin/published/${key}/${idPart(item.id)}`, {ctx, auth: true, method: 'PUT',
        json: {...patch, images, expiresOn: expiry?.value || undefined}});
      openEditor = null;
      say(feedback, `“${item.title}” was updated.`);
      await reload();
      onChange?.(key);
    }, 'Saving changes…');
    return form;
  }
  async function reload() {
    const result = await api('/admin/published', {ctx, auth: true});
    data = Object.fromEntries(keys.map(key => [key, Array.isArray(result?.[key]) ? result[key] : []]));
    fillCourses();
    render();
  }
  search.addEventListener('input', render);
  courseFilter.addEventListener('change', render);
  refreshButton.addEventListener('click', () => { say(feedback, ''); load(); });
  const load = () => loadInto(body, ctx, async () => {
    await reload();
    body.replaceChildren(list);
  });
  const node = el('div', {class: 'manager'}, tabs,
    el('div', {class: 'manage-toolbar'}, search, courseFilter, refreshButton), count, feedback, body);
  load();
  return {node, select, reload: () => reload().catch(error => {
    if (error.name !== 'AbortError') say(feedback, `Could not refresh published content: ${error.message}`, true);
  })};
}
