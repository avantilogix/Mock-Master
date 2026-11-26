import {coverGallery} from './publishing-media.js';
import {api} from './services.js';
import {pdfReader} from './ebooks.js?v=pdf-reader-minimal-v2';
import {saveContent, saveControl} from './saved-content.js?v=merge-resolved-v1';
import {backLink, button, el, empty, heading, icon, idPart, link, loadInto, run, say, status} from './ui.js?v=merge-resolved-v1';

const protectedGet = (ctx, path, image = false) => api(path, {ctx, auth: true, image});

export function showTest(main, ctx, courseId, testId, phone) {
  const path = `/tests/${idPart(testId)}`;
  const content = el('div', {class: 'exam-shell'});
  const isCurrentAffairs = courseId === 'current-affairs';
  const isFreeTest = courseId === 'free-tests';
  const backTarget = isFreeTest ? '#free-tests' : isCurrentAffairs ? '#current-affairs' : `#course/${idPart(courseId)}`;
  const back = () => backLink(isFreeTest ? 'Back to Free Test Series' :
    isCurrentAffairs ? 'Back to Current Affairs' : 'Back to Course', backTarget);
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
    const guardKey = `mission-exam-visibility-${session.id}`;
    let visibilityState = {switches: 0, pending: false};
    try {
      const saved = sessionStorage.getItem(guardKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!Number.isInteger(parsed.switches) || parsed.switches < 0 || typeof parsed.pending !== 'boolean' ||
            (parsed.pending && (!Array.isArray(parsed.answers) || parsed.answers.length !== answers.length))) {
          throw new Error('Invalid saved exam visibility state.');
        }
        visibilityState = parsed;
        if (parsed.pending) answers.splice(0, answers.length, ...parsed.answers);
      }
    } catch (error) {
      console.error('Could not restore exam visibility state:', error);
      throw new Error('Could not restore this test safely. Check browser storage and try again.');
    }
    const persistVisibility = () => {
      try {
        sessionStorage.setItem(guardKey, JSON.stringify(visibilityState));
        return true;
      } catch (error) {
        console.error('Could not save exam visibility state:', error);
        say(feedback, 'Could not save the test warning. Keep this page open and check browser storage.', true);
        return false;
      }
    };
    const subjectTabs = el('div', {
      class: 'exam-subject-tabs', role: 'tablist', 'aria-label': 'Subject sections',
    });
    const marksPerQuestion = test.marksPerQuestion || 1;
    const markText = value => `${value} ${Number(value) === 1 ? 'mark' : 'marks'}`;
    const scoringInfo = el('div', {class: 'exam-scoring'},
      el('span', {class: 'score-chip score-correct'},
        el('span', {}, 'Correct answer'), el('strong', {}, `+${markText(marksPerQuestion)}`)),
      test.negativeMark ?
        el('span', {class: 'score-chip score-penalty'},
          el('span', {}, 'Wrong answer'), el('strong', {}, `−${markText(test.negativeMark)}`)) :
        el('span', {class: 'score-chip score-neutral'},
          el('span', {}, 'Wrong answer'), el('strong', {}, 'No penalty')));
    let submitted = false;
    let finished = false;
    const questionArea = el('div', {class: 'exam-question'});
    questionArea.id = 'exam-question-panel';
    const palette = el('div', {class: 'question-palette'});
    const paletteHeading = el('h3', {}, 'Question Navigator');
    const counters = el('div', {class: 'exam-counters'});
    const timer = el('strong', {class: 'exam-timer', role: 'timer'});
    const feedback = status();
    const switchWarning = el('p', {class: 'exam-switch-warning', role: 'alert', hidden: ''});
    const retrySubmission = button('Retry Submission', 'secondary');
    retrySubmission.hidden = true;
    const previous = button('← Previous', 'secondary exam-nav-button exam-prev-button');
    const next = button('Next →', 'exam-nav-button exam-next-button');
    previous.setAttribute('aria-label', 'Previous question');
    previous.title = 'Previous question';
    next.setAttribute('aria-label', 'Next question');
    next.title = 'Next question';
    const mark = button('Mark for Review', 'secondary exam-mark-button');
    const submit = button('Submit Exam', 'exam-submit-button');

    const save = () => api(`${path}/progress`, {
      ctx, auth: true, method: 'PUT', json: {answers, marked: [...marked]},
    }).catch(() => {});
    const scoreState = index => {
      if (answers[index] === null) return marked.has(index) ? 'marked' : 'unanswered';
      return marked.has(index) ? 'answered-marked' : 'answered';
    };
    const renderPalette = () => {
      const activeSection = test.questions[current].section || 'General';
      const sectionIndices = test.questions.reduce((indices, question, index) => {
        if ((question.section || 'General') === activeSection) indices.push(index);
        return indices;
      }, []);
      const answered = sectionIndices.filter(index => answers[index] !== null).length;
      const markedInSection = sectionIndices.filter(index => marked.has(index)).length;
      paletteHeading.textContent = `Question Navigator — ${activeSection}`;
      counters.replaceChildren(
        el('span', {class: 'counter-answered'}, el('strong', {}, String(answered)), ' Answered'),
        el('span', {class: 'counter-marked'}, el('strong', {}, String(markedInSection)), ' Marked'),
        el('span', {class: 'counter-unanswered'},
          el('strong', {}, String(sectionIndices.length - answered)), ' Unanswered'));
      palette.replaceChildren(...sectionIndices.map((index, sectionQuestion) => {
        const questionNumber = test.questions[index].questionNumber ?? String(sectionQuestion + 1);
        const tile = button(String(questionNumber), `question-tile ${scoreState(index)}`);
        tile.setAttribute('aria-label',
          `${activeSection} question ${questionNumber}, overall question ${index + 1}, ${scoreState(index).replace('-', ' ')}`);
        tile.title = `${activeSection} question ${questionNumber} · Overall question ${index + 1}`;
        if (index === current) tile.setAttribute('aria-current', 'step');
        tile.addEventListener('click', () => { current = index; renderQuestion(); });
        return tile;
      }));
    };
    const renderSubjectTabs = () => {
      const activeSection = test.questions[current].section || 'General';
      subjectTabs.replaceChildren(...sections.map((section, index) => {
        const tab = button('', 'exam-subject-tab');
        const questionCount = test.questions.filter(question => (question.section || 'General') === section).length;
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', String(section === activeSection));
        tab.setAttribute('aria-controls', questionArea.id);
        tab.setAttribute('tabindex', section === activeSection ? '0' : '-1');
        tab.replaceChildren(el('span', {}, section),
          el('small', {}, `${questionCount} ${questionCount === 1 ? 'question' : 'questions'}`));
        const selectSection = focusTab => {
          current = test.questions.findIndex(question => (question.section || 'General') === section);
          renderQuestion();
          if (focusTab) subjectTabs.querySelectorAll('[role="tab"]')[index]?.focus();
        };
        tab.addEventListener('click', () => selectSection(false));
        tab.addEventListener('keydown', event => {
          let nextIndex = index;
          if (event.key === 'ArrowRight') nextIndex = (index + 1) % sections.length;
          else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + sections.length) % sections.length;
          else if (event.key === 'Home') nextIndex = 0;
          else if (event.key === 'End') nextIndex = sections.length - 1;
          else return;
          event.preventDefault();
          const nextSection = sections[nextIndex];
          current = test.questions.findIndex(question => (question.section || 'General') === nextSection);
          renderQuestion();
          subjectTabs.querySelectorAll('[role="tab"]')[nextIndex]?.focus();
        });
        return tab;
      }));
    };
    const renderQuestion = () => {
      const question = test.questions[current];
      questionArea.replaceChildren(
        el('div', {class: 'exam-question-head'},
          el('span', {class: 'badge'}, question.section || 'General'),
          el('span', {class: 'muted'}, question.questionNumber === undefined ?
            `Question ${current + 1} of ${test.questions.length}` :
            `PDF question ${question.questionNumber} · ${current + 1} of ${test.questions.length}`)),
        el('h2', {}, question.prompt),
        ...question.options.map((option, index) => {
          const input = el('input', {type: 'radio', name: `question-${current}`, value: index});
          input.checked = answers[current] === index;
          input.addEventListener('change', () => { answers[current] = index; renderPalette(); save(); });
          return el('label', {class: 'exam-option'}, input,
            el('span', {class: 'option-letter'}, String.fromCharCode(65 + index)),
            el('span', {class: 'option-text'}, option));
        }));
      previous.disabled = current === 0;
      next.disabled = current === test.questions.length - 1;
      mark.textContent = marked.has(current) ? 'Unmark Review' : 'Mark for Review';
      mark.classList.toggle('is-marked', marked.has(current));
      renderSubjectTabs();
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
    let releaseNavigation = () => {};
    const finish = async () => {
      if (submitted) return;
      submitted = true;
      submit.disabled = true;
      retrySubmission.hidden = true;
      clearInterval(timerId);
      try {
        const result = await api(`${path}/submit`, {ctx, auth: true, method: 'POST', json: {answers}});
        finished = true;
        releaseNavigation();
        try { sessionStorage.removeItem(guardKey); }
        catch (error) { console.error('Could not clear exam visibility state:', error); }
        const resultTitle = el('h2', {tabindex: '-1'}, 'Your Result');
        const score = Number(result.score) || 0;
        const maxMarks = Number(result.maxMarks || result.total) || 0;
        const scoreProgress = maxMarks > 0 ? Math.max(0, Math.min(1, score / maxMarks)) : 0;
        const scoreCircle = el('div', {
          class: 'result-score',
          role: 'img',
          'aria-label': `Score ${score} out of ${maxMarks} marks`,
        }, el('strong', {}, String(result.score)), el('span', {}, `/ ${maxMarks}`));
        scoreCircle.style.setProperty('--score-progress', `${scoreProgress * 100}%`);
        const sectionResults = el('div', {class: 'section-results'},
          ...(result.sectionScores || []).map(section => el('article', {},
            el('strong', {}, section.section), el('span', {}, `${section.score}/${section.total}`),
            el('small', {}, `${section.correct} correct · ${section.wrong} incorrect · ${section.unanswered} unattempted`))));
        const resultAction = (label, iconName, className, href) => {
          const control = href ? link('', href, className) : button('', className);
          control.replaceChildren(icon(iconName, 'line-icon'), el('span', {}, label));
          return control;
        };
        const returnButton = resultAction(isFreeTest ? 'Return to Free Test Series' : isCurrentAffairs ? 'Return to Current Affairs' : 'Return to Course',
          'back', 'result-action-back');
        const resultButton = result.attemptId ?
          resultAction('Download Result PDF', 'download', 'secondary result-action-download') : null;
        const paperButton = result.questionPaperDownload ?
          resultAction('Download Question Paper', 'files', 'secondary result-action-paper') : null;
        const leaderboardButton = test.live ?
          resultAction('View Leaderboard', 'progress', 'button secondary result-action-leaderboard',
            `#leaderboard/${idPart(courseId)}/${idPart(testId)}`) : null;
        const resultActions = el('div', {class: 'result-actions'},
          returnButton, resultButton, paperButton, leaderboardButton);
        content.replaceChildren(el('section', {class: 'exam-result'},
          resultTitle, visibilityState.pending ?
            el('p', {role: 'status'}, 'Your test was submitted automatically after a second tab or app switch.') : null, scoreCircle,
          el('div', {class: 'result-stats'},
            el('span', {class: 'result-stat-correct'}, el('strong', {}, String(result.correct ?? result.score)), el('small', {}, 'Correct')),
            el('span', {class: 'result-stat-incorrect'}, el('strong', {}, String(result.wrong ?? 0)), el('small', {}, 'Incorrect')),
            el('span', {class: 'result-stat-unattempted'}, el('strong', {}, String(result.unanswered ?? 0)), el('small', {}, 'Unattempted'))),
          sectionResults,
          test.live && Date.now() < Date.parse(test.expiresAt) ?
            el('p', {class: 'leaderboard-locked'}, `Leaderboard unlocks ${new Date(test.expiresAt).toLocaleString('en-IN', {
              timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short'
            })} IST.`) : null,
          resultActions, feedback));
        returnButton.addEventListener('click', () => {
          location.hash = backTarget;
        });
        if (resultButton) {
          resultButton.addEventListener('click', () => run(resultButton, feedback, async () => {
              const blob = await api(`/attempts/${result.attemptId}/result.pdf`, {ctx, auth: true, blob: true});
              try {
                await saveContent(ctx, {
                  type: 'test-result-pdf', id: `result-${result.attemptId}`,
                  title: `${test.title} - Result`, parts: 1,
                  downloadPath: `/attempts/${result.attemptId}/result.pdf`,
                  validatePath: `/attempts/${result.attemptId}/result.pdf`,
                });
              } catch (error) {
                if (!/already saved/i.test(error.message)) throw error;
              }
              const url = URL.createObjectURL(blob);
              const anchor = el('a', {href: url, download: `${test.title}-result.pdf`});
              document.body.append(anchor); anchor.click(); anchor.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }, 'Preparing result PDF…'));
        }
        if (paperButton) {
          paperButton.addEventListener('click', () => run(paperButton, feedback, async () => {
              const blob = await api(`${path}/question-paper.pdf`, {ctx, auth: true, blob: true});
              try {
                await saveContent(ctx, {
                  type: 'test-pdf', id: `paper-${testId}`,
                  title: `${test.title} - Question Paper`, parts: 1,
                  downloadPath: `${path}/question-paper.pdf`,
                  validatePath: `${path}/question-paper.pdf`,
                });
              } catch (error) {
                if (!/already saved/i.test(error.message)) throw error;
              }
              const url = URL.createObjectURL(blob);
              const anchor = el('a', {href: url, download: `${test.title}-question-paper.pdf`});
              document.body.append(anchor); anchor.click(); anchor.remove();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
              say(feedback, 'Question paper downloaded.');
            }, 'Preparing question paper…'));
        }
        resultTitle.focus();
      } catch (error) {
        submitted = false;
        if (visibilityState.pending) {
          retrySubmission.hidden = false;
          say(feedback, `Automatic submission failed: ${error.message} Retry submission before leaving.`, true);
        } else {
          submit.disabled = false;
          say(feedback, error.message, true);
          if (Date.now() < deadline) {
            timerId = setInterval(tick, 1000);
            tick();
          }
        }
      }

    };
    retrySubmission.addEventListener('click', finish);
    submit.addEventListener('click', () => {
      if (window.confirm('Submit this attempt? You cannot change answers after submission.')) finish();
    });
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      timer.textContent = `${String(Math.floor(remaining / 60)).padStart(2, '0')}:${String(remaining % 60).padStart(2, '0')}`;
      timer.classList.toggle('danger', remaining <= 300);
      if (!remaining) finish();
    };
    const lockForSubmission = () => {
      questionArea.querySelectorAll('input').forEach(input => { input.disabled = true; });
      subjectTabs.querySelectorAll('button').forEach(control => { control.disabled = true; });
      palette.querySelectorAll('button').forEach(control => { control.disabled = true; });
      previous.disabled = next.disabled = mark.disabled = submit.disabled = true;
    };
    let lastVisibility = document.visibilityState;
    const onVisibilityChange = () => {
      if (finished) return;
      if (document.visibilityState === lastVisibility) return;
      lastVisibility = document.visibilityState;
      if (document.visibilityState === 'hidden') {
        if (submitted || visibilityState.pending) return;
        visibilityState.switches++;
        if (visibilityState.switches >= 2) {
          visibilityState.pending = true;
          visibilityState.answers = [...answers];
          persistVisibility();
          lockForSubmission();
          switchWarning.hidden = false;
          switchWarning.textContent = 'A second tab or app switch was detected. Submitting your test…';
          finish();
        } else {
          persistVisibility();
          switchWarning.hidden = false;
          switchWarning.textContent = 'Tab or app switching is not allowed. A second switch will submit your test automatically.';
        }
      } else if (visibilityState.pending && !submitted) {
        finish();
      }
    };
    const beforeUnload = event => {
      if (!finished) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const onConnectionChange = event => {
      if (event.detail.connected && visibilityState.pending && !finished && !submitted) finish();
    };
    releaseNavigation = ctx.guardExamNavigation(() => {
      if (submitted || visibilityState.pending) {
        say(feedback, 'Your test must finish submitting before you leave.', true);
      } else if (window.confirm('Submit this test before leaving? Your answers cannot be changed after submission.')) {
        finish();
      }
    });
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('mission-connection-change', onConnectionChange);
    ctx.signal.addEventListener('abort', () => {
      clearInterval(timerId);
      releaseNavigation();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('mission-connection-change', onConnectionChange);
    }, {once: true});
    main.replaceChildren(back(), ...heading(test.title, test.live ?
      `Live attempt ${test.attempts + 1}${test.limited ? ` of ${test.attemptsLimit}` : ' · unlimited window'}` :
      'Practice attempt · unlimited'), content);
    content.replaceChildren(switchWarning, subjectTabs, el('div', {class: 'exam-topbar'},
      scoringInfo, timer),
      el('div', {class: 'exam-layout'}, questionArea,
        el('aside', {class: 'exam-sidebar'}, paletteHeading, counters, palette)),
      el('div', {class: 'exam-actions'}, previous, next, mark, submit, retrySubmission), feedback);
    renderQuestion();
    if (visibilityState.pending) {
      switchWarning.hidden = false;
      switchWarning.textContent = 'A second tab or app switch was detected. Submitting your test…';
      lockForSubmission();
      finish();
    } else {
      if (visibilityState.switches) {
        switchWarning.hidden = false;
        switchWarning.textContent = 'Tab or app switching is not allowed. A second switch will submit your test automatically.';
      }
      timerId = setInterval(tick, 1000);
      tick();
    }
  });
}

