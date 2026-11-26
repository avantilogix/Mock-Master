import {priceText, upiReference} from './course.js?v=ist-payment-fixes-final';
import {api} from './services.js?v=ist-payment-fixes-final';
import {saveControl} from './saved-content.js';
import {bindForm, button, el, field, heading, icon, idPart, link, loadInto, run, say, status, textValue} from './ui.js';

export function showEbookStore(main, ctx, action) {
  main.append(...heading('E-Book Store', 'Buy protected digital books. Access and download unlock after admin payment approval.'));
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
    if (order?.status === 'rejected') {
      target.replaceChildren(el('div', {class: 'payment-status rejected', role: 'alert'},
        el('h2', {}, 'Payment Not Approved'),
        el('p', {}, order.reviewNote || 'The admin rejected this request. Review the payment and submit again.'),
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
    const methods = payment.method === 'both' ? ['upi', 'qr'] : [payment.method];
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
  main.append(...heading('E-Book'), el('div'));
  loadInto(main, ctx, async () => {
    const books = await api('/ebooks', {ctx});
    const book = books.find(item => String(item.id) === bookId);
    if (!book) throw new Error('E-book not found.');
    const orders = ctx.user ? await api('/ebook-orders', {ctx, auth: true}) : [];
    const order = orders.find(item => item.ebook === book.id);
    main.replaceChildren(...heading(book.title, book.description));
    if (!ctx.user) {
      main.append(action.signInLink('Sign In to Purchase'));
      return;
    }
    if (order?.status !== 'approved') {
      const panel = el('section', {class: 'panel'});
      main.append(panel);
      paymentPanel(panel, ctx, book, action);
      return;
    }
    pdfReader(main, ctx, {...book, pagePath: `/ebooks/${idPart(book.id)}/pages`,
      savedItem: {type: 'ebook', id: String(book.id), title: book.title, pages: book.pages,
        pagePath: `/ebooks/${idPart(book.id)}/pages`}});
  });
}

export function showEbookDemo(main, ctx, bookId) {
  const content = el('div');
  main.append(link('Back to E-Book Store', '#book-store', 'back'), content);
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
  const counter = status();
  counter.classList.add('pdf-reader-counter');
  const previous = button('', 'secondary pdf-reader-page-button');
  previous.setAttribute('aria-label', 'Previous page');
  previous.title = 'Previous page';
  previous.prepend(icon('back', 'line-icon'));
  const next = button('', 'secondary pdf-reader-page-button pdf-reader-next');
  next.setAttribute('aria-label', 'Next page');
  next.title = 'Next page';
  next.prepend(icon('arrow-right', 'line-icon'));
  const controls = el('div', {class: 'actions reader-controls pdf-reader-controls'}, counter, previous, next);
  let saveAction = null;
  if (book.savedItem) {
    saveAction = saveControl(ctx, book.savedItem);
    const saveButton = saveAction.querySelector('button');
    if (saveButton) {
      saveButton.textContent = '';
      saveButton.setAttribute('aria-label', 'Save to Downloads');
      saveButton.title = 'Save to Downloads';
      saveButton.prepend(icon('download', 'line-icon'));
    }
    saveAction.querySelector('a')?.remove();
    if (book.readerTools && saveButton) {
      saveButton.classList.add('pdf-reader-save-top');
      saveAction.classList.add('pdf-reader-save-action-top');
    } else {
      controls.append(saveAction);
    }
  }
  const imageArea = el('div', {class: 'pdf-reader-pages', role: 'region', 'aria-label': `${book.title} PDF pages`},
    pageNodes);
  if (book.readerTools) {
    const pageInput = el('input', {type: 'number', min: '1', max: String(book.pages), value: '1',
      inputmode: 'numeric', 'aria-label': 'Go to page'});
    const go = button('', 'secondary pdf-reader-go');
    go.setAttribute('aria-label', 'Go to page');
    go.title = 'Go to page';
    go.prepend(icon('arrow-right', 'line-icon'));
    const zoomOut = button('', 'secondary pdf-reader-zoom-button');
    zoomOut.prepend(icon('minus', 'line-icon'));
    zoomOut.setAttribute('aria-label', 'Zoom out');
    zoomOut.title = 'Zoom out';
    const zoomIn = button('', 'secondary pdf-reader-zoom-button');
    zoomIn.prepend(icon('plus', 'line-icon'));
    zoomIn.setAttribute('aria-label', 'Zoom in');
    zoomIn.title = 'Zoom in';
    const zoomLabel = el('span', {class: 'pdf-reader-zoom-label', role: 'status'}, '100%');
    let zoom = 100;
    const updateZoom = () => {
      imageArea.style.width = `${zoom}%`;
      zoomLabel.textContent = `${zoom}%`;
      zoomOut.disabled = zoom === 100;
      zoomIn.disabled = zoom === 200;
    };
    zoomOut.addEventListener('click', () => { zoom = Math.max(100, zoom - 25); updateZoom(); });
    zoomIn.addEventListener('click', () => { zoom = Math.min(200, zoom + 25); updateZoom(); });
    const pageTools = el('div', {class: 'pdf-reader-page-tools'}, field('Page', pageInput), go);
    const zoomControls = el('div', {class: 'pdf-reader-zoom-controls'},
      zoomOut, zoomLabel, zoomIn);
    const zoomTools = el('div', {class: 'pdf-reader-zoom-tools'},
      el('span', {class: 'pdf-reader-tool-label'}, 'Zoom'), zoomControls);
    const tools = el('div', {class: 'pdf-reader-tools'}, pageTools, zoomTools);
    go.addEventListener('click', () => {
      const selected = pageInput.valueAsNumber;
      if (!Number.isInteger(selected) || selected < 1 || selected > book.pages) {
        say(counter, `Enter a page from 1 to ${book.pages}.`, true);
        pageInput.focus();
        return;
      }
      scrollToPage(selected);
    });
    pageInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); go.click(); }
    });
    updateZoom();
    if (book.readerTools) {
      main.append(el('div', {class: 'pdf-reader-topbar'}, saveAction || el('span')));
    } else {
      main.append(controls, tools);
      if (book.savedItem) main.append(el('p', {class: 'muted pdf-reader-note'},
        icon('info', 'line-icon'), 'Saved content is available inside this app while access remains active.'));
    }
    main.append(el('div', {class: 'pdf-reader-scroll'}, imageArea));
  } else main.append(controls, imageArea);
  const placeholder = pageNumber => el('div', {class: 'pdf-page-placeholder', 'aria-hidden': 'true'},
    `Page ${pageNumber} · loading as you read`);
  const setPage = pageNumber => {
    page = Math.max(1, Math.min(book.pages, pageNumber));
    say(counter, `Page ${page} of ${book.pages}`);
    previous.disabled = page === 1;
    next.disabled = page === book.pages;
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
        el('span', {}, `Could not load page ${pageNumber}: ${error.message}`), retry));
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
  const scrollToPage = pageNumber => {
    const target = Math.max(1, Math.min(book.pages, pageNumber));
    pageNodes[target - 1]?.scrollIntoView({behavior: 'smooth', block: 'start'});
    if (!observer) {
      setPage(target);
      loadPage(target);
    }
  };
  previous.addEventListener('click', () => scrollToPage(page - 1));
  next.addEventListener('click', () => scrollToPage(page + 1));
  ctx.signal.addEventListener('abort', () => {
    observer?.disconnect();
    for (const objectUrl of objectUrls.values()) URL.revokeObjectURL(objectUrl);
    objectUrls.clear();
  }, {once: true});
  setPage(1);
  if (!observer) loadPage(1);
}
