import {coverGallery} from './publishing-media.js';
import {api} from './services.js';
import {bindForm, button, el, empty, heading, idPart, link, loadInto, say, status} from './ui.js';

const protectedGet = (ctx, path, image = false) => api(path, {ctx, auth: true, image});

export function showTest(main, ctx, courseId, testId, phone) {
  const path = `/tests/${idPart(testId)}`;
  const content = el('div', {class: 'narrow'});
  const back = () => link('Back to Course', `#course/${idPart(courseId)}`, 'back');
  main.append(back(), ...heading('Practice Test'), content);
  loadInto(content, ctx, async () => {
    const {title, questions} = await protectedGet(ctx, path);
    if (!questions.length) {
      main.replaceChildren(back(), ...heading(title), empty('This test has no questions yet.'));
      return;
    }
    const submit = button('Submit Answers', null, 'submit');
    const feedback = status();
    const watermark = () => phone ? el('p', {class: 'watermark', 'aria-hidden': 'true'}, `Verified mobile · ${phone}`) : null;
    const form = el('form', {},
      phone ? el('p', {class: 'test-identity'}, `Verified mobile: ${phone}`) : null,
      el('p', {class: 'lead'}, 'Choose one answer per question. You can leave questions unanswered.'),
      questions.map((question, index) => el('fieldset', {class: 'panel'},
        el('legend', {}, `${index + 1}. ${question.prompt}`),
        question.options.map((option, choice) => el('label', {class: 'choice'},
          el('input', {type: 'radio', name: `question-${index}`, value: choice}), option)), watermark())),
      submit, feedback);
    bindForm(form, submit, feedback, async () => {
      const selections = new FormData(form);
      const answers = questions.map((_, index) => {
        const value = selections.get(`question-${index}`);
        return value === null ? null : Number(value);
      });
      const result = await api(`${path}/submit`, {ctx, auth: true, method: 'POST', json: {answers}});
      const resultTitle = el('h2', {tabindex: '-1'}, 'Test Result');
      const retry = button('Practice Again', 'secondary');
      retry.addEventListener('click', () => {
        form.reset();
        say(feedback, '');
        content.replaceChildren(form);
        form.querySelector('input')?.focus();
      });
      content.replaceChildren(el('section', {class: 'panel'}, resultTitle,
        el('p', {class: 'price'}, `${result.score} out of ${result.total}`), retry, watermark()));
      resultTitle.focus();
    }, 'Scoring your answers…');
    main.replaceChildren(back(), ...heading(title), content);
    content.replaceChildren(form);
  });
}

export function showVideo(main, ctx, courseId, videoId) {
  const back = () => link('Back to Study Materials', '#materials', 'back');
  const content = el('div');
  main.append(back(), ...heading('Chapter Video'), content);
  loadInto(content, ctx, async () => {
    const {videos = []} = await protectedGet(ctx, `/courses/${idPart(courseId)}`);
    const video = videos.find(item => String(item.id) === videoId);
    if (!video) throw new Error('This video is not available in the course.');
    const {url} = await protectedGet(ctx, `/videos/${idPart(videoId)}/link`);
    if (!ctx.current()) return;
    main.replaceChildren(back(), ...heading(video.title, `${video.subject} · ${video.chapter}`), content);
    content.replaceChildren(el('section', {class: 'panel'},
      el('video', {class: 'chapter-video', src: url, controls: '', controlslist: 'nodownload', preload: 'metadata',
        playsinline: '', 'aria-label': video.title})));
  });
}

export function showBook(main, ctx, courseId, bookId) {
  const back = () => link('Back to Course', `#course/${idPart(courseId)}`, 'back');
  const content = el('div');
  main.append(back(), ...heading('Study Book'), content);
  loadInto(content, ctx, async () => {
    const {books} = await protectedGet(ctx, `/courses/${idPart(courseId)}`);
    const book = books.find(item => String(item.id) === bookId);
    if (!book) throw new Error('This book is not available in the course.');
    const gallery = coverGallery(book, 'reader-gallery');
    main.replaceChildren(back(), ...heading(book.title), ...(gallery ? [gallery] : []), content);
    if (!Number.isSafeInteger(book.pages) || book.pages < 1) {
      content.replaceChildren(empty('This book has no pages to display.'));
      return;
    }
    let page = 1;
    let objectUrl;
    let loading = false;
    const imageArea = el('div', {class: 'panel'});
    const counter = status();
    const prev = button('Previous Page', 'secondary');
    const next = button('Next Page', 'secondary');
    const revoke = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null;
    };
    ctx.signal.addEventListener('abort', revoke, {once: true});
    const controls = el('nav', {class: 'actions reader-controls', 'aria-label': 'Book pages'}, prev, counter, next);
    content.replaceChildren(controls, imageArea);

    function showPage(focusControl) {
      revoke();
      const number = page;
      say(counter, `Page ${number} of ${book.pages}`);
      prev.setAttribute('aria-disabled', String(number === 1));
      next.setAttribute('aria-disabled', String(number === book.pages));
      focusControl?.focus();
      loadInto(imageArea, ctx, async () => {
        loading = true;
        try {
          const blob = await protectedGet(ctx, `/books/${idPart(bookId)}/pages/${number}`, true);
          objectUrl = URL.createObjectURL(blob);
          const image = el('img', {class: 'book-page', src: objectUrl, alt: `${book.title}, page ${number}`});
          try { await image.decode(); } catch { throw new Error('This page image could not be displayed.'); }
          if (ctx.current()) imageArea.replaceChildren(image);
        } catch (error) {
          revoke();
          throw error;
        } finally {
          loading = false;
        }
      });
    }
    prev.addEventListener('click', () => { if (!loading && page > 1) { page--; showPage(prev); } });
    next.addEventListener('click', () => { if (!loading && page < book.pages) { page++; showPage(next); } });
    showPage();
  });
}