export function showLeaderboard(main, ctx, courseId, testId) {
  const content = el('div', {class: 'leaderboard-shell'});
  const isFreeTest = courseId === 'free-tests';
  const isCurrentAffairs = courseId === 'current-affairs';
  main.append(backLink(isFreeTest ? 'Back to Free Test Series' :
    isCurrentAffairs ? 'Back to Current Affairs' : 'Back to Course',
    isFreeTest ? '#free-tests' : isCurrentAffairs ? '#current-affairs' : `#course/${idPart(courseId)}`),
    ...heading('Live Test Leaderboard', 'Rankings use the first attempt and are finalized when the live window closes.'), content);
  loadInto(content, ctx, async () => {
    const board = await protectedGet(ctx, `/tests/${idPart(testId)}/leaderboard`);
    const top = board.rows.slice(0, 3);
    const podium = el('div', {class: 'leaderboard-podium'},
      ...[1, 0, 2].map(index => {
        const row = top[index];
        if (!row) return null;
        return el('article', {class: `podium-place place-${row.rank}${row.isCurrentUser ? ' mine' : ''}`},
          el('span', {class: 'podium-medal'}, row.rank === 1 ? '🥇' : row.rank === 2 ? '🥈' : '🥉'),
          el('div', {class: 'podium-avatar', 'aria-hidden': 'true'}, row.name.slice(0, 1).toUpperCase()),
          el('strong', {}, row.name), el('b', {}, `${row.score}/${row.maxMarks}`),
          el('small', {}, `${Math.floor(row.elapsedSeconds / 60)}m ${row.elapsedSeconds % 60}s`));
      }).filter(Boolean));
    const mine = board.mine ? el('section', {class: 'leaderboard-you'},
      el('span', {}, 'Your Rank'), el('strong', {}, `#${board.mine.rank}`),
      el('span', {}, `${board.mine.score}/${board.mine.maxMarks} · ${board.mine.attempts} attempt${board.mine.attempts === 1 ? '' : 's'}`)) : null;
    const rankingRows = board.rows.map(row => el('div', {class: `leaderboard-row${row.isCurrentUser ? ' mine' : ''}`},
      el('span', {class: 'leaderboard-rank'}, `#${row.rank}`),
      el('div', {class: 'leaderboard-student'}, el('strong', {}, row.isCurrentUser ? `${row.name} (You)` : row.name),
        el('small', {}, `${row.attempts} attempt${row.attempts === 1 ? '' : 's'} · ${Math.floor(row.elapsedSeconds / 60)}m ${row.elapsedSeconds % 60}s`)),
      el('div', {class: 'leaderboard-score'}, el('strong', {}, `${row.score}/${row.maxMarks}`),
        el('small', {}, `${Math.round((row.score / (row.maxMarks || 1)) * 100)}%`))));
    content.replaceChildren(
      el('section', {class: 'leaderboard-summary'}, el('div', {}, el('span', {}, 'Live Test'), el('strong', {}, board.title)),
        el('div', {}, el('span', {}, 'Participants'), el('strong', {}, String(board.participants))),
        el('div', {}, el('span', {}, 'Closed'), el('strong', {}, new Date(board.expiresAt).toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short'
        }))), mine), podium,
      el('section', {class: 'panel leaderboard-list'}, el('h2', {}, 'Final Rankings'),
        ...rankingRows));
  });
}

