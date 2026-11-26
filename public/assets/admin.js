import {api} from './services.js';
import {publishedManager, weekdays} from './admin-manage.js?v=ebook-demo-plus-v1';
import {freeMaterialsAdmin} from './free-materials.js';
import {adminContentForm} from './reports.js?v=refresh-icons-v3';
import {coverPicker} from './publishing-media.js';
import {importQuestionReview, manualQuestions} from './manual-questions.js?v=bilingual-import-v1';
import {subjectQuestionManager} from './question-sections.js?v=subject-import-label-v1';
import {questionData} from './question-data.js';
import {maxVideoBytes, uploadChapterVideo, videoAccept, videoType} from './chapter-upload.js';
import {bindForm, button, el, entries, field, fieldError, formatDate, heading, icon, iconAction, idPart, link, loadInto, panel, rule, run, say, status, textValue} from './ui.js?v=student-actions-v2';

const pdfAccept = '.pdf,application/pdf';

function youtubeId(input) {
  try {
    const url = new URL(input);
    const id = url.hostname === 'youtu.be' ? url.pathname.slice(1).split('/')[0] :
      url.hostname.endsWith('youtube.com') ? url.searchParams.get('v') || url.pathname.split('/').filter(Boolean).at(-1) : '';
    return /^[A-Za-z0-9_-]{11}$/.test(id || '') ? id : '';
  } catch {
    return '';
  }
}

const httpsLink = control => rule(control, value =>
  !value || /^https:\/\/[^/\s]+/i.test(value) ? '' : 'Enter a secure link starting with https://');

// Admins enter rupees; the API stores whole paise (₹1–₹1,00,000).
const PRICE_HINT = 'Enter the amount in rupees, for example 500 for ₹500. Allowed: ₹1 to ₹1,00,000.';
const rupeeInput = () => {
  const control = el('input', {type: 'number', step: 'any', required: '', inputmode: 'decimal',
    placeholder: '500', 'data-label': 'Price'});
  rule(control, value => {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 1 || amount > 100000) return 'Enter a price from ₹1 to ₹1,00,000.';
    return Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-6 ? 'Price can have at most 2 decimal places, for example 499.50.' : '';
  });
  return control;
};
const toPaise = control => Math.round(control.valueAsNumber * 100);

