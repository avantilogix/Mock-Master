import {api} from './services.js';
import {adminContentForm} from './reports.js';
import {bindForm, button, el, entries, field, heading, idPart, loadInto, panel, run, say, status, textValue} from './ui.js';

const pdfAccept = '.pdf,application/pdf';

function questionData(source) {
  let data;
  try { data = JSON.parse(source); } catch { throw new Error('Questions must be valid JSON. Check commas, quotes, and brackets.'); }
  if (!Array.isArray(data) || !data.length) throw new Error('Add at least one question in a JSON array.');
  return data.map((item, index) => {
    const {prompt, options, answer} = item || {};
    if (typeof prompt !== 'string' || !prompt.trim() || !Array.isArray(options) || options.length < 2 ||
        options.some(value => typeof value !== 'string' || !value.trim()) ||
        !Number.isInteger(answer) || answer < 0 || answer >= options.length) {
      throw new Error(`Question ${index + 1} needs a prompt, at least two options, and a valid zero-based answer.`);
    }
    return {prompt: prompt.trim(), options: options.map(value => value.trim()), answer};
  });
}

export function showAdmin(main, ctx) {
  main.append(...heading('Admin workspace', 'Approve course payments, publish learning material, and support students from your phone.'));
  const get = path => api(path, {ctx, auth: true});
  const post = (path, body) => api(path, {ctx, auth: true, method: 'POST', ...body});
  const payments = el('div');
  const paymentRefresh = button('Refresh requests', 'secondary');
  const samples = button('Load sample missions', 'secondary');
  const sampleStatus = status();
  const content = el('div');
  const timetable = el('div');
  const physicalBooks = el('div');
  const physicalOrders = el('div');
  const students = el('div');
  const youtube = el('input', {type: 'url', placeholder: 'https://youtube.com/@yourchannel'});
  const instagram = el('input', {type: 'url', placeholder: 'https://instagram.com/yourpage'});
  const telegram = el('input', {type: 'url', placeholder: 'https://t.me/yourcommunity'});
  const socialSave = button('Save social links', null, 'submit');
  const socialFeedback = status();
  const socialForm = el('form', {}, field('YouTube URL', youtube), field('Instagram URL', instagram),
    field('Telegram URL', telegram), socialSave, socialFeedback);
  bindForm(socialForm, socialSave, socialFeedback, async () => {
    await api('/admin/social', {ctx, auth: true, method: 'PUT', json: {
      youtube: youtube.value.trim(), instagram: instagram.value.trim(), telegram: telegram.value.trim(),
    }});
    say(socialFeedback, 'Social links saved. Students will see them in Profile.');
  }, 'Saving links…');
  api('/social', {ctx}).then(values => {
    youtube.value = values.youtube || '';
    instagram.value = values.instagram || '';
    telegram.value = values.telegram || '';
  }).catch(error => {
    if (ctx.current() && error.name !== 'AbortError') say(socialFeedback, error.message, true);
  });
  const inbox = el('div');
  const courseSelects = [];
  function courseField() {
    const select = el('select', {required: ''});
    courseSelects.push(select);
    return [select, field('Course', select)];
  }
  function setCourses(list) {
    for (const select of courseSelects) {
      const selected = select.value;
      select.replaceChildren(el('option', {value: ''}, list.length ? 'Choose a course' : 'No courses available'),
        ...list.map(course => el('option', {value: course.id}, course.title)));
      if (list.some(course => String(course.id) === selected)) select.value = selected;
    }
  }
  let courseList = [];
  const refresh = async () => {
    courseList = await api('/courses', {ctx});
    setCourses(courseList);
  };
  const loadPayments = () => loadInto(payments, ctx, async () => {
    const requests = await get('/admin/payments');
    payments.replaceChildren(...(requests.length ? requests.map(request => {
      const approve = button('Approve and unlock');
      const reject = button('Reject', 'danger secondary');
      const rejection = el('textarea', {rows: '2', maxlength: '500', placeholder: 'Reason for rejection'});
      const feedback = status();
      approve.disabled = request.status !== 'pending';
      reject.disabled = request.status !== 'pending';
      approve.addEventListener('click', () => run(approve, feedback, async () => {
        await post(`/admin/payments/${idPart(request.id)}/approve`, {json: {}});
        say(feedback, `${request.course} is now unlocked for ${request.name}.`);
        setTimeout(loadPayments, 500);
      }, 'Approving…'));
      reject.addEventListener('click', () => run(reject, feedback, async () => {
        if (!rejection.value.trim()) throw new Error('Enter a rejection reason.');
        await post(`/admin/payments/${idPart(request.id)}/reject`, {json: {note: rejection.value.trim()}});
        say(feedback, 'Request rejected. The student can resubmit payment proof.');
        setTimeout(loadPayments, 500);
      }, 'Rejecting…'));
      return el('article', {class: 'payment-request'},
        el('div', {class: 'payment-request-head'}, el('div', {}, el('strong', {}, request.name),
          el('p', {class: 'muted'}, request.phone)), el('span', {class: `request-state ${request.status}`}, request.status)),
        el('h3', {}, request.course), el('p', {class: 'price'}, new Intl.NumberFormat('en-IN',
          {style: 'currency', currency: 'INR'}).format(request.amount / 100)),
        el('dl', {class: 'payment-summary'}, el('dt', {}, 'UPI reference'), el('dd', {}, request.reference),
          el('dt', {}, 'Submitted'), el('dd', {}, request.submittedAt ? new Date(request.submittedAt).toLocaleString('en-IN') : 'Unavailable')),
        request.note ? el('p', {class: 'muted'}, request.note) : null,
        request.reviewNote ? el('p', {class: 'rejection'}, request.reviewNote) : null,
        request.status === 'pending' ? field('Rejection reason (only if needed)', rejection) : null,
        el('div', {class: 'actions'}, approve, reject), feedback);
    }) : [el('p', {class: 'empty'}, 'No payment requests yet.')]));
  });
  paymentRefresh.addEventListener('click', loadPayments);
  samples.addEventListener('click', () => run(samples, sampleStatus, async () => {
    const result = await post('/admin/seed-samples', {json: {}});
    await refresh();
    say(sampleStatus, `${result.courses} sample missions are available in the catalog.`);
  }, 'Loading sample missions…'));

  const day = el('select', {required: ''}, ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    .map(value => el('option', {value}, value)));
  const scheduleTitle = el('input', {required: '', maxlength: '120'});
  const start = el('input', {type: 'time', required: ''});
  const duration = el('input', {required: '', maxlength: '30', placeholder: '60 minutes'});
  const scheduleDescription = el('textarea', {rows: '3', required: '', maxlength: '1000'});
  const scheduleSubmit = button('Publish schedule', null, 'submit');
  const scheduleFeedback = status();
  const scheduleForm = el('form', {}, field('Day', day), field('Session title', scheduleTitle),
    field('Start time', start), field('Duration', duration), field('Description', scheduleDescription),
    scheduleSubmit, scheduleFeedback);
  const loadTimetable = () => loadInto(timetable, ctx, async () => {
    const rows = await get('/admin/timetable');
    timetable.replaceChildren(entries(rows, 'No timetable sessions published.', item => [
      el('strong', {}, `${item.day || ''} · ${item.starts_at || item.startsAt}`),
      el('p', {}, item.title), el('p', {class: 'muted'}, `${item.duration} — ${item.description}`),
    ]));
  });
  bindForm(scheduleForm, scheduleSubmit, scheduleFeedback, async () => {
    await post('/admin/timetable', {json: {
      day: day.value, title: textValue(scheduleTitle, 'Session title'), startsAt: start.value,
      duration: textValue(duration, 'Duration'), description: textValue(scheduleDescription, 'Description'),
    }});
    scheduleForm.reset();
    say(scheduleFeedback, 'Timetable session published.');
    loadTimetable();
  }, 'Publishing schedule…');

  const physicalTitle = el('input', {required: '', maxlength: '120'});
  const physicalDescription = el('textarea', {rows: '3', required: '', maxlength: '2000'});
  const physicalPrice = el('input', {type: 'number', min: '100', max: '10000000', step: '1', required: ''});
  const stock = el('input', {type: 'number', min: '0', max: '10000', step: '1', required: ''});
  const physicalSubmit = button('Publish physical book', null, 'submit');
  const physicalFeedback = status();
  const physicalForm = el('form', {}, field('Book title', physicalTitle),
    field('Description', physicalDescription), field('Price in paise', physicalPrice), field('Stock', stock),
    physicalSubmit, physicalFeedback);
  const loadPhysicalBooks = () => loadInto(physicalBooks, ctx, async () => {
    const rows = await get('/admin/physical-books');
    physicalBooks.replaceChildren(entries(rows, 'No physical books published.', item => [
      el('strong', {}, item.title), el('p', {class: 'muted'},
        `₹${(item.price / 100).toFixed(2)} · ${item.stock} in stock`),
    ]));
  });
  bindForm(physicalForm, physicalSubmit, physicalFeedback, async () => {
    await post('/admin/physical-books', {json: {
      title: textValue(physicalTitle, 'Book title'), description: textValue(physicalDescription, 'Description'),
      price: physicalPrice.valueAsNumber, stock: stock.valueAsNumber,
    }});
    physicalForm.reset();
    say(physicalFeedback, 'Physical book published.');
    loadPhysicalBooks();
  }, 'Publishing book…');

  const loadPhysicalOrders = () => loadInto(physicalOrders, ctx, async () => {
    const orders = await get('/admin/physical-orders');
    physicalOrders.replaceChildren(...(orders.length ? orders.map(order => {
      const tracking = el('input', {maxlength: '100', placeholder: 'Tracking / courier reference'});
      tracking.value = order.tracking || '';
      const note = el('input', {maxlength: '500', placeholder: 'Customer note'});
      note.value = order.review_note || order.reviewNote || '';
      const feedback = status();
      const controls = el('div', {class: 'actions'});
      for (const [nextStatus, label] of [['approved', 'Approve payment'], ['shipped', 'Mark shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancel']]) {
        const action = button(label, nextStatus === 'cancelled' ? 'danger secondary' : 'secondary');
        action.disabled = order.status === nextStatus;
        action.addEventListener('click', () => run(action, feedback, async () => {
          await post(`/admin/physical-orders/${idPart(order.id)}/status`, {json: {
            status: nextStatus, tracking: tracking.value, note: note.value,
          }});
          say(feedback, `Order updated to ${nextStatus}.`);
          setTimeout(loadPhysicalOrders, 350);
        }, 'Updating order…'));
        controls.append(action);
      }
      return el('article', {class: 'payment-request'},
        el('div', {class: 'payment-request-head'}, el('div', {}, el('strong', {}, order.name),
          el('p', {class: 'muted'}, order.phone || order.accountPhone)), el('span', {class: `request-state ${order.status}`}, order.status)),
        el('h3', {}, order.bookTitle), el('p', {}, `${order.quantity} copies · ₹${(order.amount / 100).toFixed(2)}`),
        el('p', {class: 'entry-text'}, order.address), el('p', {class: 'muted'}, `UPI reference: ${order.transaction_ref || order.transactionRef}`),
        field('Tracking', tracking), field('Order note', note), controls, feedback);
    }) : [el('p', {class: 'empty'}, 'No physical book orders yet.')]));
  });
  const loadStudents = () => loadInto(students, ctx, async () => {
    const rows = await get('/admin/students');
    students.replaceChildren(...(rows.length ? rows.map(student => {
      const disabled = Boolean(student.disabled);
      const action = button(disabled ? 'Reactivate account' : 'Disable account',
        disabled ? 'secondary' : 'danger secondary');
      const feedback = status();
      action.addEventListener('click', () => run(action, feedback, async () => {
        await post(`/admin/students/${idPart(student.uid)}/status`, {json: {disabled: !disabled}});
        say(feedback, disabled ? 'Account reactivated.' : 'Account disabled.');
        setTimeout(loadStudents, 350);
      }, 'Updating account…'));
      return el('article', {class: 'student-control'},
        el('div', {}, el('strong', {}, student.name || 'Student'), el('p', {class: 'muted'}, student.phone),
          el('code', {class: 'muted'}, student.uid)),
        action, feedback);
    }) : [el('p', {class: 'empty'}, 'No signed-in students yet.')]));
  });

  const title = el('input', {required: '', maxlength: '120'});
  const description = el('textarea', {rows: '3', required: '', maxlength: '2000'});
  const price = el('input', {type: 'number', min: '100', max: '10000000', step: '1', required: '', inputmode: 'numeric'});
  const create = button('Create live course', null, 'submit');
  const courseStatus = status();
  const createForm = el('form', {}, field('Course title', title), field('Description', description),
    field('Price in paise', price, 'Enter 100 to 10000000 paise. For example, enter 49900 for ₹499.'),
    create, courseStatus);
  bindForm(createForm, create, courseStatus, async () => {
    if (!Number.isInteger(price.valueAsNumber) || price.valueAsNumber < 100 || price.valueAsNumber > 10000000) {
      throw new Error('Enter a whole number between 100 and 10000000 paise.');
    }
    await post('/admin/courses', {json: {title: textValue(title, 'Title'), description: textValue(description, 'Description'),
      price: price.valueAsNumber}});
    createForm.reset();
    try {
      await refresh();
      say(courseStatus, 'Course created and available in the catalog.');
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      say(courseStatus, 'Course created. Reload this workspace to refresh the course list.', true);
    }
  }, 'Creating course…');

  loadInto(content, ctx, async () => {
    await refresh();
    content.replaceChildren();
  });
  main.append(panel('Payment approvals',
    el('p', {class: 'muted'}, 'Verify each UPI transaction in the receiving account before unlocking a student course.'),
    paymentRefresh, el('div', {class: 'payment-requests'}, payments)),
  panel('Quick start', el('p', {class: 'muted'},
    'Add or refresh three ready-made missions with mock tests and protected starter books.'), samples, sampleStatus),
  panel('Create a course', createForm), content);
  loadPayments();
  main.append(panel('Student timetable', scheduleForm, timetable),
    panel('Physical books', physicalForm, physicalBooks),
    panel('Physical book orders', physicalOrders),
    panel('Student accounts', students),
    panel('Social media links', socialForm));
  loadTimetable();
  loadPhysicalBooks();
  loadPhysicalOrders();
  loadStudents();

  const example = JSON.stringify([{prompt: 'What is 2 + 2?', options: ['3', '4'], answer: 1}], null, 2);
  const editor = el('textarea', {class: 'json', rows: '12', required: '', spellcheck: 'false', placeholder: example});
  const importFile = el('input', {type: 'file', accept: '.pdf,.docx,.txt', required: ''});
  const importButton = button('Import questions', 'secondary', 'submit');
  const importStatus = status();
  const importForm = el('form', {}, field('Question file', importFile, 'PDF, DOCX, or TXT. Importing replaces the JSON draft below.'),
    importButton, importStatus);
  bindForm(importForm, importButton, importStatus, async () => {
    const file = importFile.files[0];
    const format = file?.name.split('.').pop().toLowerCase();
    if (!file || !['pdf', 'docx', 'txt'].includes(format)) throw new Error('Choose a PDF, DOCX, or TXT file.');
    const original = editor.value;
    const result = await post(`/admin/import?format=${format}`, {binary: file});
    if (!Array.isArray(result?.questions) || !result.questions.length) throw new Error('No questions were found. Try a different file or enter questions manually.');
    if (editor.value !== original) throw new Error('The JSON draft changed during import. Import again when you are ready to replace it.');
    editor.value = JSON.stringify(result.questions, null, 2);
    say(importStatus, `Imported ${result.questions.length} questions. Review and edit the JSON before publishing.`);
  }, 'Importing questions…');

  const [testCourse, testField] = courseField();
  const testTitle = el('input', {required: '', maxlength: '120'});
  const publish = button('Publish test', null, 'submit');
  const testStatus = status();
  const testForm = el('form', {}, testField, field('Test title', testTitle),
    field('Questions (JSON)', editor, 'Enter an array of objects with prompt, options, and answer. The first option is answer 0.'),
    publish, testStatus);
  bindForm(testForm, publish, testStatus, async () => {
    const questions = questionData(editor.value);
    await post(`/admin/courses/${idPart(testCourse.value)}/tests`, {json: {title: textValue(testTitle, 'Test title'), questions}});
    testForm.reset();
    say(testStatus, 'Test published.');
  }, 'Publishing test…');
  main.append(panel('Publish a test', el('h3', {}, 'Import questions (optional)'), importForm,
    el('div', {class: 'section'}, el('h3', {}, 'Review, edit, and publish'), testForm)));

  const [bookCourse, bookField] = courseField();
  const bookTitle = el('input', {required: '', maxlength: '120'});
  const pdf = el('input', {type: 'file', accept: pdfAccept, required: ''});
  const upload = button('Upload book', null, 'submit');
  const bookStatus = status();
  const bookForm = el('form', {}, bookField, field('Book title', bookTitle), field('PDF file', pdf), upload, bookStatus);
  bindForm(bookForm, upload, bookStatus, async () => {
    const file = pdf.files[0];
    if (!file || !/\.pdf$/i.test(file.name)) throw new Error('Choose a PDF file.');
    const query = new URLSearchParams({title: textValue(bookTitle, 'Book title')});
    await post(`/admin/courses/${idPart(bookCourse.value)}/books?${query}`, {binary: file});
    bookForm.reset();
    say(bookStatus, 'Book uploaded.');
  }, 'Uploading book…');
  setCourses(courseList);
  main.append(panel('Upload a study book', bookForm),
    panel('Publish learning resources', adminContentForm(post, () => refresh())),
    panel('Support inbox', inbox));
  loadInto(inbox, ctx, async () => {
    const messages = await get('/admin/support');
    inbox.replaceChildren(entries(messages, 'No support requests have arrived yet.', item => [
      el('strong', {}, item.phone), el('p', {class: 'entry-text'}, item.text)
    ]));
  });
}