export function showVideo(main, ctx, courseId, videoId) {
  const back = () => backLink('Back to Study Materials', '#materials');
  const content = el('div');
  main.append(back(), ...heading('Chapter Video'), content);
  loadInto(content, ctx, async () => {
    const {videos = [], downloadsEnabled} = await protectedGet(ctx, `/courses/${idPart(courseId)}`);
    const video = videos.find(item => String(item.id) === videoId);
    if (!video) throw new Error('This video is not available in the course.');
    const {url} = await protectedGet(ctx, `/videos/${idPart(videoId)}/link`);
    main.replaceChildren(back(), ...heading(video.title, `${video.subject} · ${video.chapter}`), content);
    const download = downloadsEnabled ? saveControl(ctx, {type: 'course-video', id: String(videoId), courseId,
      title: video.title, videoLink: `/videos/${idPart(videoId)}/link`}) : null;
    download?.classList.add('video-download-action');
    content.replaceChildren(el('section', {class: 'panel'},
      download,
      el('video', {class: 'chapter-video', src: url, controls: '', controlslist: 'nodownload',
        preload: 'metadata', playsinline: '', 'aria-label': video.title})));
  });
}

export function showBook(main, ctx, courseId, bookId) {
  const back = () => {
    const control = backLink('Back to Course', `#course/${idPart(courseId)}`, 'page-back book-reader-back');
    return control;
  };
  const content = el('div', {class: 'book-reader'});
  main.append(back(), ...heading('Study Book'), content);
  loadInto(content, ctx, async () => {
    const {books, downloadsEnabled} = await protectedGet(ctx, `/courses/${idPart(courseId)}`);
    const book = books.find(item => String(item.id) === bookId);
    if (!book) throw new Error('This book is not available in the course.');
    const gallery = coverGallery(book, 'reader-gallery');
    const title = heading(book.title);
    title[0].classList.add('book-reader-title');
    main.replaceChildren(back(), ...title, ...(gallery ? [gallery] : []), content);
    if (!Number.isSafeInteger(book.pages) || book.pages < 1) {
      content.replaceChildren(empty('This book has no pages to display.'));
      return;
    }
    content.replaceChildren();
    pdfReader(content, ctx, {...book,
      pagePath: `/books/${idPart(bookId)}/pages`,
      savedItem: downloadsEnabled ? {type: 'course-pdf', id: String(bookId), courseId,
        title: book.title, pages: book.pages, pagePath: `/books/${idPart(bookId)}/pages`} : null});
  });
}
