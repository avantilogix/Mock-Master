import {priceText, upiReference} from './course.js?v=merge-resolved-v1';
import {api} from './services.js?v=ist-payment-fixes-final';
import {saveControl} from './saved-content.js?v=merge-resolved-v1';
import {backLink, bindForm, button, createPaymentDialog, el, field, heading, icon, idPart, link, loadInto, run, say, status, textValue} from './ui.js?v=merge-resolved-v1';

export function showEbookStore(main, ctx, action) {
  main.append(...heading('E-book store', 'Buy protected digital books. Access and download unlock after admin payment approval.'));
  const content = el('div', {class: 'grid ebook-grid'});
  main.append(content);
  loadInto(content, ctx, async () => {
    const [books, orders] = await Promise.all([
      api('/ebooks', {ctx}),
      ctx.user ? api('/ebook-orders', {ctx, auth: true}) : Promise.resolve([]),
    ]);
    const states = new Map(orders.map(order => [order.ebook, order]));
    if (!books.length) {
      content.replaceChildren(el('div', {class: 'empty-library'}, el('h2', {}, 'No E-Books Published Yet'),
        el('p', {class: 'muted'}, 'New protected digital books will appear here.')));
      return;
    }
    content.replaceChildren(...books.map(book => {
      const order = states.get(book.id);
      const owned = order?.status === 'approved';
      const rejected = order?.status === 'rejected';
      return el('article', {class: 'panel ebook-card'},
        el('div', {class: 'ebook-cover', 'aria-hidden': 'true'},
          el('span', {}, 'E-BOOK'), el('strong', {}, book.title)),
        el('div', {class: 'ebook-copy'}, owned ? el('span', {class: 'badge'}, 'Purchased') : null,
          el('h2', {}, book.title), el('p', {class: 'muted'}, book.description),
          rejected ? el('div', {class: 'rejection', role: 'alert'},
            el('strong', {}, 'Payment Not Approved'),
            el('p', {}, order.reviewNote || 'Please resubmit correct payment details.')) : null,
          el('small', {}, `${book.pages} protected pages`),
          el('div', {class: 'card-footer'},
            owned ? el('span', {class: 'muted'}, 'Approved') : el('strong', {class: 'price'}, priceText(book.price)),
            el('div', {class: 'actions ebook-actions'},
              owned ? link('Open E-Book', `#ebook/${idPart(book.id)}`, 'button') :
                ctx.user ? link(order?.status === 'pending' ? 'View Payment Status' :
                  rejected ? 'Resubmit Payment' : 'Buy E-Book',
                  `#ebook/${idPart(book.id)}`, 'button') : action.signInLink('Sign In to Buy'),
              book.demoPages > 0 ? link('Demo', `#ebook-demo/${idPart(book.id)}`, 'button secondary') : null))));
    }));
  });
}