export function showAdmin(main, ctx, folderTarget = null) {
  main.append(...heading('Admin Workspace', 'Approve course payments, publish learning material, and support students from your phone.'));
  const analytics = el('div', {class: 'admin-analytics'});
  main.append(analytics);
  loadInto(analytics, ctx, async () => {
    const result = await api('/admin/analytics', {ctx, auth: true});
    analytics.replaceChildren(...[
      ['Students', result.students, 'profile', 'Active learners'],
      ['Courses', result.courses, 'courses', 'Published missions'],
      ['Purchases', result.purchases, 'missions', 'Approved access'],
      ['Revenue', `₹${(result.revenue / 100).toLocaleString('en-IN')}`, 'share', 'Total collected'],
      ['Tests / 24h', result.attempts24h, 'test', 'Recent submissions'],
      ['All Attempts', result.attempts, 'progress', 'Total submissions'],
    ].map(([label, value, glyph, hint]) => el('article', {class: `admin-stat stat-${glyph}`},
      el('span', {class: 'admin-stat-icon'}, icon(glyph, 'line-icon')),
      el('div', {class: 'admin-stat-copy'}, el('span', {}, label),
        el('strong', {}, String(value)), el('small', {}, hint)))));
  });
  const get = path => api(path, {ctx, auth: true});
  let manager;
  const publishes = /^\/admin\/(videos|physical-books|content\/|courses|seed-samples|timetable)/;
  const post = async (path, body) => {
    const result = await api(path, {ctx, auth: true, method: 'POST', ...body});
    if (publishes.test(path) && !path.endsWith('/videos/upload')) manager?.reload();
    return result;
  };
  const payments = el('div', {class: 'payment-requests admin-payment-grid'});
  const paymentRefresh = iconAction(button('', 'secondary icon-button refresh-action'), 'refresh', 'Refresh payment requests');
  const samples = button('Load Sample Missions', 'secondary');
  const sampleStatus = status();
  const content = el('div');
  const physicalBooks = el('div');
  const physicalOrders = el('div');
  const ebooks = el('div');
  const students = el('div');
  const videoCoursePlaceholder = el('select', {required: ''});
  const videoTitle = el('input', {required: '', maxlength: '120'});
  const videoDescription = el('textarea', {rows: '3', required: '', maxlength: '1000'});
  const videoUrl = rule(el('input', {type: 'url', required: '', placeholder: 'https://youtu.be/…'}), value =>
    youtubeId(value) ? '' : 'Enter a YouTube video link, for example https://youtu.be/VIDEO_ID.');
  const publishVideo = button('Publish Video', null, 'submit');
  const videoFeedback = status();
  const videoForm = el('form', {}, field('Course', videoCoursePlaceholder),
    field('Video Title', videoTitle), field('Description', videoDescription),
    field('YouTube URL', videoUrl), publishVideo, videoFeedback);
  bindForm(videoForm, publishVideo, videoFeedback, async () => {
    await post('/admin/videos', {json: {
      course: videoCoursePlaceholder.value, title: textValue(videoTitle, 'Video title'),
      description: textValue(videoDescription, 'Description'), url: textValue(videoUrl, 'YouTube URL'),
    }});
    videoForm.reset();
    say(videoFeedback, 'Video published in the YouTube library.');
  }, 'Publishing video…');
  const payeeName = el('input', {required: '', maxlength: '100', placeholder: 'Mission Selection'});
  const upiId = el('input', {maxlength: '120', autocomplete: 'off', placeholder: 'missionselection@upi'});
  const paymentMethod = el('select', {required: ''},
    el('option', {value: 'upi'}, 'UPI ID only'), el('option', {value: 'qr'}, 'QR code only'),
    el('option', {value: 'both'}, 'UPI ID and QR code'));
  rule(upiId, value => {
    if (!value) return paymentMethod.value === 'qr' ? '' : 'UPI ID is required when UPI checkout is enabled.';
    return /^[A-Za-z0-9._-]{2,80}@[A-Za-z0-9.-]{2,40}$/.test(value) ? '' : 'Enter a valid UPI ID, for example name@bank.';
  });
  paymentMethod.addEventListener('change', () => upiId.dispatchEvent(new Event('change')));
  const paymentQr = rule(el('input', {type: 'file', accept: 'image/png,image/jpeg,image/webp'}), (_, control) =>
    !control.files[0] || /^image\/(png|jpeg|webp)$/i.test(control.files[0].type) ? '' : 'Choose a PNG, JPEG, or WebP image.');
  const paymentQrPreview = el('img', {class: 'payment-qr-preview', alt: 'Current payment QR code', hidden: ''});
  const paymentQrStatus = el('p', {class: 'muted', role: 'status'});
  const savePayment = button('Save Payment Options', null, 'submit');
  const uploadQr = button('Upload QR Image', 'secondary');
  const paymentFeedback = status();
  const paymentForm = el('form', {}, field('Payment Method Shown to Students', paymentMethod),
    field('UPI Payee Name', payeeName), field('UPI ID', upiId),
    field('QR Image (optional unless QR is enabled)', paymentQr, 'Leave blank to keep the current QR image.'),
    paymentQrStatus, paymentQrPreview,
    el('div', {class: 'actions'}, uploadQr, savePayment), paymentFeedback);
  savePayment.type = 'submit';
  api('/admin/payment-settings', {ctx, auth: true}).then(values => {
    paymentMethod.value = values.method || 'upi';
    payeeName.value = values.payeeName || '';
    upiId.value = values.upiId || '';
    paymentQrStatus.textContent = values.customQr ? 'A payment QR image is currently configured.' : 'No custom payment QR image is configured.';
    paymentQrPreview.hidden = !values.customQr;
    if (values.customQr) paymentQrPreview.src = `/api/payment-qr?updated=${Date.now()}`;
  }).catch(error => { if (ctx.current()) say(paymentFeedback, error.message, true); });
  uploadQr.addEventListener('click', async () => {
    const file = paymentQr.files[0];
    if (!file) {
      fieldError(paymentQr, 'Choose a QR image to upload.');
      return paymentQr.focus();
    }
    if (!fieldError(paymentQr, paymentQr.validate('', paymentQr))) return paymentQr.focus();
    run(uploadQr, paymentFeedback, async () => {
      await api('/admin/payment-qr', {ctx, auth: true, method: 'POST', binary: file,
        imageUpload: file.type});
      paymentQrStatus.textContent = 'A payment QR image is currently configured.';
      paymentQrPreview.src = `/api/payment-qr?updated=${Date.now()}`;
      paymentQrPreview.hidden = false;
      say(paymentFeedback, 'QR image uploaded. Save the selected payment method to enable it.');
    }, 'Uploading QR image…');
  });
  bindForm(paymentForm, savePayment, paymentFeedback, async () => {
    await api('/admin/payment-settings', {ctx, auth: true, method: 'PUT', json: {
      method: paymentMethod.value, payeeName: payeeName.value.trim(), upiId: upiId.value.trim(),
    }});
    say(paymentFeedback, 'Student checkout payment options updated.');
  }, 'Saving payment options…');
  const youtube = httpsLink(el('input', {type: 'url', placeholder: 'https://youtube.com/@yourchannel'}));
  const instagram = httpsLink(el('input', {type: 'url', placeholder: 'https://instagram.com/yourpage'}));
  const telegram = httpsLink(el('input', {type: 'url', placeholder: 'https://t.me/yourcommunity'}));
  const socialSave = button('Save Social Links', null, 'submit');
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
  courseSelects.push(videoCoursePlaceholder);
  function courseField() {
    const select = el('select', {required: ''});
    courseSelects.push(select);
    return [select, field('Course', select)];
  }
  function setCourses(list) {
    for (const select of courseSelects) {
      const selected = select.value;
      select.replaceChildren(el('option', {value: ''}, list.length ? 'Choose a Course' : 'No Courses Available'),
        ...list.map(course => el('option', {value: course.id}, course.title)));
      if (list.some(course => String(course.id) === selected)) select.value = selected;
    }
    if (folderTarget && !freeTestMode) {
      const found = list.some(course => String(course.id) === folderTarget.courseId);
      testCourse.value = found ? folderTarget.courseId : '';
      publish.disabled = !found;
      say(testStatus, found ? '' : 'The selected course is unavailable. Return to the course workspace.', !found);
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
      const approve = button('Approve and Unlock');
      const reject = button('Reject', 'danger secondary');
      const rejection = el('textarea', {rows: '2', maxlength: '500', placeholder: 'Reason for rejection'});
      const feedback = status();
      approve.disabled = request.status !== 'pending';
      reject.disabled = request.status === 'rejected';
      reject.textContent = request.status === 'approved' ? 'Reject and Revoke Access' : 'Reject';
      approve.addEventListener('click', () => run(approve, feedback, async () => {
        await post(`/admin/payments/${idPart(request.id)}/approve`, {json: {}});
        say(feedback, `${request.course} is now unlocked for ${request.name}.`);
        setTimeout(loadPayments, 500);
      }, 'Approving…'));
      reject.addEventListener('click', () => run(reject, feedback, async () => {
        if (!rejection.value.trim()) {
          fieldError(rejection, 'Enter a rejection reason before rejecting this request.');
          rejection.focus();
          throw new Error('Enter a rejection reason.');
        }
        await post(`/admin/payments/${idPart(request.id)}/reject`, {json: {note: rejection.value.trim()}});
        say(feedback, 'Request rejected. The student can resubmit payment proof.');
        setTimeout(loadPayments, 500);
      }, 'Rejecting…'));
      const receipt = request.status === 'approved' && request.type === 'course' ?
        button('Download Receipt', 'secondary') : null;
      receipt?.addEventListener('click', () => run(receipt, feedback, async () => {
        const token = await ctx.user.getIdToken();
        const response = await fetch(`/api/admin/payments/${idPart(request.id)}/receipt.pdf`,
          {headers: {Authorization: ['Bearer', token].join(' ') }});
        if (!response.ok) throw new Error(`Could not download receipt (${response.status}).`);
        const url = URL.createObjectURL(await response.blob());
        const anchor = el('a', {href: url, download: `${request.course}-receipt.pdf`});
        document.body.append(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        say(feedback, 'Receipt downloaded.');
      }, 'Preparing receipt…'));
      const initials = request.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
      if (receipt) receipt.classList.add('payment-receipt-action');
      const requestDetails = el('div', {class: 'payment-request-content'},
        el('div', {class: 'payment-request-head'},
          el('div', {class: 'payment-request-identity'},
            el('span', {class: 'payment-request-avatar', 'aria-hidden': 'true'}, initials),
            el('div', {}, el('strong', {}, request.name), el('p', {class: 'muted'}, request.phone))),
          el('span', {class: `request-state ${request.status}`}, request.status)),
        el('div', {class: 'payment-request-course'},
          el('span', {class: 'badge'}, request.type === 'ebook' ? 'E-Book Payment' : 'Course Payment'),
          el('h3', {}, request.course),
          el('p', {class: 'price'}, new Intl.NumberFormat('en-IN',
            {style: 'currency', currency: 'INR'}).format(request.amount / 100))),
        el('dl', {class: 'payment-summary'}, el('dt', {}, 'UPI Reference'), el('dd', {}, request.reference),
          el('dt', {}, 'Submitted (IST)'), el('dd', {}, request.submittedAt ? formatDate(request.submittedAt) : 'Unavailable')),
        request.note ? el('p', {class: 'muted'}, request.note) : null,
        request.reviewNote ? el('p', {class: 'rejection'}, request.reviewNote) : null,
        request.status !== 'rejected' ? field(request.status === 'approved' ?
          'Revocation Reason' : 'Rejection Reason', rejection) : null,
        el('div', {class: 'actions'}, approve, reject, receipt), feedback);
      return el('details', {class: 'payment-request admin-course-payment'},
        el('summary', {class: 'manage-course-summary payment-course-summary'}, request.course),
        requestDetails);
    }) : [el('p', {class: 'empty'}, 'No payment requests yet.')]));
  });
  paymentRefresh.addEventListener('click', loadPayments);
  const ebookTitle = el('input', {required: '', maxlength: '120'});
  const ebookDescription = el('textarea', {rows: '3', required: '', maxlength: '2000'});
  const ebookPrice = rupeeInput();
  const ebookPdf = rule(el('input', {type: 'file', accept: pdfAccept, required: ''}), (_, control) =>
    /\.pdf$/i.test(control.files[0]?.name || '') ? '' : 'Choose a PDF e-book.');
  const ebookSubmit = button('Publish E-Book', null, 'submit');
  const ebookFeedback = status();
  const ebookForm = el('form', {}, field('E-Book Title', ebookTitle),
    field('Description', ebookDescription), field('Price (₹)', ebookPrice, PRICE_HINT),
    field('PDF File', ebookPdf, 'Upload the full paid book. After publishing, add a separate Demo PDF from the book list.'),
    ebookSubmit, ebookFeedback);
  const loadEbooks = (message = '') => loadInto(ebooks, ctx, async () => {
    const rows = await get('/admin/ebooks');
    ebooks.replaceChildren(...(rows.length ? rows.map(book => {
      const editTitle = el('input', {required: '', maxlength: '120', value: book.title});
      const editDescription = el('textarea', {rows: '3', required: '', maxlength: '2000'});
      editDescription.value = book.description;
      const editPrice = rupeeInput();
      editPrice.value = String(book.price / 100);
      const editPdf = rule(el('input', {type: 'file', accept: pdfAccept}), (_, control) => {
        const file = control.files[0];
        return file && (!/\.pdf$/i.test(file.name) || file.size > 12 * 1024 * 1024) ?
          'Choose a PDF no larger than 12 MB.' : '';
      });
      const editSubmit = button('Save E-Book Changes', null, 'submit');
      const editFeedback = status();
      const editForm = el('form', {}, field('E-Book Title', editTitle), field('Description', editDescription),
        field('Price (₹)', editPrice, PRICE_HINT),
        field('Replace Full PDF (optional)', editPdf,
          `Current full PDF: ${book.pages} pages. Leave blank to keep the existing file.`),
        editSubmit, editFeedback);
      bindForm(editForm, editSubmit, editFeedback, async () => {
        const values = {
          title: textValue(editTitle, 'E-book title'),
          description: textValue(editDescription, 'Description'),
          price: toPaise(editPrice),
        };
        let result;
        if (editPdf.files[0]) {
          const query = new URLSearchParams({...values, price: String(values.price)});
          result = await api(`/admin/ebooks/${idPart(book.id)}?${query}`, {
            ctx, auth: true, method: 'PUT', binary: editPdf.files[0],
          });
        } else {
          result = await api(`/admin/ebooks/${idPart(book.id)}`, {ctx, auth: true, method: 'PUT', json: values});
        }
        await loadEbooks(result?.warning || `E-book updated: ${values.title}.`);
      }, 'Saving e-book…');
      const remove = iconAction(button('', 'danger secondary'), 'trash', 'Delete e-book');
      remove.addEventListener('click', () => {
        if (!window.confirm(book.orders ?
          `Remove “${book.title}” from students? Access will end, but purchase records will be retained.` :
          `Permanently delete “${book.title}”?`)) return;
        run(remove, ebookFeedback, async () => {
          const result = await api(`/admin/ebooks/${idPart(book.id)}`, {ctx, auth: true, method: 'DELETE'});
          await loadEbooks(result.warning || (result.archived ? 'E-book hidden from students; purchase records retained.' : 'E-book deleted.'));
        }, 'Deleting e-book…');
      });
      const demoPdf = rule(el('input', {type: 'file', accept: pdfAccept, required: ''}), (_, control) => {
        const file = control.files[0];
        return !/\.pdf$/i.test(file?.name || '') || file.size > 12 * 1024 * 1024 ?
          'Choose a PDF no larger than 12 MB.' : '';
      });
      const demoUpload = button(book.demoPages ? 'Replace Demo' : 'Upload Demo', null, 'submit');
      const demoFeedback = status();
      const demoActions = el('div', {class: 'actions'}, demoUpload);
      const demoForm = el('form', {}, field('Demo PDF', demoPdf,
        'Separate sample PDF, up to 12 MB. Anyone can view it in the app without signing in. No PDF download is provided.'),
        demoActions, demoFeedback);
      bindForm(demoForm, demoUpload, demoFeedback, async () => {
        await api(`/admin/ebooks/${idPart(book.id)}/demo`, {ctx, auth: true, method: 'PUT', binary: demoPdf.files[0]});
        await loadEbooks(`Demo published for ${book.title}.`);
      }, 'Uploading demo…');
      if (book.demoPages) {
        const preview = el('a', {class: 'button secondary', href: `#ebook-demo/${idPart(book.id)}`}, 'Preview Demo');
        const removeDemo = iconAction(button('', 'danger secondary'), 'trash', 'Remove Demo');
        removeDemo.addEventListener('click', () => {
          if (!window.confirm(`Remove the demo for “${book.title}”? The paid book will not change.`)) return;
          run(removeDemo, demoFeedback, async () => {
            await api(`/admin/ebooks/${idPart(book.id)}/demo`, {ctx, auth: true, method: 'DELETE'});
            await loadEbooks(`Demo removed for ${book.title}.`);
          }, 'Removing demo…');
        });
        demoActions.append(preview, removeDemo);
      }
      const editDetails = el('details', {class: 'ebook-edit-editor'},
        el('summary', {}, 'Edit E-Book'), editForm);
      const bookDetails = el('div', {class: 'manage-item-body'},
        el('div', {class: 'manage-main'}, el('h3', {}, book.title),
          el('p', {class: 'muted'}, book.description),
          el('ul', {class: 'manage-details'}, [new Intl.NumberFormat('en-IN',
            {style: 'currency', currency: 'INR'}).format(book.price / 100),
          `${book.pages} pages`, `${book.orders || 0} purchase requests`].map(value => el('li', {}, value)))),
        el('div', {class: 'actions manage-actions'}, remove),
        editDetails,
        el('details', {class: 'ebook-demo-editor'},
          el('summary', {class: 'ebook-demo-summary'},
            book.demoPages ? `Demo PDF · ${book.demoPages} pages` : icon('plus', 'line-icon'),
            book.demoPages ? null : el('span', {}, 'Add a Demo PDF')),
          demoForm));
      return el('details', {class: 'manage-item ebook-manager-item'},
        el('summary', {class: 'manage-course-summary'}, book.title),
        bookDetails);
    }) : [el('p', {class: 'empty'}, 'No e-books published yet.')]));
    if (message) ebooks.prepend(el('p', {class: 'status', role: 'status'}, message));
  });
  bindForm(ebookForm, ebookSubmit, ebookFeedback, async () => {
    const file = ebookPdf.files[0];
    const query = new URLSearchParams({
      title: textValue(ebookTitle, 'E-book title'),
      description: textValue(ebookDescription, 'Description'),
      price: String(toPaise(ebookPrice)),
    });
    await api(`/admin/ebooks?${query}`, {ctx, auth: true, method: 'POST', binary: file});
    ebookForm.reset();
    say(ebookFeedback, 'E-book published in the student Book Store.');
    await loadEbooks();
  }, 'Uploading e-book…');
  samples.addEventListener('click', () => run(samples, sampleStatus, async () => {
    const result = await post('/admin/seed-samples', {json: {}});
    await refresh();
    say(sampleStatus, `${result.courses} sample missions are available in the catalog.`);
  }, 'Loading sample missions…'));

  const physicalTitle = el('input', {required: '', maxlength: '120'});
  const physicalDescription = el('textarea', {rows: '3', required: '', maxlength: '2000'});
  const physicalPrice = rupeeInput();
  const stock = el('input', {type: 'number', min: '0', max: '10000', step: '1', required: ''});
  const physicalActive = el('input', {type: 'checkbox'});
  physicalActive.checked = true;
  const physicalCovers = ctx.publishingMedia ? coverPicker(ctx) : null;
  const physicalSubmit = button('Publish Physical Book', null, 'submit');
  const physicalFeedback = status();
  const physicalForm = el('form', {}, field('Book Title', physicalTitle),
    field('Description', physicalDescription), field('Price (₹)', physicalPrice, PRICE_HINT),
    field('Stock', stock), el('label', {class: 'choice'}, physicalActive, 'Show this book in the store'), physicalCovers?.node,
    physicalSubmit, physicalFeedback);
  const loadPhysicalBooks = () => loadInto(physicalBooks, ctx, async () => {
    const rows = await get('/admin/physical-books');
    physicalBooks.replaceChildren(entries(rows, 'No physical books published.', item => [
      el('strong', {}, item.title), el('p', {class: 'muted'},
        `₹${(item.price / 100).toFixed(2)} · ${item.stock} in stock`),
    ]));
  });
  bindForm(physicalForm, physicalSubmit, physicalFeedback, async () => {
    const images = await physicalCovers?.upload();
    await post('/admin/physical-books', {json: {
      title: textValue(physicalTitle, 'Book title'), description: textValue(physicalDescription, 'Description'),
      price: toPaise(physicalPrice), stock: stock.valueAsNumber, active: physicalActive.checked, images,
    }});
    physicalForm.reset();
    physicalActive.checked = true;
    physicalCovers?.clear();
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
      for (const [nextStatus, label] of [['approved', 'Approve Payment'], ['shipped', 'Mark Shipped'], ['delivered', 'Delivered'], ['cancelled', 'Cancel']]) {
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
        field('Tracking Reference', tracking), field('Order Note', note), controls, feedback);
    }) : [el('p', {class: 'empty'}, 'No physical book orders yet.')]));
  });

  const day = el('select', {required: ''}, weekdays.map(value => el('option', {value}, value)));
  const scheduleTitle = el('input', {required: '', maxlength: '120'});
  const start = el('input', {type: 'time', required: ''});
  const duration = el('input', {required: '', maxlength: '30', placeholder: '60 minutes'});
  const scheduleDescription = el('textarea', {rows: '3', required: '', maxlength: '1000'});
  const scheduleSubmit = button('Publish Schedule', null, 'submit');
  const scheduleFeedback = status();
  const scheduleForm = el('form', {}, field('Day', day), field('Session Title', scheduleTitle),
    field('Start Time', start), field('Duration', duration), field('Description', scheduleDescription),
    scheduleSubmit, scheduleFeedback);
  bindForm(scheduleForm, scheduleSubmit, scheduleFeedback, async () => {
    await post('/admin/timetable', {json: {day: day.value, title: textValue(scheduleTitle, 'Session title'),
      startsAt: start.value, duration: textValue(duration, 'Duration'), description: textValue(scheduleDescription, 'Description')}});
    scheduleForm.reset();
    say(scheduleFeedback, 'Timetable session published.');
  }, 'Publishing schedule…');
  const loadStudents = () => loadInto(students, ctx, async () => {
    const rows = await get('/admin/students');
    students.replaceChildren(...(rows.length ? rows.map(student => {
      const disabled = Boolean(student.disabled);
      const action = button(disabled ? 'Reactivate Account' : 'Disable Account',
        disabled ? 'secondary student-action student-reactivate' : 'danger secondary student-action student-disable');
      action.prepend(icon(disabled ? 'account-reactivate' : 'account-disable', 'line-icon'));
      const feedback = status();
      action.addEventListener('click', () => run(action, feedback, async () => {
        await post(`/admin/students/${idPart(student.uid)}/status`, {json: {disabled: !disabled}});
        say(feedback, disabled ? 'Account reactivated.' : 'Account disabled.');
        setTimeout(loadStudents, 350);
      }, 'Updating account…'));
      return el('article', {class: 'student-control'},
        el('div', {class: 'student-control-details'}, el('strong', {}, student.name || 'Student'),
          el('span', {class: disabled ? 'student-state is-disabled' : 'student-state'}, disabled ? 'Disabled' : 'Active'),
          el('p', {class: 'muted'}, student.phone), el('code', {class: 'muted'}, student.uid)),
        action, feedback);
    }) : [el('p', {class: 'empty'}, 'No signed-in students yet.')]));
  });

  const title = el('input', {required: '', maxlength: '120'});
  const description = el('textarea', {rows: '3', required: '', maxlength: '2000'});
  const price = rupeeInput();
  const expiresOn = el('input', {type: 'date', required: ''});
  const downloadsEnabled = el('input', {type: 'checkbox'});
  const covers = ctx.publishingMedia ? coverPicker(ctx) : null;
  const create = button('Create Live Course', null, 'submit');
  const courseStatus = status();
  const createForm = el('form', {}, field('Course Title', title), field('Description', description),
    field('Price (₹)', price, PRICE_HINT),
    el('label', {class: 'choice'}, downloadsEnabled, 'Allow students to download course PDFs and chapter videos'),
    covers?.node,
    covers ? field('Course Expiry Date', expiresOn, 'Purchases and study access end at midnight India time after this date.') : null,
    create, courseStatus);
  bindForm(createForm, create, courseStatus, async () => {
    const images = await covers?.upload();
    await post('/admin/courses', {json: {title: textValue(title, 'Title'), description: textValue(description, 'Description'),
      price: toPaise(price), expiresOn: covers ? expiresOn.value : undefined, downloadsEnabled: downloadsEnabled.checked, images}});
    createForm.reset();
    covers?.clear();
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
  manager = publishedManager({ctx, rupeeInput, toPaise, questionData, priceHint: PRICE_HINT, courses: () => courseList,
    onChange: type => { if (type === 'courses') refresh().catch(() => {}); }});
  const paymentPanel = panel('Payment Approvals',
    el('div', {class: 'admin-payment-toolbar'},
      el('p', {class: 'muted payment-panel-description'},
        'Verify each UPI transaction in the receiving account before unlocking a student course.'),
      paymentRefresh),
    payments);
  paymentPanel.classList.add('admin-payment-panel');
  main.append(paymentPanel,
  panel('Quick Start', el('p', {class: 'muted'},
    'Add or refresh three ready-made missions with mock tests and protected starter books.'), samples, sampleStatus),
  panel('Create a Course', createForm), content,
  panel('Manage Published Content', el('p', {class: 'muted'},
    'See everything you have published with its date. Edit details or delete items students should no longer see.'), manager.node));
  loadPayments();
  loadEbooks();
  main.append(panel('Payment Information', el('p', {class: 'muted'},
    'Choose what students see at checkout. UPI and QR payment proofs still require admin approval.'), paymentForm),
    panel('Student Timetable', scheduleForm),
    panel('E-Books', ebookForm, ebooks),
    panel('Physical Books', physicalForm, physicalBooks),
    panel('Physical Book Orders', physicalOrders),
    panel('Student Accounts', students),
    panel('Social Media Links', socialForm),
    panel('YouTube Videos', videoForm));
  loadPhysicalBooks();
  loadPhysicalOrders();
  loadStudents();

  const example = JSON.stringify([{prompt: 'What is 2 + 2?', options: ['3', '4'], answer: 1}], null, 2);
  const creationMethod = el('select', {},
    el('option', {value: 'existing'}, 'Import File / Questions (JSON)'),
    el('option', {value: 'manual'}, 'Create Test Manually'),
    el('option', {value: 'sectionwise'}, 'Create Section-Wise Mock'));
  const manual = manualQuestions();
  const editor = el('textarea', {class: 'json', rows: '12', required: '', spellcheck: 'false', placeholder: example});
  const review = importQuestionReview(editor);
  const importFile = rule(el('input', {type: 'file', accept: '.pdf,.docx,.txt', required: ''}), (_, control) =>
    /\.(pdf|docx|txt)$/i.test(control.files[0]?.name || '') ? '' : 'Choose a PDF, DOCX, or TXT file.');
  const importButton = button('Import', 'secondary', 'submit');
  const importStatus = status();
  const importForm = el('form', {}, field('Question File', importFile, 'English or Gujarati PDF, DOCX, or TXT, up to 12 MB. Importing replaces the draft below.'),
    importButton, importStatus);
  importFile.addEventListener('change', () => {
    const file = importFile.files[0];
    say(importStatus, file ? `${file.name} selected. Choose Import to continue.` : '');
  });
  bindForm(importForm, importButton, importStatus, async () => {
    const file = importFile.files[0];
    const format = file?.name.split('.').pop().toLowerCase();
    if (!file || !['pdf', 'docx', 'txt'].includes(format)) throw new Error('Choose a PDF, DOCX, or TXT file.');
    const original = editor.value;
    const result = await post(`/admin/import?format=${format}`, {binary: file});
    if (!Array.isArray(result?.questions) || !result.questions.length) throw new Error('No questions were found. Try a different file or enter questions manually.');
    if (editor.value !== original) throw new Error('The JSON draft changed during import. Import again when you are ready to replace it.');
    editor.value = JSON.stringify(result.questions, null, 2);
    editor.dispatchEvent(new Event('input', {bubbles: true}));
    const pending = result.questions.filter(question => question.reviewIssues?.length).length;
    say(importStatus, `Imported ${result.questions.length} questions. ${pending ? `${pending} highlighted questions need review.` :
      'Review the questions below before publishing.'}`);
  }, 'Importing questions…');

  const subjectManager = subjectQuestionManager(editor, (file, format) =>
    post(`/admin/import?format=${format}`, {binary: file}));
  const [testCourse, testField] = courseField();
  let freeTestMode = false;
  if (folderTarget) testCourse.disabled = true;
  const testTitle = el('input', {required: '', maxlength: '120'});
  rule(editor, value => {
    try { questionData(value); return ''; } catch (error) { return error.message; }
  });
  const publish = button('Publish Test', 'publish-test-submit', 'submit');
  publish.prepend(icon('test', 'line-icon'));
  const testType = el('select', {required: ''},
    el('option', {value: 'mock'}, 'Mock Test — Unlimited Attempts'),
    el('option', {value: 'live'}, 'Live Test — Scheduled Window'));
  const startsAt = el('input', {type: 'datetime-local'});
  const expiresAt = el('input', {type: 'datetime-local'});
  const durationMinutes = el('input', {type: 'number', min: '10', max: '300', step: '5', value: '60'});
  const attemptsLimit = el('input', {type: 'number', min: '1', max: '10', step: '1', value: '2'});
  const questionPaperDownload = el('input', {type: 'checkbox'});
  const marksPerQuestion = el('input', {type: 'number', min: '0.25', max: '10', step: '0.25', value: '1'});
  const negativeMark = el('input', {type: 'number', min: '0', max: '5', step: '0.25', value: '0'});
  const sectionWiseSize = el('select', {},
    el('option', {value: '100'}, '100 questions · 100 marks'),
    el('option', {value: '200'}, '200 questions · 200 marks'));
  const sectionWiseSizeField = field('Section-Wise Mock Size', sectionWiseSize,
    'Upload questions separately for each subject. The combined test must contain exactly the selected number of questions, at 1 mark each.');
  sectionWiseSizeField.hidden = true;
  const liveFields = el('div', {class: 'live-test-fields', hidden: ''},
    field('Live Start Date and Time (IST)', startsAt), field('Attempts Allowed Until Expiry', attemptsLimit),
    field('Live Window Expiry Date and Time (IST)', expiresAt));
  const updateTestType = () => {
    const isLive = testType.value === 'live';
    liveFields.hidden = !isLive;
    startsAt.required = expiresAt.required = attemptsLimit.required = isLive;
  };
  const testTypeField = field('Test Type', testType,
    'Mock tests allow unlimited attempts. Attempt limits apply only to live tests.');
  testType.addEventListener('change', updateTestType);
  updateTestType();
  const jsonField = field('Questions (JSON)', editor,
    'Enter an array of objects with prompt, options, and answer. The first option is answer 0.');
  const importSection = el('section', {class: 'publish-test-import'},
    el('h3', {}, 'Import Questions (optional)'), importForm);
  const updateCreationMethod = () => {
    const isManual = creationMethod.value === 'manual';
    const isSectionWise = creationMethod.value === 'sectionwise';
    if (isSectionWise) testType.value = 'mock';
    testTypeField.hidden = isSectionWise;
    manual.node.hidden = manual.node.disabled = !isManual;
    review.node.hidden = review.node.disabled = isManual;
    jsonField.hidden = editor.disabled = isManual || isSectionWise;
    subjectManager.node.hidden = isManual;
    subjectManager.node.querySelectorAll('input, button').forEach(control => { control.disabled = isManual; });
    importSection.hidden = isManual || isSectionWise;
    importFile.disabled = importButton.disabled = isManual;
    sectionWiseSizeField.hidden = !isSectionWise;
    negativeMark.max = isSectionWise ? '1' : '5';
    updateTestType();
  };
  creationMethod.addEventListener('change', updateCreationMethod);
  updateCreationMethod();
  const testStatus = status();
  const testFields = el('fieldset', {class: 'upload-fields publish-test-fields'}, testField, field('Test Title', testTitle),
    testTypeField, liveFields,
    field('Duration (minutes)', durationMinutes, 'Used for every attempt.'),
    field('Marks Per Correct Answer', marksPerQuestion),
    field('Negative Mark Per Wrong Answer', negativeMark),
    el('label', {class: 'choice'}, questionPaperDownload, 'Enable Question Paper Download after first completed attempt'),
    sectionWiseSizeField, subjectManager.node, review.node, jsonField, manual.node);
  const testForm = el('form', {class: 'publish-test-form'}, testFields, publish, testStatus);
  bindForm(testForm, publish, testStatus, async () => {
    const sectionWise = creationMethod.value === 'sectionwise';
    const questions = questionData(creationMethod.value === 'manual' ? JSON.stringify(manual.values()) : editor.value);
    if (sectionWise && questions.length !== Number(sectionWiseSize.value)) {
      throw new Error(`This ${sectionWiseSize.value}-mark mock needs exactly ${sectionWiseSize.value} imported questions across its sections. Current total: ${questions.length}.`);
    }
    testFields.disabled = creationMethod.disabled = importButton.disabled = true;
    try {
      await post(freeTestMode ? '/admin/free-tests' : `/admin/courses/${idPart(testCourse.value)}/tests`, {json: {
        title: textValue(testTitle, 'Test title'), questions, live: !sectionWise && testType.value === 'live',
        ...(folderTarget && !freeTestMode ? {folderId: folderTarget.folderId} : {}),
        startsAt: !sectionWise && testType.value === 'live' ? startsAt.value : undefined,
        expiresAt: !sectionWise && testType.value === 'live' ? expiresAt.value : undefined,
        durationMinutes: durationMinutes.valueAsNumber,
        attemptsLimit: !sectionWise && testType.value === 'live' ? attemptsLimit.valueAsNumber : 0,
        questionPaperDownload: questionPaperDownload.checked,
        marksPerQuestion: sectionWise ? 1 : marksPerQuestion.valueAsNumber, negativeMark: negativeMark.valueAsNumber,
      }});
      testForm.reset();
      if (folderTarget && !freeTestMode) testCourse.value = folderTarget.courseId;
      manual.reset();
      review.reset();
      subjectManager.reset();
      updateTestType();
      if (freeTestMode) manager.reload();
      say(testStatus, 'Test published.');
    } finally {
      testFields.disabled = creationMethod.disabled = false;
      updateCreationMethod();
    }
  }, 'Publishing test…');
  const folderNotice = folderTarget ? el('p', {}, 'Publishing into the selected test folder. ',
    link('Return to Course Workspace', `#admin-course/${idPart(folderTarget.courseId)}`)) : null;
  const publishPanel = panel('Publish a Test',
    folderNotice,
    field('Test Creation Method', creationMethod), importSection,
    el('section', {class: 'publish-test-review'}, el('h3', {}, 'Review, Edit, and Publish'), testForm));
  publishPanel.classList.add('publish-test-panel');
  main.append(publishPanel);

  const [bookCourse, bookField] = courseField();
  const contentType = el('select', {required: ''},
    el('option', {value: 'pdf'}, 'PDF Study Book'), el('option', {value: 'video'}, 'Chapter Video'));
  const bookTitle = el('input', {required: '', maxlength: '120'});
  const subjectSelect = el('select', {required: '', disabled: ''});
  const chapterSelect = el('select', {required: '', disabled: ''});
  const subject = el('input', {required: '', maxlength: '100', placeholder: 'e.g. Mathematics'});
  const chapter = el('input', {required: '', maxlength: '120', placeholder: 'e.g. Chapter 4: Fractions'});
  const newSubject = field('New Subject Name', subject);
  const newChapter = field('New Chapter Name', chapter);
  newSubject.hidden = newChapter.hidden = true;
  const placementFeedback = status();
  const retryPlacement = button('Retry Loading Chapters', 'secondary');
  retryPlacement.hidden = true;
  const isVideo = () => contentType.value === 'video';
  const pdf = rule(el('input', {type: 'file', accept: pdfAccept, required: ''}), (_, control) => {
    const file = control.files[0];
    if (!isVideo()) return /\.pdf$/i.test(file?.name || '') ? '' : 'Choose a PDF file.';
    if (!videoType(file)) return 'Choose an MP4, WebM, or MOV video.';
    return file.size < 12 || file.size > maxVideoBytes ? 'Choose a non-empty video up to 300 MB.' : '';
  });
  const upload = button('Upload Book', null, 'submit');
  const bookStatus = status();
  const fileField = field('PDF File', pdf, 'PDF files are converted into protected, watermarked pages.');
  const fileHint = fileField.querySelector(`#${pdf.id}-hint`);
  const bookCovers = ctx.publishingMedia ? coverPicker(ctx) : null;
  contentType.addEventListener('change', () => {
    pdf.value = '';
    pdf.accept = isVideo() ? videoAccept : pdfAccept;
    pdf.dataset.label = isVideo() ? 'Video File' : 'PDF File';
    fileField.querySelector('label').textContent = pdf.dataset.label;
    fileHint.textContent = isVideo() ? 'MP4, WebM, or MOV, up to 300 MB. It will appear under the chosen chapter.' :
      'PDF files are converted into protected, watermarked pages.';
    upload.textContent = isVideo() ? 'Upload Video' : 'Upload Book';
    if (bookCovers) {
      bookCovers.node.hidden = isVideo();
      bookCovers.file.disabled = isVideo();
    }
    fieldError(pdf, '');
  });
  const addNew = '__add-new__';
  let items = [];
  let placementRequest = 0;
  function choose(select, label, entries, current = '') {
    const values = [...new Set(entries)].sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));
    select.replaceChildren(el('option', {value: ''}, `Choose ${label}`),
      ...values.map(value => el('option', {value: `existing:${value}`}, value)),
      el('option', {value: addNew}, `+ Add ${label}`));
    select.value = values.includes(current) ? `existing:${current}` : values.length ? '' : addNew;
  }
  const chosen = (select, input) => select.value === addNew ? input.value.trim() : select.value.slice('existing:'.length);
  const renderChapters = (current = '') => {
    newSubject.hidden = subjectSelect.disabled || subjectSelect.value !== addNew;
    chapterSelect.disabled = subjectSelect.disabled || !subjectSelect.value;
    choose(chapterSelect, 'a chapter', items.filter(item => item.subject === chosen(subjectSelect, subject))
      .map(item => item.chapter).filter(Boolean), current);
    newChapter.hidden = chapterSelect.disabled || chapterSelect.value !== addNew;
  };
  const loadPlacement = async (keep = {}) => {
    const courseId = bookCourse.value;
    const request = ++placementRequest;
    subjectSelect.disabled = true;
    upload.disabled = true;
    retryPlacement.hidden = true;
    items = [];
    choose(subjectSelect, 'a subject', []);
    renderChapters();
    say(placementFeedback, courseId ? 'Loading subjects and chapters…' : '');
    if (!courseId) return;
    try {
      const {books = [], videos = []} = await get(`/courses/${idPart(courseId)}`);
      if (request !== placementRequest) return;
      items = [...books, ...videos];
      subjectSelect.disabled = false;
      choose(subjectSelect, 'a subject', items.map(item => item.subject), keep.subject);
      renderChapters(keep.chapter);
      upload.disabled = false;
      say(placementFeedback, '');
    } catch (error) {
      if (request !== placementRequest || error.name === 'AbortError') return;
      say(placementFeedback, error.message, true);
      retryPlacement.hidden = false;
    }
  };
  upload.disabled = true;
  bookCourse.addEventListener('change', () => { subject.value = chapter.value = ''; loadPlacement(); });
  retryPlacement.addEventListener('click', () => loadPlacement());
  subjectSelect.addEventListener('change', () => { chapter.value = ''; renderChapters(); });
  chapterSelect.addEventListener('change', () => { newChapter.hidden = chapterSelect.value !== addNew; });
  const uploadFields = el('fieldset', {class: 'upload-fields'}, bookField,
    field('Subject', subjectSelect), newSubject,
    field('Chapter', chapterSelect, 'Select an existing chapter to add more files to it.'), newChapter,
    placementFeedback, retryPlacement, field('Content Type', contentType), field('Title', bookTitle), fileField, bookCovers?.node);
  const bookForm = el('form', {}, uploadFields, upload, bookStatus);
  bindForm(bookForm, upload, bookStatus, async () => {
    const file = pdf.files[0];
    const placement = {
      title: textValue(bookTitle, 'Title'),
      subject: chosen(subjectSelect, subject),
      chapter: chosen(chapterSelect, chapter),
    };
    const query = new URLSearchParams(placement);
    const courseId = idPart(bookCourse.value);
    const video = isVideo();
    uploadFields.disabled = true;
    try {
      if (video) {
        await uploadChapterVideo({ctx, post, coursePath: `/admin/courses/${courseId}`, placement, file,
          onPublish: () => say(bookStatus, 'Publishing video…')});
      } else {
        const images = await bookCovers?.upload();
        if (images) query.set('images', images.join(','));
        await post(`/admin/courses/${courseId}/books?${query}`, {binary: file});
      }
      bookTitle.value = pdf.value = '';
      bookCovers?.clear();
      await loadPlacement(placement);
      say(bookStatus, `${video ? 'Video' : 'PDF'} published to ${placement.subject} › ${placement.chapter}.`);
    } finally {
      uploadFields.disabled = false;
    }
  }, 'Uploading…');
  setCourses(courseList);
  const supportRefresh = iconAction(button('', 'secondary icon-button refresh-action'), 'refresh', 'Refresh support requests');
  const loadSupport = () => loadInto(inbox, ctx, async () => {
    const messages = await get('/admin/support');
    inbox.replaceChildren(entries(messages, 'No support requests have arrived yet.', item =>
      el('article', {class: 'support-ticket'},
        el('a', {href: `tel:${item.phone || ''}`, class: 'support-phone'}, item.phone || 'Student'),
        el('p', {class: 'entry-text'}, item.text))));
  });
  supportRefresh.addEventListener('click', loadSupport);
  main.append(panel('Upload a Study Book or Video', bookForm),
    panel('Publish Learning Resources', adminContentForm(post, () => refresh(), ctx)),
    panel('Support Inbox', supportRefresh, inbox));
  loadSupport();
  const panels = [...main.querySelectorAll(':scope > section.panel')];
  const sectionTitle = section => section.querySelector(':scope > h2')?.textContent || '';
  const findPanel = title => panels.find(section => sectionTitle(section) === title);
  const workspace = el('div', {class: 'admin-workspace'});
  const menu = el('div', {class: 'admin-area-grid'});
  const freeMaterials = freeMaterialsAdmin(ctx);
  const openList = ({label, managerType, list, add, addLabel, onOpen}) => {
    if (!list) return;
    const toolbar = el('div', {class: 'admin-section-toolbar'},
      el('button', {type: 'button', class: 'admin-back-button'}, '← All Areas'),
      el('h2', {}, label), el('div', {class: 'admin-section-actions'}));
    const actions = toolbar.querySelector('.admin-section-actions');
    toolbar.querySelector('.admin-back-button').addEventListener('click', showOverview);
    const search = el('input', {type: 'search', class: 'admin-list-filter', placeholder: 'Filter list…', hidden: ''});
    search.addEventListener('input', () => {
      const term = search.value.trim().toLowerCase();
      workspace.querySelectorAll('.manage-item, .payment-request, .student-control, .timetable-card, .entries > li').forEach(row => {
        row.hidden = Boolean(term) && !row.textContent.toLowerCase().includes(term);
      });
    });
    const filter = button('Filter', 'icon-button secondary');
    filter.setAttribute('aria-label', `Filter ${label}`);
    filter.title = 'Filter';
    filter.textContent = '⌕';
    filter.addEventListener('click', () => {
      search.hidden = !search.hidden;
      if (!search.hidden) search.focus();
    });
    actions.append(search, filter);
    if (add) {
      const plus = button('', 'icon-button admin-add');
      plus.prepend(icon('plus', 'line-icon'));
      plus.setAttribute('aria-label', addLabel || `Add ${label.toLowerCase()}`);
      plus.title = addLabel || 'Add item';
      plus.addEventListener('click', () => {
        add.hidden = false;
        add.classList.add('admin-open-form');
        workspace.replaceChildren(toolbar, list, add);
        add.scrollIntoView({behavior: 'smooth', block: 'start'});
      });
      actions.append(plus);
    }
    if (managerType) manager.select(managerType);
    list.hidden = false;
    workspace.replaceChildren(toolbar, list);
    onOpen?.();
    if (add) add.hidden = true;
  };
  const areas = [
    {label: 'Free Study Material', description: 'Publish free PDFs and manage downloads', icon: 'book-open',
      open: () => openList({label: 'Free Study Material', list: freeMaterials.list, add: freeMaterials.add,
        addLabel: 'Add Free Study Material', onOpen: freeMaterials.reload})},
    {label: 'Courses', description: 'Course list, price, expiry, and access', icon: 'course-stack',
      open: () => openList({label: 'Courses', managerType: 'courses', list: manager.node, add: findPanel('Create a Course'), addLabel: 'Add Course'})},
    {label: 'Mock Tests', description: 'Regular, timed, and live mock tests', icon: 'test',
      open: () => {
        freeTestMode = false;
        if (folderNotice) folderNotice.hidden = false;
        testField.hidden = false;
        testCourse.disabled = Boolean(folderTarget);
        if (folderTarget) setCourses(courseList);
        openList({label: 'Mock Tests', managerType: 'tests', list: manager.node, add: findPanel('Publish a Test'), addLabel: 'Add Mock Test'});
      }},
    {label: 'Free Test Series', description: 'Create and manage free tests', icon: 'test',
      open: () => {
        freeTestMode = true;
        if (folderNotice) folderNotice.hidden = true;
        publish.disabled = false;
        testField.hidden = true;
        testCourse.disabled = true;
        openList({label: 'Free Test Series', managerType: 'freeTests', list: manager.node,
          add: findPanel('Publish a Test'), addLabel: 'Add Free Test'});
      }},
    {label: 'Study Materials', description: 'Chapter PDFs and uploaded videos', icon: 'book-open',
      open: () => openList({label: 'Study Materials', managerType: 'books', list: manager.node, add: findPanel('Upload a Study Book or Video'), addLabel: 'Add Study Material'})},
    {label: 'Chapter Videos', description: 'Manage uploaded chapter videos', icon: 'play',
      open: () => openList({label: 'Chapter Videos', managerType: 'chapterVideos', list: manager.node, add: findPanel('Upload a Study Book or Video'), addLabel: 'Add Study Material'})},
    {label: 'YouTube Videos', description: 'Published learning video library', icon: 'play',
      open: () => openList({label: 'YouTube Videos', managerType: 'videos', list: manager.node, add: findPanel('YouTube Videos'), addLabel: 'Add YouTube Video'})},
    {label: 'Learning Resources', description: 'Current affairs, PYQs, syllabus, and free tests', icon: 'resource-globe',
      open: () => openList({label: 'Learning Resources', managerType: 'resources', list: manager.node, add: findPanel('Publish Learning Resources'), addLabel: 'Add Resource'})},
    {label: 'Course Payments', description: 'Approve or reject course payment requests', icon: 'wallet',
      open: () => openList({label: 'Course Payments', list: findPanel('Payment Approvals')})},
    {label: 'E-Books', description: 'Upload and price protected PDF books', icon: 'ebook',
      open: () => openList({label: 'E-Books', list: ebooks, add: findPanel('E-Books'), addLabel: 'Add E-Book'})},
    {label: 'Physical Books', description: 'Inventory and published book list', icon: 'book-stack',
      open: () => openList({label: 'Physical Books', managerType: 'physicalBooks', list: manager.node, add: findPanel('Physical Books'), addLabel: 'Add Physical Book'})},
    {label: 'Book Orders', description: 'Physical-book fulfillment and tracking', icon: 'package',
      open: () => openList({label: 'Book Orders', list: findPanel('Physical Book Orders')})},
    {label: 'Timetable', description: 'Published student timetable', icon: 'calendar-clock',
      open: () => openList({label: 'Timetable', managerType: 'schedules', list: manager.node, add: findPanel('Student Timetable'), addLabel: 'Add Timetable Session'})},
    {label: 'Students', description: 'Accounts, activation, and disabling', icon: 'students',
      open: () => openList({label: 'Students', list: findPanel('Student Accounts')})},
    {label: 'Support', description: 'Student help requests', icon: 'support',
      open: () => openList({label: 'Support', list: findPanel('Support Inbox'), onOpen: loadSupport})},
    {label: 'Payment Settings', description: 'UPI ID, QR image, and methods', icon: 'payment-settings',
      open: () => openList({label: 'Payment Settings', list: findPanel('Payment Information')})},
    {label: 'Social Links', description: 'YouTube, Instagram, and Telegram', icon: 'share',
      open: () => openList({label: 'Social Links', list: findPanel('Social Media Links')})},
  ];
  const showOverview = () => {
    const groups = [
      ['Learning', ['Courses', 'Mock Tests', 'Free Test Series', 'Study Materials', 'Free Study Material', 'Learning Resources']],
      ['Commerce', ['Course Payments', 'E-Books', 'Physical Books', 'Book Orders', 'Payment Settings']],
      ['Operations', ['YouTube Videos', 'Timetable', 'Students', 'Support', 'Social Links']],
    ];
    menu.replaceChildren(...groups.map(([label, names]) => el('section', {class: 'admin-area-group'},
      el('h2', {}, label),
      el('div', {class: 'admin-area-group-grid'}, ...areas.filter(area => names.includes(area.label)).map(area => {
      const card = el('button', {type: 'button', class: 'admin-area-card'},
        el('span', {class: 'admin-area-icon', 'aria-hidden': 'true'}, icon(area.icon, 'line-icon')),
        el('strong', {}, area.label), el('small', {}, area.description), el('span', {class: 'admin-area-arrow'}, '→'));
      card.addEventListener('click', area.open);
      return card;
      })))));
    workspace.replaceChildren(menu);
  };
  for (const section of panels) {
    section.hidden = true;
    section.classList.add('admin-page');
  }
  analytics.after(workspace);
  for (const panelNode of panels) panelNode.remove();
  if (folderTarget) {
    areas.find(area => area.label === 'Mock Tests').open();
    workspace.querySelector('.admin-add').click();
  } else showOverview();
}
