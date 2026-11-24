import {priceText, upiReference} from './course.js?v=ist-payment-fixes-final';
import {api} from './services.js?v=ist-payment-fixes-final';
import {bindForm, button, el, field, heading, idPart, link, loadInto, run, say, status, textValue} from './ui.js';

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
            owned ? link('Open E-Book', `#ebook/${idPart(book.id)}`, 'button') :
              ctx.user ? link(order?.status === 'pending' ? 'View Payment Status' :
                rejected ? 'Resubmit Payment' : 'Buy E-Book',
                `#ebook/${idPart(book.id)}`, 'button') : action.signInLink('Sign In to Buy'))));
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
    let page = 1;
    let objectUrl;
    const imageArea = el('div', {class: 'panel'});
    const counter = status();
    const previous = button('Previous Page', 'secondary');
    const next = button('Next Page', 'secondary');
    const download = button('Download Protected PDF');
    const controls = el('div', {class: 'actions reader-controls'}, previous, counter, next, download);
    main.append(controls, imageArea);
    const render = () => loadInto(imageArea, ctx, async () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      const blob = await api(`/ebooks/${idPart(book.id)}/pages/${page}`, {ctx, auth: true, image: true});
      objectUrl = URL.createObjectURL(blob);
      const image = el('img', {class: 'book-page protected-reader', src: objectUrl,
        alt: `${book.title}, page ${page}`});
      imageArea.replaceChildren(image);
      say(counter, `Page ${page} of ${book.pages}`);
      previous.disabled = page === 1;
      next.disabled = page === book.pages;
    });
    previous.addEventListener('click', () => { if (page > 1) { page--; render(); } });
    next.addEventListener('click', () => { if (page < book.pages) { page++; render(); } });
    download.addEventListener('click', () => {
      buttonDownload(ctx, book, download, counter);
    });
    ctx.signal.addEventListener('abort', () => { if (objectUrl) URL.revokeObjectURL(objectUrl); }, {once: true});
    render();
  });
}

async function buttonDownload(ctx, book, control, feedback) {
  await run(control, feedback, async () => {
    const blob = await api(`/ebooks/${idPart(book.id)}/download`, {ctx, auth: true, blob: true});
    const filename = `${book.title.replace(/[^\\w .-]+/g, '_')}-protected.pdf`;
    if (window.MissionSelectionDownloads?.beginPdf) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (!window.MissionSelectionDownloads.beginPdf(filename)) {
        throw new Error('The protected PDF could not be started. Check device storage access.');
      }
      try {
        for (let index = 0; index < bytes.length; index += 24576) {
          let binary = '';
          const chunk = bytes.subarray(index, index + 24576);
          for (const value of chunk) binary += String.fromCharCode(value);
          if (!window.MissionSelectionDownloads.appendPdf(btoa(binary))) {
            throw new Error('The protected PDF could not be written completely.');
          }
        }
        if (!window.MissionSelectionDownloads.finishPdf(true)) {
          throw new Error('The protected PDF could not be finalized.');
        }
      } catch (error) {
        window.MissionSelectionDownloads.finishPdf(false);
        throw error;
      }
      say(feedback, 'Protected PDF saved to Downloads.');
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = el('a', {href: url, download: filename});
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(feedback, 'Protected PDF downloaded.');
  }, 'Preparing protected PDF…');
}
