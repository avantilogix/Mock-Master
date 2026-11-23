import {coverGallery} from './publishing-media.js';
import {api} from './services.js';
import {button, el, empty, heading, idPart, link, loadInto, say, status} from './ui.js';

const protectedGet = (ctx, path, image = false) => api(path, {ctx, auth: true, image});

export function showTest(main, ctx, courseId, testId, phone) {
  const path = `/tests/${idPart(testId)}`;
  const content = el('div', {class: 'exam-shell'});
  const back = () => link('Back to Course', `#course/${idPart(courseId)}`, 'back');
  main.append(back(), ...heading('Exam Room'), content);
  loadInto(content, ctx, async () => {
    const test = await protectedGet(ctx, path);
    if (!test.questions.length) {
      main.replaceChildren(back(), ...heading(test.title), empty('This test has no questions yet.'));
      return;
    }
    const session = await api(`${path}/start`, {ctx, auth: true, method: 'POST'});
    let current = 0;
    const answers = test.questions.map((_, index) =>
      Number.isInteger(session.answers?.[index]) ? session.answers[index] : null);
    const marked = new Set((session.marked || []).filter(index => Number.isInteger(index)));
    const sections = [...new Set(test.questions.map(question => question.section || 'General'))];
    let submitted = false;
    const questionArea = el('div', {class: 'exam-question'});
    const palette = el('div', {class: 'question-palette'});
    const timer = el('strong', {class: 'exam-timer', role: 'timer'});
    const feedback = status();
    const previous = button('Previous', 'secondary');
    const next = button('Next', 'secondary');
    const mark = button('Mark for Review', 'secondary');
    const submit = button('Submit Exam');

    const save = () => api(`${path}/progress`, {
      ctx, auth: true, method: 'PUT', json: {answers, marked: [...marked]},
    }).catch(() => {});
    const scoreState = index => {
      if (answers[index] === null) return marked.has(index) ? 'marked' : 'unanswered';
      return marked.has(index) ? 'answered-marked' : 'answered';
    };
    const renderPalette = () => {
      palette.replaceChildren(...test.questions.map((question, index) => {
        const tile = button(String(index + 1), `question-tile ${scoreState(index)}`);
        tile.setAttribute('aria-label', `Question ${index + 1}, ${scoreState(index).replace('-', ' ')}`);
        tile.addEventListener('click', () => { current = index; renderQuestion(); });
        return tile;
      }));
    };
    const renderQuestion = () => {
      const question = test.questions[current];
      const sectionIndex = sections.indexOf(question.section || 'General') + 1;
      questionArea.replaceChildren(
        el('div', {class: 'exam-question-head'},
          el('span', {class: 'badge'}, `${question.section || 'General'} · ${sectionIndex}/${sections.length}`),
          el('span', {class: 'muted'}, `Question ${current + 1} of ${test.questions.length}`)),
        el('h2', {}, question.prompt),
        ...question.options.map((option, index) => {
          const input = el('input', {type: 'radio', name: `question-${current}`, value: index});
          input.checked = answers[current] === index;
          input.addEventListener('change', () => { answers[current] = index; renderPalette(); save(); });
          return el('label', {class: 'exam-option'}, input, el('span', {}, `${String.fromCharCode(65 + index)}. ${option}`));
        }));
      previous.disabled = current === 0;
      next.disabled = current === test.questions.length - 1;
      mark.textContent = marked.has(current) ? 'Unmark Review' : 'Mark for Review';
      renderPalette();
      questionArea.querySelector('input:checked, input')?.focus();
    };
    previous.addEventListener('click', () => { if (current > 0) { current--; renderQuestion(); } });
    next.addEventListener('click', () => { if (current < test.questions.length - 1) { current++; renderQuestion(); } });
    mark.addEventListener('click', () => {
      marked.has(current) ? marked.delete(current) : marked.add(current);
      renderQuestion(); save();
    });
    const deadline = Date.parse(session.startedAt) + (test.durationMinutes || 90) * 60_000;
    let timerId;
    const finish = async () => {
      if (submitted) return;
      submitted = true;
      submit.disabled = true;
      clearInterval(timerId);
      try {
        const result = await api(`${path}/submit`, {ctx, auth: true, method: 'POST', json: {answers}});
        const resultTitle = el('h2', {tabindex: '-1'}, 'Your Result');
        const sectionResults = el('div', {class: 'section-results'},
          ...(result.sectionScores || []).map(section => el('article', {},
            el('strong', {}, section.section), el('span', {}, `${section.score}/${section.total}`),
            el('small', {}, `${section.correct} correct · ${section.wrong} wrong · ${section.unanswered} unattempted`))));
        content.replaceChildren(el('section', {class: 'exam-result'},
          resultTitle, el('div', {class: 'result-score'}, el('strong', {}, `${result.score}`),
            el('span', {}, ` / ${result.maxMarks || result.total}`)),
          el('div', {class: 'result-stats'},
            el('span', {}, `Correct ${result.correct ?? result.score}`),
            el('span', {}, `Wrong ${result.wrong ?? 0}`),
            el('span', {}, `Unattempted ${result.unanswered ?? 0}`)),
          sectionResults, button('Return to Course', 'secondary')));
        content.querySelector('.button, button').addEventListener('click', () => { location.hash = `#course/${idPart(courseId)}`; });
        resultTitle.focus();
      } catch (error) {
        submitted = false;
        submit.disabled = false;
        say(feedback, error.message, true);
      }
    };
    submit.addEventListener('click', () => {
      if (window.confirm('Submit this attempt? You cannot change answers after submission.')) finish();
    });
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      timer.textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
      timer.classList.toggle('danger', remaining <= 300);
      if (!remaining) finish();
    };
    ctx.signal.addEventListener('abort', () => clearInterval(timerId), {once: true});
    timerId = setInterval(tick, 1000);
    tick();
    main.replaceChildren(back(), ...heading(test.title, test.live ?
      `Live attempt ${test.attempts + 1}${test.limited ? ` of ${test.attemptsLimit}` : ' · unlimited window'}` :
      'Practice attempt'), content);
    content.replaceChildren(el('div', {class: 'exam-topbar'},
      el('span', {}, `${test.marksPerQuestion || 1} mark(s) per question${test.negativeMark ? ` · −${test.negativeMark} for wrong answer` : ''}`),
      timer),
      el('div', {class: 'exam-layout'}, questionArea,
        el('aside', {class: 'exam-sidebar'}, el('h3', {}, 'Question Navigator'), palette,
          el('div', {class: 'palette-legend'}, el('span', {}, 'Answered'), el('span', {}, 'Marked'), el('span', {}, 'Unanswered')))),
      el('div', {class: 'exam-actions'}, previous, mark, next, submit), feedback);
    renderQuestion();
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
    main.replaceChildren(back(), ...heading(video.title, `${video.subject} · ${video.chapter}`), content);
    content.replaceChildren(el('section', {class: 'panel'},
      el('video', {class: 'chapter-video', src: url, controls: '', controlslist: 'nodownload',
        preload: 'metadata', playsinline: '', 'aria-label': video.title})));
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
    const revoke = () => { if (objectUrl) URL.revokeObjectURL(objectUrl); objectUrl = null; };
    ctx.signal.addEventListener('abort', revoke, {once: true});
    content.replaceChildren(el('nav', {class: 'actions reader-controls', 'aria-label': 'Book pages'},
      prev, counter, next), imageArea);
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
          const image = el('img', {class: 'book-page protected-reader', src: objectUrl,
            alt: `${book.title}, page ${number}`});
          await image.decode();
          if (ctx.current()) imageArea.replaceChildren(image);
        } catch (error) {
          revoke();
          throw error;
        } finally { loading = false; }
      });
    }
    prev.addEventListener('click', () => { if (!loading && page > 1) { page--; showPage(prev); } });
    next.addEventListener('click', () => { if (!loading && page < book.pages) { page++; showPage(next); } });
    showPage();
  });
}