function paymentPanel(target, ctx, book, action) {
  loadInto(target, ctx, async () => {
    const {payment, order, amount} = await api(`/ebooks/${idPart(book.id)}/payment`, {ctx, auth: true});
    if (order?.status === 'approved') {
      target.replaceChildren(el('div', {class: 'payment-status'},
        el('h2', {}, 'E-Book Unlocked'), el('p', {}, 'Your payment has been approved. Open the reader below.'),
        link('Read E-Book', `#ebook/${idPart(book.id)}`, 'button')));
      return;
    }
    if (order?.status === 'pending') {
      target.replaceChildren(el('div', {class: 'payment-status pending'},
        el('span', {class: 'status-icon'}, '◷'), el('h2', {}, 'Payment Under Review'),
        el('p', {}, 'The admin is verifying your UPI transaction. Your e-book will unlock after approval.'),
        el('dl', {class: 'payment-summary'}, el('dt', {}, 'Amount'), el('dd', {}, priceText(amount)),
          el('dt', {}, 'Reference'), el('dd', {}, order.reference))));
      return;
    }
    if (!payment.configured) {
      target.replaceChildren(el('div', {class: 'payment-status'},
        el('h2', {}, 'Payment Is Being Configured'), link('Contact Support', '#support', 'button secondary')));
      return;
    }
    const reference = upiReference(el('input', {required: '', maxlength: '80', autocomplete: 'off',
      placeholder: 'UPI transaction reference'}));
    const note = el('textarea', {rows: '2', maxlength: '500', placeholder: 'Optional payment note'});
    const submit = button('Submit for Admin Approval', null, 'submit');
    const feedback = status();
    const form = el('form', {}, field('UPI Transaction Reference', reference),
      field('Payment Note (optional)', note), submit, feedback);
    bindForm(form, submit, feedback, async () => {
      await api(`/ebooks/${idPart(book.id)}/payment`, {ctx, auth: true, method: 'POST',
        json: {reference: textValue(reference, 'UPI transaction reference'), note: note.value.trim()}});
      say(feedback, 'Payment submitted for admin approval.');
      paymentPanel(target, ctx, book, action);
    }, 'Submitting payment…');
    const methodButtons = el('div', {class: 'payment-methods', role: 'group', 'aria-label': 'Choose payment method'});
    const methodPanel = el('div');
    const methods = [];
    if (payment.configured) {
      if (payment.method !== 'qr' && payment.upiId) methods.push('upi');
      if (payment.method === 'qr' || payment.upiId || payment.customQr) methods.push('qr');
    }
    const renderMethod = method => {
      methodButtons.querySelectorAll('button').forEach(button =>
        button.setAttribute('aria-pressed', String(button.dataset.method === method)));
      methodPanel.replaceChildren(method === 'upi' ?
        el('div', {class: 'upi-details'}, el('span', {}, 'UPI ID'),
          el('strong', {}, payment.upiId), el('small', {}, `Payee: ${payment.payeeName}`)) :
        el('div', {class: 'qr-card'}, el('img', {src: payment.qr, alt: 'E-Book payment QR code'}),
          el('strong', {}, payment.payeeName || 'Mission Selection'),
          el('small', {}, payment.customQr ? 'Scan using any UPI application' : payment.upiId)));
    };
    methods.forEach(method => {
      const control = button(method === 'upi' ? 'Pay by UPI ID' : 'Scan QR Code', 'secondary');
      control.dataset.method = method;
      control.addEventListener('click', () => renderMethod(method));
      methodButtons.append(control);
    });
    target.replaceChildren(el('section', {class: 'manual-payment ebook-payment'},
      el('div', {class: 'payment-steps'}, el('span', {}, '1'),
        el('div', {}, el('h2', {}, `Pay ${priceText(amount)}`),
          el('p', {class: 'muted'}, `Send payment to ${payment.payeeName}.`))),
      el('div', {class: 'payment-choice'}, methodButtons, methodPanel),
      el('div', {class: 'payment-form-panel'}, el('span', {}, '2'),
        el('div', {}, el('h3', {}, 'Submit Payment Proof'), form)),
      order?.status === 'rejected' ? el('div', {class: 'rejection'},
        el('strong', {}, 'Payment Not Approved'), el('p', {}, order.reviewNote || 'Please submit correct payment details.')) : null));
    renderMethod(methods[0]);
  });
}

export function showEbook(main, ctx, bookId, action) {
  const content = el('div');
  const [title] = heading('E-book');
  main.append(title, content);
  loadInto(content, ctx, async () => {
    const books = await api('/ebooks', {ctx});
    const book = books.find(item => String(item.id) === bookId);
    if (!book) throw new Error('E-book not found.');
    const orders = ctx.user ? await api('/ebook-orders', {ctx, auth: true}) : [];
    const order = orders.find(item => item.ebook === book.id);
    title.textContent = book.title;
    content.replaceChildren(...(book.description ? [el('p', {class: 'lead'}, book.description)] : []));
    if (!ctx.user) {
      content.append(action.signInLink('Sign In to Purchase'));
      return;
    }
    if (order?.status !== 'approved') {
      const {dialog, target} = createPaymentDialog();
      const openPayment = button(order?.status === 'pending' ? 'View Payment Status' : 'Continue to Payment',
        'button ebook-payment-launch');
      openPayment.addEventListener('click', () => {
        target.replaceChildren();
        paymentPanel(target, ctx, book, action);
        if (!dialog.open) dialog.showModal();
      });
      content.append(el('section', {class: 'panel ebook-payment-launch-card'},
        el('h2', {}, order?.status === 'pending' ? 'Payment Under Review' : 'Purchase This E-Book'),
        el('p', {class: 'muted'}, order?.status === 'pending' ?
          'Check your payment status or review the submitted transaction.' :
          `Continue to payment options for ${book.title}.`),
        openPayment), dialog);
      openPayment.click();
      return;
    }
    pdfReader(content, ctx, {...book, pagePath: `/ebooks/${idPart(book.id)}/pages`,
      savedItem: {type: 'ebook', id: String(book.id), title: book.title, pages: book.pages,
        pagePath: `/ebooks/${idPart(book.id)}/pages`}});
  });
}

export function showEbookDemo(main, ctx, bookId) {
  const content = el('div');
  main.append(backLink('Back to E-Book Store', '#book-store'), content);
  loadInto(content, ctx, async () => {
    const book = await api(`/ebooks/${idPart(bookId)}/demo`, {ctx});
    content.replaceChildren(el('span', {class: 'badge'}, 'Free Demo'),
      ...heading(`${book.title} — Demo`, 'Sample pages only. The full e-book requires approved purchase.'),
      link('View Full E-Book', `#ebook/${idPart(book.id)}`, 'button secondary'));
    pdfReader(content, ctx, {...book, title: `${book.title} demo`, pagePath: `/ebooks/${idPart(book.id)}/demo/pages`, auth: false});
  });
}

export function pdfReader(main, ctx, book) {
  main.classList.add('pdf-reader');
  let page = 1;
  const objectUrls = new Map();
  const loadingPages = new Set();
  const visiblePages = new Set();
  const pageNodes = Array.from({length: book.pages}, (_, index) =>
    el('article', {class: 'pdf-page-shell', 'data-page': String(index + 1),
      'aria-label': `Page ${index + 1} of ${book.pages}`}));
  const saveAction = book.savedItem ? saveControl(ctx, book.savedItem) : null;
  if (saveAction) {
    saveAction.classList.add('pdf-reader-save-action-top');
    const saveButton = saveAction.querySelector('button');
    if (saveButton) saveButton.classList.add('pdf-reader-save-top');
  }
  const imageArea = el('div', {class: 'pdf-reader-pages', role: 'region', 'aria-label': `${book.title} PDF pages`},
    pageNodes);
  if (saveAction) main.append(el('div', {class: 'pdf-reader-topbar'}, saveAction));
  main.append(el('div', {class: 'pdf-reader-scroll'}, imageArea));
  const placeholder = pageNumber => el('div', {class: 'pdf-page-placeholder', 'aria-hidden': 'true'},
    `Page ${pageNumber} · loading as you read`);
  const setPage = pageNumber => {
    page = Math.max(1, Math.min(book.pages, pageNumber));
  };
  const loadPage = async pageNumber => {
    const node = pageNodes[pageNumber - 1];
    if (!node || objectUrls.has(pageNumber) || loadingPages.has(pageNumber)) return;
    loadingPages.add(pageNumber);
    node.replaceChildren(placeholder(pageNumber));
    try {
      const blob = book.getPage ? await book.getPage(pageNumber) :
        await api(`${book.pagePath}/${pageNumber}`, {ctx, auth: book.auth !== false, image: true});
      if (!ctx.current()) return;
      const objectUrl = URL.createObjectURL(blob);
      objectUrls.set(pageNumber, objectUrl);
      node.replaceChildren(el('img', {class: 'book-page protected-reader', src: objectUrl,
        alt: `${book.title}, page ${pageNumber}`, draggable: 'false', decoding: 'async'}));
    } catch (error) {
      if (error.name === 'AbortError' || !ctx.current()) return;
      const retry = button('Retry page', 'secondary');
      retry.addEventListener('click', () => loadPage(pageNumber));
      node.replaceChildren(el('div', {class: 'pdf-page-error', role: 'alert'},
        el('span', {}, `Could not load page ${pageNumber}. Please check your connection and try again.`), retry));
    } finally {
      loadingPages.delete(pageNumber);
    }
  };
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      const pageNumber = Number(entry.target.dataset.page);
      if (entry.isIntersecting) visiblePages.add(pageNumber);
      else visiblePages.delete(pageNumber);
    }
    const visible = entries.filter(entry => entry.isIntersecting)
      .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
    if (visible) setPage(Number(visible.target.dataset.page));
    const nearby = new Set([...visiblePages].flatMap(number =>
      [number - 1, number, number + 1].filter(value => value > 0 && value <= book.pages)));
    for (const pageNumber of nearby) loadPage(pageNumber);
    for (const [pageNumber, objectUrl] of objectUrls) {
      if (Math.abs(pageNumber - page) > 3 && !visiblePages.has(pageNumber)) {
        URL.revokeObjectURL(objectUrl);
        objectUrls.delete(pageNumber);
        pageNodes[pageNumber - 1].replaceChildren(placeholder(pageNumber));
      }
    }
  }, {rootMargin: '900px 0px'}) : null;
  for (const pageNode of pageNodes) {
    observer?.observe(pageNode);
    pageNode.append(placeholder(Number(pageNode.dataset.page)));
  }
  ctx.signal.addEventListener('abort', () => {
    main.classList.remove('pdf-reader');
    observer?.disconnect();
    for (const objectUrl of objectUrls.values()) URL.revokeObjectURL(objectUrl);
    objectUrls.clear();
  }, {once: true});
  setPage(1);
  if (!observer) {
    for (let pageNumber = 1; pageNumber <= book.pages; pageNumber++) loadPage(pageNumber);
  }
}
