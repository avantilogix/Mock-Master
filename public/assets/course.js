import {api} from './services.js';
import {coverGallery} from './publishing-media.js';
import {bindForm, button, el, entries, field, firstAttemptScore, formatDate, heading, icon, idPart, link, loadInto, panel, rule, run, say, status, textValue} from './ui.js?v=course-payment-close-v1';

export const upiReference = control => rule(control, value =>
  /^[A-Za-z0-9][A-Za-z0-9 _/.-]{2,79}$/.test(value) ? '' :
    'Enter a valid UPI transaction reference (3–80 letters, numbers, spaces, or . _ / -).');

const inr = new Intl.NumberFormat('en-IN', {style: 'currency', currency: 'INR'});
export const priceText = paise => inr.format(paise / 100);
export const owns = (me, id) => me?.purchases?.some(purchase => String(purchase) === String(id));

function expiryLabel(course, myCourse = false) {
  if (!course.expiresOn) return null;
  return el('p', {class: `course-expiry${course.expired ? ' expired' : ''}`},
    course.expired ? 'Expired on ' : myCourse ? 'Expiry Date: ' : 'Access through ',
    el('time', {datetime: course.expiresOn}, formatDate(course.expiresOn, false)), ' (IST)');
}

const shortcut = (glyph, title, description, href, tone = '') => el('a',
  {class: `shortcut ${tone}`, href},
  el('span', {class: 'shortcut-icon'}, icon(glyph, 'line-icon')),
  el('strong', {}, title), el('small', {}, description));

function courseCard(course, index, me, myCourse = false) {
  const owned = owns(me, course.id);
  const cover = coverGallery(course, myCourse ? 'my-course-cover' : '') || el('div', {class: `card-cover alt-${index % 3}`},
    myCourse ? null : el('span', {}, owned ? 'Your Learning Space' : 'Mock Tests + E-Books'));
  const description = el('p', {class: 'description tile-description'}, course.description);
  const readMore = link('Read more', `#course/${idPart(course.id)}`, 'text-link tile-read-more');
  readMore.hidden = true;
  const actionLabel = myCourse ? (course.expired ? 'View Details' : 'View Course') :
    owned && !course.expired ? 'Open Course' : 'View Details';
  const actionAriaLabel = myCourse ? `View course: ${course.title}` :
    course.expired ? `View details for course: ${course.title}` :
      owned ? `Open course: ${course.title}` : `View course: ${course.title}`;
  const footer = el('div', {class: `card-footer${myCourse ? ' my-course-footer' : ''}`},
    course.expired ? el('span', {class: 'muted'}, 'Access closed') :
      owned ? myCourse ? null : el('span', {class: 'muted'}, 'Continue Learning') :
        el('p', {class: 'price'}, priceText(course.price)),
    el('a', {class: `button${myCourse ? ' my-course-view' : ''}`, href: `#course/${idPart(course.id)}`,
      'aria-label': actionAriaLabel}, actionLabel));
  const body = el('div', {class: `card-body${myCourse ? ' my-course-card-body' : ''}`},
    owned && !myCourse ? el('span', {class: 'badge'}, 'Purchased') : null,
    el('h3', {}, course.title), expiryLabel(course, myCourse),
    myCourse ? null : description, myCourse ? null : readMore, footer);
  const card = el('article', {class: `panel card${myCourse ? ' my-course-card' : ''}`}, cover, body);
  if (!myCourse) {
    requestAnimationFrame(() => {
      if (card.isConnected) readMore.hidden = description.scrollHeight <= description.clientHeight + 1;
    });
  }
  return card;
}

export function showDashboard(main, ctx, me) {
  const courses = el('div', {class: 'grid'});
  main.append(
    el('section', {class: 'home-greeting'}, el('h1', {}, 'Hello, learner')),
    el('section', {class: 'section'},
      el('div', {class: 'section-heading'}, el('h2', {}, 'Quick Access')),
      el('div', {class: 'shortcut-grid'},
        shortcut('courses', 'My Courses', 'Continue purchased learning', '#my-courses', 'mint'),
        shortcut('test', 'Test Series', 'Practice exam questions', '#test-series', 'blue'),
        shortcut('courses', 'Book Store', 'Find secure study books', '#book-store', 'orange'),
        shortcut('files', 'Study Materials', 'Open your saved PDFs', '#materials', 'purple'),
        shortcut('files', 'Free Study Material', 'Read free PDFs', '#free-materials', 'purple'),
        shortcut('test', 'Free Test Series', 'Practise free tests', '#free-tests', 'blue'),
        shortcut('news', 'Current Affairs', 'Daily exam updates', '#current-affairs', 'rose'),
        shortcut('history', 'Previous Year Questions', 'Practice earlier questions', '#pyqs', 'mint'),
        shortcut('news', 'Syllabus', 'View topics and learning plan', '#syllabus', 'purple'),
        shortcut('calendar', 'Timetable', 'Plan your study week', '#timetable', 'blue'),
        shortcut('play', 'YouTube Videos', 'Watch focused lessons', '#videos', 'rose'),
        shortcut('chat', 'Course Groups', 'Discuss with purchasers', '#groups', 'blue'))),
    el('section', {class: 'section home-course-section'},
      el('div', {class: 'section-heading'}, el('h2', {}, me?.purchases?.length ? 'Continue Learning' : 'Popular Courses'),
        link('Browse All', '#catalog')),
      courses));
  loadInto(courses, ctx, async () => {
    const rows = await api('/courses', {ctx});
    const selected = me?.purchases?.length ? rows.filter(course => owns(me, course.id)) : rows.slice(0, 3);
    courses.replaceChildren(...(selected.length ? selected.map(courseCardWithProfile(me)) :
      [el('p', {class: 'empty'}, me ? 'No purchased missions yet. Explore the catalog to begin.' : 'Explore available missions and sign in when you are ready.')]));
  });
}

const courseCardWithProfile = (me, myCourse = false) => (course, index) => courseCard(course, index, me, myCourse);

export function showMyCourses(main, ctx, me, action) {
  const coursesTab = link('Courses', '#my-courses', 'my-course-tab');
  coursesTab.setAttribute('aria-current', 'page');
  const testsTab = link('Test Series', '#test-series', 'my-course-tab');
  main.append(el('h1', {class: 'sr-only'}, 'My Courses'),
    el('nav', {class: 'my-course-tabs', 'aria-label': 'Course categories'}, coursesTab, testsTab));
  if (!ctx.user) {
    main.append(panel('Your Learning Library', el('p', {}, 'Sign in to restore courses purchased with your mobile number.'),
      action.signInLink()));
    return;
  }
  const list = el('div', {class: 'grid my-course-list'});
  main.append(list);
  loadInto(list, ctx, async () => {
    const rows = await api('/courses', {ctx});
    const purchased = rows.filter(course => owns(me, course.id));
    list.replaceChildren(...(purchased.length ? purchased.map(courseCardWithProfile(me, true)) :
      [el('div', {class: 'empty-library'}, el('h2', {}, 'Your First Mission Is Waiting'),
        el('p', {class: 'muted'}, 'Purchase a course and it will appear here automatically.'),
        link('Explore Missions', '#catalog', 'button'))]));
  });
}

function chapterGroups(books, videos) {
  const subjects = new Map();
  const add = (item, key) => {
    if (!subjects.has(item.subject)) subjects.set(item.subject, new Map());
    const chapters = subjects.get(item.subject);
    const chapter = item.chapter ?? 'Chapter 1';
    if (!chapters.has(chapter)) chapters.set(chapter, {books: [], videos: []});
    chapters.get(chapter)[key].push(item);
  };
  books.forEach(book => add(book, 'books'));
  videos.forEach(video => add(video, 'videos'));
  return subjects;
}

function materialFolderEntry(name, fileCount, onClick, kind = 'folder') {
  const entry = button('', 'course-folder-entry material-folder-entry');
  const count = `${fileCount} file${fileCount === 1 ? '' : 's'}`;
  entry.setAttribute('aria-label', `Open ${kind} ${name}, ${count}`);
  entry.append(
    el('div', {class: 'course-folder-thumbnail course-folder-art'}, icon('files', 'line-icon')),
    el('span', {class: 'course-folder-entry-copy'},
      el('strong', {}, name), el('small', {}, count)),
    el('span', {class: 'course-folder-arrow', 'aria-hidden': 'true'}, '›'));
  entry.addEventListener('click', onClick);
  return entry;
}

function materialFileEntry(name, kind, href) {
  const entry = link('', href, 'course-folder-entry material-folder-entry course-material-file');
  entry.setAttribute('aria-label', `Open ${kind} ${name}`);
  entry.append(
    el('div', {class: 'course-folder-thumbnail course-folder-art'}, icon(kind === 'PDF' ? 'file' : 'play', 'line-icon')),
    el('span', {class: 'course-folder-entry-copy'},
      el('strong', {}, name), el('small', {}, kind)),
    el('span', {class: 'course-folder-arrow', 'aria-hidden': 'true'}, '›'));
  return entry;
}

function folderBackButton(onClick) {
  const back = button('', 'button secondary icon-action course-folder-back');
  back.setAttribute('aria-label', 'Back');
  back.title = 'Back';
  back.append(icon('back', 'line-icon'));
  back.addEventListener('click', onClick);
  return back;
}

function chapterFolders(subjects, courseId, navigation = {}) {
  if (!subjects.size) return el('p', {class: 'empty'}, 'No study books or videos have been added to this course yet.');
  const sortNames = ([a], [b]) => a.localeCompare(b, undefined, {numeric: true});
  const browser = el('div', {class: 'course-folder-browser course-chapter-browser'});
  const fileEntries = material => [
    ...material.books.map(book => navigation.removeBreadcrumbs ?
      materialFileEntry(book.title, 'PDF', `#book/${idPart(courseId)}/${idPart(book.id)}`) :
      el('div', {class: 'chapter-book'}, coverGallery(book, 'book-gallery'),
        link(`PDF · ${book.title}`, `#book/${idPart(courseId)}/${idPart(book.id)}`, 'chapter-link'))),
    ...material.videos.map(video => navigation.removeBreadcrumbs ?
      materialFileEntry(video.title, 'Video', `#video/${idPart(courseId)}/${idPart(video.id)}`) :
      link(`Video · ${video.title}`, `#video/${idPart(courseId)}/${idPart(video.id)}`, 'chapter-link video-link')),
  ];

  function show(subject = '', chapter = '', focusHeading = false) {
    let breadcrumbs = null;
    if (!navigation.removeBreadcrumbs) {
      breadcrumbs = el('nav', {class: 'course-folder-breadcrumbs', 'aria-label': 'Study material path'});
      const rootCrumb = button('All subjects', 'course-folder-crumb');
      rootCrumb.setAttribute('aria-current', subject ? 'false' : 'page');
      rootCrumb.disabled = !subject;
      rootCrumb.addEventListener('click', () => show('', '', true));
      breadcrumbs.append(rootCrumb);

      if (subject) {
        const subjectCrumb = button(subject, 'course-folder-crumb');
        subjectCrumb.setAttribute('aria-current', chapter ? 'false' : 'page');
        subjectCrumb.disabled = !chapter;
        subjectCrumb.addEventListener('click', () => show(subject, '', true));
        breadcrumbs.append(el('span', {class: 'course-folder-chevron', 'aria-hidden': 'true'}, '›'),
          subjectCrumb);
      }
      if (chapter) {
        const chapterCrumb = button(chapter, 'course-folder-crumb');
        chapterCrumb.setAttribute('aria-current', 'page');
        chapterCrumb.disabled = true;
        breadcrumbs.append(el('span', {class: 'course-folder-chevron', 'aria-hidden': 'true'}, '›'),
          chapterCrumb);
      }
    }

    const title = navigation.removeBreadcrumbs ? null :
      el('h3', {class: 'course-folder-heading', tabindex: '-1'}, chapter || subject || 'Subjects');
    const backButton = navigation.removeBreadcrumbs && (subject || chapter || navigation.onBack) ?
      folderBackButton(() => {
        if (chapter) show(subject, '', true);
        else if (subject) show('', '', true);
        else navigation.onBack();
      }) : null;
    let section;
    if (!subject) {
      const entries = el('div', {class: 'course-folder-entries'});
      for (const [name, chapters] of [...subjects].sort(sortNames)) {
        const direct = chapters.get('');
        const fileCount = chapters.size - Number(Boolean(direct)) +
          (direct ? direct.books.length + direct.videos.length : 0);
        entries.append(materialFolderEntry(name, fileCount,
          () => show(name, '', true), 'subject'));
      }
      section = navigation.removeBreadcrumbs ? entries :
        el('section', {class: 'course-folder-section'}, entries);
    } else {
      const chapters = subjects.get(subject);
      if (!chapter) {
        const entries = el('div', {class: 'course-folder-entries'});
        for (const [name, material] of [...chapters].sort(sortNames)) {
          if (!name) continue;
          const itemCount = material.books.length + material.videos.length;
          entries.append(materialFolderEntry(name, itemCount,
            () => show(subject, name, true), 'chapter'));
        }
        const direct = chapters.get('');
        if (direct) entries.append(...fileEntries(direct));
        section = navigation.removeBreadcrumbs ? entries :
          el('section', {class: 'course-folder-section'},
            el('h4', {}, direct ? (chapters.size > 1 ? 'Chapters and study materials' : 'Study materials') : 'Chapters'), entries);
      } else {
        const material = chapters.get(chapter);
        if (navigation.removeBreadcrumbs) {
          const files = fileEntries(material);
          section = files.length ? el('div', {class: 'course-folder-entries'}, files) :
            el('p', {class: 'course-folder-empty'}, 'No study materials in this folder.');
        } else {
          const links = fileEntries(material);
          section = el('section', {class: 'course-folder-section'},
            el('h4', {}, 'Study materials'),
            links.length ? el('div', {class: 'chapter-list'}, links) :
              el('p', {class: 'course-folder-empty'}, 'No study materials in this chapter yet.'));
        }
      }
    }

    const header = navigation.removeBreadcrumbs ? null :
      el('div', {class: 'course-folder-header'}, breadcrumbs, title);
    browser.replaceChildren(...(header ? [header] : []), ...(backButton ? [backButton] : []), section);
    navigation.onNavigate?.(Boolean(subject || chapter));
    if (focusHeading) {
      (browser.querySelector('.course-folder-heading') || browser.querySelector('.course-folder-entry'))?.focus();
    }
  }

  show();
  return browser;
}

function folderTree(folders, items, renderItems) {
  if (!folders?.length) return renderItems(items);
  const folderIds = new Set(folders.map(folder => folder.id));
  const children = new Map();
  for (const folder of folders) {
    const parentId = folderIds.has(folder.parentId) ? folder.parentId : '';
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(folder);
  }
  const itemGroups = new Map();
  for (const item of items) {
    const folderId = folderIds.has(item.folderId) ? item.folderId : '';
    if (!itemGroups.has(folderId)) itemGroups.set(folderId, []);
    itemGroups.get(folderId).push(item);
  }
  const renderGroup = group => group?.length ? renderItems(group) : null;
  const renderChildren = parentId => (children.get(parentId) || [])
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(folder => el('details', {class: 'course-content-folder'},
      el('summary', {}, el('strong', {}, folder.name)),
      renderGroup(itemGroups.get(folder.id)),
      ...renderChildren(folder.id)));
  return el('div', {class: 'course-folder-tree'},
    renderGroup(itemGroups.get('')),
    ...renderChildren(''));
}

function materialFolderBrowser(folders, items, renderItems, {removeBreadcrumbs = false} = {}) {
  if (!folders?.length) return renderItems(items, {removeBreadcrumbs});

  const foldersById = new Map(folders.map(folder => [folder.id, folder]));
  const children = new Map();
  const itemGroups = new Map();
  for (const folder of folders) {
    const parentId = foldersById.has(folder.parentId) ? folder.parentId : '';
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(folder);
  }
  for (const item of items) {
    const folderId = foldersById.has(item.folderId) ? item.folderId : '';
    if (!itemGroups.has(folderId)) itemGroups.set(folderId, []);
    itemGroups.get(folderId).push(item);
  }
  for (const folderList of children.values()) folderList.sort((a, b) => a.name.localeCompare(b.name));

  const browser = el('div', {class: 'course-folder-browser'});

  function folderPath(folderId) {
    const path = [];
    const seen = new Set();
    let folder = foldersById.get(folderId);
    while (folder && !seen.has(folder.id)) {
      seen.add(folder.id);
      path.unshift(folder);
      folder = foldersById.get(folder.parentId);
    }
    return path;
  }

  function showFolder(folderId, focusHeading = false) {
    const path = folderPath(folderId);
    let breadcrumbs = null;
    if (!removeBreadcrumbs) {
      breadcrumbs = el('nav', {class: 'course-folder-breadcrumbs', 'aria-label': 'Folder path'});
      const rootCrumb = button('All folders', 'course-folder-crumb');
      rootCrumb.setAttribute('aria-current', folderId ? 'false' : 'page');
      rootCrumb.disabled = !folderId;
      rootCrumb.addEventListener('click', () => showFolder('', true));
      breadcrumbs.append(rootCrumb);

      for (const folder of path) {
        const crumb = button(folder.name, 'course-folder-crumb');
        const isCurrent = folder.id === folderId;
        crumb.setAttribute('aria-current', isCurrent ? 'page' : 'false');
        crumb.disabled = isCurrent;
        crumb.addEventListener('click', () => showFolder(folder.id, true));
        breadcrumbs.append(el('span', {class: 'course-folder-chevron', 'aria-hidden': 'true'}, '›'),
          crumb);
      }
    }

    const title = removeBreadcrumbs ? null :
      el('h3', {class: 'course-folder-heading', tabindex: '-1'},
        path[path.length - 1]?.name || 'Folders');
    const subfolders = children.get(folderId) || [];
    const contents = itemGroups.get(folderId) || [];
    const backButton = removeBreadcrumbs && folderId && !contents.length ?
      folderBackButton(() => showFolder(path.length > 1 ? path[path.length - 2].id : '', true)) : null;
    const sections = [];
    let folderSection = null;

    if (subfolders.length) {
      const entries = el('div', {class: 'course-folder-entries'});
      for (const folder of subfolders) {
        const subjectCount = new Set((itemGroups.get(folder.id) || []).map(item => item.subject)).size;
        entries.append(materialFolderEntry(folder.name, (children.get(folder.id) || []).length + subjectCount,
          () => showFolder(folder.id, true)));
      }
      folderSection = removeBreadcrumbs ? entries :
        el('section', {class: 'course-folder-section'},
          folderId ? el('h4', {}, 'Folders inside') : null, entries);
      sections.push(folderSection);
    }

    if (contents.length) {
      const folderNavigation = {
        removeBreadcrumbs,
        onBack: folderId ? () => showFolder(path.length > 1 ? path[path.length - 2].id : '', true) : null,
        onNavigate: inside => { if (folderSection) folderSection.style.display = inside ? 'none' : ''; },
      };
      const renderedItems = renderItems(contents, folderNavigation);
      sections.push(removeBreadcrumbs ? renderedItems :
        el('section', {class: 'course-folder-section'},
          el('h4', {}, folderId ? 'Materials in this folder' : 'Materials in course root'),
          renderedItems));
    } else if (!subfolders.length) {
      sections.push(el('p', {class: 'course-folder-empty'}, 'No study materials in this folder yet.'));
    }

    const header = removeBreadcrumbs ? null :
      el('div', {class: 'course-folder-header'}, breadcrumbs, title);
    browser.replaceChildren(...(header ? [header] : []), ...(backButton ? [backButton] : []), ...sections);
    if (focusHeading) {
      (browser.querySelector('.course-folder-heading') || browser.querySelector('.course-folder-entry'))?.focus();
    }
  }

  showFolder('');
  return browser;
}

function testRows(ctx, items, courseId) {
  return entries(items, 'No practice tests have been published for this course yet.', test => {
    const leaderboard = test.live && Date.parse(test.expiresAt) <= Date.now() ?
      link('Leaderboard', `#leaderboard/${idPart(courseId)}/${idPart(test.id)}`,
        'button secondary test-series-action test-series-leaderboard') : null;
    leaderboard?.prepend(icon('leaderboard', 'line-icon'));
    return el('div', {class: 'test-series-row'},
      el('div', {}, link(test.title, `#test/${idPart(courseId)}/${idPart(test.id)}`, 'material-link'),
        test.live ? el('span', {class: 'badge live-badge'},
          `Live · ${formatDate(test.startsAt)} IST · ${test.durationMinutes} min`) : null),
      el('div', {class: 'actions test-row-actions'},
        leaderboard,
        test.questionPaperDownload && test.completedAttempt ? questionPaperButton(ctx, test) : null,
        firstAttemptScore(test.firstAttempt),
        iconStartTest(courseId, test.id)));
  });
}

export function showContentLibrary(main, ctx, me, kind, action) {
  const config = {
    'test-series': { title: 'Test Series', icon: 'test', description: 'Choose a purchased mission and start a published mock test.', empty: 'Tests become available after you purchase a mission.', item: 'tests' },
    'book-store': { title: 'Book Store', icon: '▤', description: 'Browse missions that include protected digital study books.', empty: 'No digital books are currently listed.', item: 'books' },
    'materials': { title: 'Study Materials', icon: '⌑', description: 'Open secure PDF books and chapter videos from your purchased missions.', empty: 'No purchased study materials yet.', item: 'books' },
  }[kind];
  const libraryIcon = () => config.icon === 'test' ? icon('test', 'line-icon') : config.icon;
  main.append(...heading(config.title, config.description));
  const content = el('div');
  main.append(el('section', {class: 'library-panel'}, content));
  if (kind === 'materials' && !ctx.user) {
    content.replaceChildren(el('div', {class: 'empty-library'}, el('span', {class: 'shortcut-icon'}, config.icon),
      el('h2', {}, 'Sign In to Open Your Library'), action.signInLink('Sign In')));
    return;
  }
  loadInto(content, ctx, async () => {
    const rows = await api('/courses', {ctx});
    const selected = kind === 'materials' ? rows.filter(course => owns(me, course.id) && !course.expired) : rows;
    if (!selected.length) {
      content.replaceChildren(el('div', {class: 'empty-library'}, el('h2', {}, config.empty),
        link('Explore Missions', '#catalog', 'button secondary')));
      return;
    }
    const folders = await Promise.all(selected.map(async course => {
      if (kind === 'book-store' || !owns(me, course.id) || course.expired) {
        return el('article', {class: 'library-folder'},
          el('span', {class: 'folder-icon', 'aria-hidden': 'true'}, libraryIcon()),
          el('div', {}, el('h2', {}, course.title), expiryLabel(course), el('p', {class: 'muted'}, course.description)),
          link(course.expired ? 'View Details' : owns(me, course.id) ? 'Open Mission' : `View at ${priceText(course.price)}`,
            `#course/${idPart(course.id)}`, 'button secondary'));
      }
      const material = await api(`/courses/${idPart(course.id)}`, {ctx, auth: true});
      if (config.item === 'books') {
        const subjects = chapterGroups(material.books, material.videos || []);
        const chapterCount = [...subjects.values()].reduce((sum, chapters) => sum + chapters.size - Number(chapters.has('')), 0);
        const content = materialFolderBrowser(material.folders?.filter(folder => folder.kind === 'content'),
          [...material.books, ...(material.videos || [])],
          folderItems => chapterFolders(chapterGroups(
            folderItems.filter(item => material.books.some(book => book.id === item.id)),
            folderItems.filter(item => (material.videos || []).some(video => video.id === item.id))), course.id));
        return el('article', {class: 'course-material'},
          el('div', {class: 'course-material-head'},
            el('span', {class: 'folder-icon', 'aria-hidden': 'true'}, libraryIcon()),
            el('div', {}, el('h2', {}, course.title), el('p', {class: 'muted'},
              `${subjects.size} subjects · ${chapterCount} chapters`))),
          content);
      }
      const testContent = folderTree(material.folders?.filter(folder => folder.kind === 'tests'),
        config.item === 'tests' ? material.tests : material[config.item],
        folderItems => config.item === 'tests' ? testRows(ctx, folderItems, course.id) :
          entries(folderItems, config.empty, item => el('div', {class: 'test-series-row'},
            el('strong', {}, item.title))));
      return el('article', {class: 'library-folder'},
        el('span', {class: 'folder-icon', 'aria-hidden': 'true'}, libraryIcon()),
        el('div', {class: 'library-folder-content'},
          el('h2', {}, course.title),
          config.item === 'tests' ? testContent : entries(material[config.item], config.empty, item => {
            const leaderboard = item.live && Date.parse(item.expiresAt) <= Date.now() ?
              link('Leaderboard', `#leaderboard/${idPart(course.id)}/${idPart(item.id)}`,
                'button secondary test-series-action test-series-leaderboard') : null;
            leaderboard?.prepend(icon('leaderboard', 'line-icon'));
            return el('div', {class: 'test-series-row'},
              el('div', {}, el('strong', {}, item.title), item.live ? el('span', {class: 'badge live-badge'},
                `Live · ${formatDate(item.startsAt)} IST · ${item.durationMinutes} min`) : null),
              el('div', {class: 'actions test-row-actions'},
                leaderboard,
                item.questionPaperDownload && item.completedAttempt ?
                  questionPaperButton(ctx, item) : null,
                firstAttemptScore(item.firstAttempt),
                iconStartTest(course.id, item.id)));
          })));
    }));
    content.replaceChildren(...folders);
  });
}

function iconStartTest(courseId, testId) {
  const start = link('Start test', `#test/${idPart(courseId)}/${idPart(testId)}`, 'button test-start-button');
  start.append(icon('arrow-right', 'line-icon'));
  start.setAttribute('aria-label', 'Start test');
  return start;
}

function questionPaperButton(ctx, test) {
  const control = button('Download Question Paper', 'secondary test-series-action test-series-paper');
  control.prepend(icon('download', 'line-icon'));
  const feedback = status();
  control.addEventListener('click', () => run(control, feedback, async () => {
    const blob = await api(`/tests/${idPart(test.id)}/question-paper.pdf`, {ctx, auth: true, blob: true});
    const url = URL.createObjectURL(blob);
    const anchor = el('a', {href: url, download: `${test.title.replace(/[^\w .-]+/g, '_')}-question-paper.pdf`});
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    say(feedback, 'Question paper downloaded.');
  }, 'Preparing question paper…'));
  return el('span', {class: 'test-download-action'}, control, feedback);
}

export function showCatalog(main, ctx, me) {
  const list = el('div', {class: 'catalog-course-list'});
  main.append(el('section', {class: 'section', id: 'available-courses'},
    ...heading('All Courses'),
    list));
  loadInto(list, ctx, async () => {
    const courses = await api('/courses', {ctx});
    list.replaceChildren(...(courses.length ? courses.map((course, index) => catalogCourseCard(course, index, me)) :
      [el('p', {class: 'empty'}, 'No courses are available yet. Check back soon for new study material.')]));
  });
}

function catalogCourseCard(course, index, me) {
  const owned = owns(me, course.id);
  const cover = coverGallery(course, 'catalog-course-cover') ||
    el('div', {class: `catalog-course-cover catalog-course-placeholder alt-${index % 3}`},
      icon('courses', 'line-icon'));
  const card = el('article', {class: 'catalog-course-card', role: 'link', tabindex: '0',
    'aria-label': `Open course: ${course.title}`}, cover,
    el('div', {class: 'catalog-course-info'},
      el('div', {class: 'catalog-course-meta'},
        el('span', {class: 'catalog-course-kind'}, 'Content Course'),
        owned ? el('span', {class: 'catalog-course-owned'}, 'Purchased') : null),
      el('h3', {}, course.title),
      expiryLabel(course),
      el('div', {class: 'catalog-course-bottom'},
        course.expired ? el('span', {class: 'muted'}, 'Access closed') :
          owned ? el('span', {class: 'muted'}, 'Continue Learning') :
            el('span', {class: 'catalog-course-price'}, priceText(course.price)))));
  const openCourse = () => { location.hash = `#course/${idPart(course.id)}`; };
  card.addEventListener('click', event => {
    if (!event.target.closest('button, a, input, select, textarea')) openCourse();
  });
  card.addEventListener('keydown', event => {
    if (event.target === card && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      openCourse();
    }
  });
  return card;
}

export function showCourse(main, ctx, session, action) {
  const id = action.id;
  const path = `/courses/${idPart(id)}`;
  const owned = owns(session?.me, id);
  const admin = Boolean(session?.me?.admin);
  const overviewTab = button('Overview', 'course-tab');
  const contentTab = button('Content', 'course-tab');
  const testTab = button('Test', 'course-tab');
  overviewTab.setAttribute('role', 'tab');
  contentTab.setAttribute('role', 'tab');
  testTab.setAttribute('role', 'tab');
  const tabs = el('nav', {class: 'course-tabs', role: 'tablist', 'aria-label': 'Course sections'},
    ...(owned ? [] : [overviewTab]), contentTab, testTab);
  const overview = el('section', {class: 'course-tab-panel course-overview', role: 'tabpanel'});
  const content = el('section', {class: 'course-tab-panel course-content', role: 'tabpanel', hidden: ''});
  const testPanel = el('section', {class: 'course-tab-panel course-test-panel', role: 'tabpanel', hidden: ''});
  overviewTab.id = 'course-overview-tab';
  contentTab.id = 'course-content-tab';
  testTab.id = 'course-test-tab';
  overviewTab.setAttribute('aria-controls', 'course-overview-panel');
  contentTab.setAttribute('aria-controls', 'course-content-panel');
  testTab.setAttribute('aria-controls', 'course-test-panel');
  overview.id = 'course-overview-panel';
  content.id = 'course-content-panel';
  testPanel.id = 'course-test-panel';
  overview.setAttribute('aria-labelledby', overviewTab.id);
  content.setAttribute('aria-labelledby', contentTab.id);
  testPanel.setAttribute('aria-labelledby', testTab.id);
  const access = el('section', {class: 'section course-access'});
  const testAccess = el('section', {class: 'section course-test-access'});
  const reviews = el('div');
  const reviewPanel = panel('Course Reviews', reviews);
  const paymentTarget = el('div', {class: 'course-payment-target'});
  const closePayment = button('', 'secondary course-payment-close');
  closePayment.append(icon('close', 'line-icon'));
  closePayment.setAttribute('aria-label', 'Close payment options');
  closePayment.title = 'Close payment options';
  const paymentDialog = el('dialog', {class: 'course-payment-dialog', 'aria-labelledby': 'course-payment-title'},
    el('div', {class: 'course-payment-dialog-header'},
      el('h2', {id: 'course-payment-title'}, 'Payment Options'), closePayment),
    paymentTarget);
  const courseTabs = [
    ...(owned ? [] : [{name: 'overview', tab: overviewTab, panel: overview}]),
    {name: 'content', tab: contentTab, panel: content},
    {name: 'test', tab: testTab, panel: testPanel},
  ];
  const selectTab = selected => {
    for (const item of courseTabs) {
      const active = item.name === selected;
      item.tab.setAttribute('aria-selected', String(active));
      item.tab.tabIndex = active ? 0 : -1;
      item.panel.hidden = !active;
    }
  };
  for (const item of courseTabs) {
    item.tab.addEventListener('click', () => selectTab(item.name));
  }
  tabs.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      const index = courseTabs.findIndex(item => item.tab === event.target);
      if (index < 0) return;
      const direction = event.key === 'ArrowRight' ? 1 : -1;
      const next = courseTabs[(index + direction + courseTabs.length) % courseTabs.length];
      next.tab.focus();
      selectTab(next.name);
    }
  });
  main.append(tabs, ...(owned ? [] : [overview]), content, testPanel, paymentDialog);
  if (owned) content.append(el('span', {class: 'badge'}, 'Purchased · Approved'));
  content.append(access, reviewPanel);
  testPanel.append(testAccess);
  closePayment.addEventListener('click', () => paymentDialog.close());
  selectTab(owned ? 'content' : 'overview');

  loadInto(access, ctx, async () => {
    const courses = await api('/courses', {ctx});
    const course = courses.find(item => String(item.id) === id);
    if (!course) {
      access.replaceChildren(el('p', {class: 'empty'}, 'This course is no longer listed in the catalog.'));
      overview.replaceChildren(el('p', {class: 'empty'}, 'This course is no longer listed in the catalog.'));
      return;
    }
    const gallery = coverGallery(course);
    const cover = gallery || el('div', {class: 'course-overview-cover catalog-course-placeholder'},
      icon('courses', 'line-icon'));
    cover.classList.add('course-overview-cover');
    const price = !owned && !course.expired ?
      el('strong', {class: 'course-overview-price'}, priceText(course.price)) : null;
    const expiry = el('span', {class: `course-overview-expiry${course.expired ? ' expired' : ''}`},
      course.expired ? 'Expired on ' : 'Expiry Date: ',
      course.expiresOn ? el('time', {datetime: course.expiresOn}, formatDate(course.expiresOn, false)) :
        'Not set');
    const openPayment = () => {
      paymentTarget.replaceChildren();
      if (!session) {
        paymentTarget.append(el('p', {}, 'Sign in to purchase this course or access material you already own.'),
          action.signInLink('Sign In to Continue'));
      } else if (!session.me) {
        paymentTarget.append(action.profileUnavailable());
      } else {
        showManualPayment(paymentTarget, ctx, session, course, path, action);
      }
      if (!paymentDialog.open) paymentDialog.showModal();
    };
    const purchase = !owned && !course.expired ? button('Buy Now', 'course-buy-button') : null;
    purchase?.addEventListener('click', openPayment);
    overview.replaceChildren(cover,
      el('div', {class: 'course-overview-details'},
        el('h1', {}, course.title),
        owned ? el('span', {class: 'catalog-course-owned'}, 'Purchased') : null,
        el('div', {class: 'course-overview-price-row'}, price, expiry),
        el('section', {class: 'course-description'},
          el('h2', {}, 'Description'),
          el('p', {}, course.description || 'Course details will be available soon.')),
        purchase ? el('div', {class: 'course-buy-bar'}, purchase) : null));
    if (course.expired && !admin) {
      access.replaceChildren(el('h2', {}, 'Course Expired'),
        el('p', {}, 'This course is closed to new purchases and study access.'),
        link('Explore Active Courses', '#catalog', 'button secondary'));
      testAccess.replaceChildren(el('h2', {}, 'Course Expired'),
        el('p', {}, 'This course is closed to new purchases and study access.'),
        link('Explore Active Courses', '#catalog', 'button secondary'));
    } else if (owned || admin) {
      access.className = 'section';
      showMaterials(access, testAccess, ctx, path, id);
      if (owned) showReviewForm();
    } else {
      const contentBuy = button('Buy Now', 'secondary course-content-buy');
      contentBuy.addEventListener('click', openPayment);
      access.replaceChildren(el('h2', {}, 'Course Content'),
        el('p', {}, 'Purchase this course to unlock its study materials and discussions.'),
        contentBuy);
      const testBuy = button('Buy Now', 'secondary course-content-buy');
      testBuy.addEventListener('click', openPayment);
      testAccess.replaceChildren(el('h2', {}, 'Practice & Live Tests'),
        el('p', {}, 'Purchase this course to unlock its practice and live tests.'),
        testBuy);
    }
  });

  const list = el('div');
  reviews.append(list);
  const ratingStars = value => {
    const score = Number(value);
    return el('span', {class: 'course-review-stars', role: 'img', 'aria-label': `${score} out of 5 stars`},
      [1, 2, 3, 4, 5].map(star => el('span', {
        class: star <= score ? 'is-filled' : '',
        'aria-hidden': 'true',
      }, '★')));
  };
  const refreshReviews = () => loadInto(list, ctx, async () => {
    const rows = await api(`${path}/reviews`, {ctx});
    list.replaceChildren(entries(rows, 'No reviews yet.', entry => [
      el('strong', {}, entry.name),
      el('div', {class: 'course-review-rating'}, ratingStars(entry.rating)),
      el('p', {class: 'entry-text'}, entry.text)
    ]));
  });
  refreshReviews();
  function showReviewForm() {
    const picker = el('div', {class: 'course-rating-picker'});
    const rating = el('fieldset', {class: 'course-rating-fieldset'},
      el('legend', {}, 'Your rating'), picker);
    const updateRating = () => {
      const selected = Number(picker.querySelector('input:checked')?.value || 0);
      for (const option of picker.querySelectorAll('.course-rating-choice')) {
        const value = Number(option.querySelector('input').value);
        option.querySelector('.course-rating-star').classList.toggle('is-filled', value <= selected);
      }
    };
    for (const value of [1, 2, 3, 4, 5]) {
      const input = el('input', {type: 'radio', name: 'course-review-rating', value, required: ''});
      input.setAttribute('aria-label', `${value} ${value === 1 ? 'star' : 'stars'}`);
      input.addEventListener('change', updateRating);
      picker.append(el('label', {class: 'course-rating-choice'}, input,
        el('span', {class: 'course-rating-star', 'aria-hidden': 'true'}, '★')));
    }
    const text = el('textarea', {rows: '3', required: '', maxlength: '1000'});
    const submit = button('Save Review', null, 'submit');
    const feedback = status();
    const form = el('form', {class: 'course-review-form'}, rating,
      el('small', {class: 'course-rating-hint'}, 'Tap a star to choose your rating.'),
      field('Your Review', text), submit, feedback);
    reviews.append(el('div', {class: 'section'}, form));
    bindForm(form, submit, feedback, async () => {
      const selectedRating = form.querySelector('input[name="course-review-rating"]:checked');
      if (!selectedRating) throw new Error('Choose a rating before saving your review.');
      await api(`${path}/reviews`, {ctx, auth: true, method: 'PUT',
        json: {rating: Number(selectedRating.value), text: textValue(text, 'Review')}});
      say(feedback, 'Review saved.');
      refreshReviews();
    }, 'Saving review…');
  }
}

function showMaterials(access, testAccess, ctx, path, id) {
  loadInto(access, ctx, async () => {
    const {tests, books, videos = [], folders = [], messages} = await api(path, {ctx, auth: true});
    const receipt = button('Download Purchase Receipt', 'secondary');
    const receiptFeedback = status();
    receipt.addEventListener('click', () => run(receipt, receiptFeedback, async () => {
      const blob = await api(`${path}/receipt.pdf`, {ctx, auth: true, blob: true});
      const url = URL.createObjectURL(blob);
      const anchor = el('a', {href: url, download: 'Mission-Selection-course-receipt.pdf'});
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      say(receiptFeedback, 'Receipt downloaded.');
    }, 'Preparing receipt…'));
    const messageList = el('div');
    const refresh = items => messageList.replaceChildren(entries(items,
      'There are no messages yet. Start the discussion with a question or a study tip.', entry => [
        el('strong', {}, entry.name), el('p', {class: 'entry-text'}, entry.text)
      ]));
    refresh(messages);
    const text = el('textarea', {rows: '3', required: '', maxlength: '1000'});
    const submit = button('Post Message', null, 'submit');
    const feedback = status();
    const form = el('form', {class: 'section'}, field('Your Message', text), submit, feedback);
    bindForm(form, submit, feedback, async () => {
      await api(`${path}/messages`, {ctx, auth: true, method: 'POST', json: {text: textValue(text, 'Message')}});
      form.reset();
      try {
        const updated = await api(path, {ctx, auth: true});
        refresh(updated.messages);
        say(feedback, 'Message posted.');
      } catch (error) {
        if (error.name === 'AbortError') throw error;
        say(feedback, 'Message posted. Reopen this course to refresh the discussion.', true);
      }
    }, 'Posting message…');
    const testFolders = folders.filter(folder => folder.kind === 'tests');
    const contentFolders = folders.filter(folder => folder.kind === 'content');
    const testsContent = folderTree(testFolders, tests, items => testRows(ctx, items, id));
    const studyItems = [...books, ...videos];
    const courseContent = materialFolderBrowser(contentFolders, studyItems, (items, navigation = {}) => {
      const bookIds = new Set(books.map(book => book.id));
      return chapterFolders(chapterGroups(items.filter(item => bookIds.has(item.id)),
        items.filter(item => !bookIds.has(item.id))), id, navigation);
    }, {removeBreadcrumbs: true});
    access.replaceChildren(panel('Study Materials', courseContent),
      panel('Course Documents', el('div', {class: 'actions'}, receipt), receiptFeedback),
      panel('Course Discussion', messageList, form));
    testAccess.replaceChildren(panel('Practice & Live Tests', testsContent));
  });
}

function showManualPayment(target, ctx, session, course, path, action) {
  loadInto(target, ctx, async () => {
    const {amount, credits = 0, payment, order} = await api(`${path}/payment`, {ctx, auth: true});
    if (order?.status === 'pending') {
      const refresh = button('Check Approval Status', 'secondary');
      const feedback = status();
      refresh.addEventListener('click', () => run(refresh, feedback, async () => {
        await action.refreshProfile(session);
        if (owns(session.me, course.id)) action.purchased(course.title);
        else showManualPayment(target, ctx, session, course, path, action);
      }, 'Checking status…'));
      target.replaceChildren(el('div', {class: 'payment-status pending'},
        el('span', {class: 'status-icon', 'aria-hidden': 'true'}, '◷'), el('h2', {}, 'Payment Submitted'),
        el('p', {}, 'Awaiting Admin Approval'),
        el('p', {}, 'Your request is with the admin. Course access is unlocked after confirmation.'),
        el('dl', {class: 'payment-summary'}, el('dt', {}, 'Amount'), el('dd', {}, priceText(order.amount)),
          el('dt', {}, 'UPI reference'), el('dd', {}, order.reference)), refresh, feedback));
      return;
    }
    if (!payment.configured && credits * 100 < amount) {
      target.replaceChildren(el('div', {class: 'payment-status'},
        el('p', {class: 'muted'}, order?.status === 'rejected' ? 'Rejected' : 'Not Purchased'),
        order?.status === 'rejected' ? el('p', {class: 'rejection'}, order.reviewNote || 'Check the payment and submit again.') : null,
        el('h2', {}, 'Payments Are Being Configured'),
        el('p', {}, 'UPI details are not available yet. Contact support before making a payment.'),
        link('Contact Support', '#support', 'button secondary')));
      return;
    }
    const methodButtons = el('div', {class: 'payment-methods', role: 'group', 'aria-label': 'Choose a payment method'});
    const methodPanel = el('div');
    const renderMethod = method => {
      methodButtons.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.method === method)));
      if (method === 'upi') {
        methodPanel.replaceChildren(el('div', {class: 'upi-details'},
          el('span', {}, 'UPI ID'), el('strong', {}, payment.upiId), el('small', {}, `Payee: ${payment.payeeName}`)));
      } else {
        methodPanel.replaceChildren(el('div', {class: 'qr-card'}, el('img', {src: payment.qr,
          alt: `Payment QR for ${payment.payeeName || 'Mission Selection'}`, width: '220', height: '220'}),
          el('strong', {}, payment.payeeName || 'Mission Selection'),
          el('small', {}, 'Scan using your UPI application')));
      }
    };
    const methods = [];
    if (payment.configured) {
      if (payment.method !== 'qr' && payment.upiId) methods.push('upi');
      if (payment.method === 'qr' || payment.upiId || payment.customQr) methods.push('qr');
    }
    for (const method of methods) {
      const control = button(method === 'upi' ? 'Pay by UPI ID' : 'Scan QR Code', 'secondary');
      control.dataset.method = method;
      control.addEventListener('click', () => renderMethod(method));
      methodButtons.append(control);
    }
    const reference = upiReference(el('input', {required: '', maxlength: '80', autocomplete: 'off', placeholder: 'Example: 418276930125'}));
    const useCredits = el('input', {type: 'checkbox'});
    if (!payment.configured) {
      useCredits.checked = true;
      useCredits.disabled = true;
    }
    const creditPanel = credits > 0 ? el('label', {class: 'credit-option'},
      useCredits, el('span', {}, `Use available credits: ₹${credits}`)) : null;
    const note = el('textarea', {rows: '2', maxlength: '500', placeholder: 'Optional note from your payment app'});
    const submit = button('Submit for Admin Approval', null, 'submit');
    const feedback = status();
    const amountMessage = el('p', {class: 'due-amount'});
    const updateAmount = () => {
      const due = Math.max(0, amount - (useCredits.checked ? Math.min(credits, Math.ceil(amount / 100)) * 100 : 0));
      amountMessage.textContent = `Amount to pay: ${priceText(due)}`;
      reference.required = due > 0;
      reference.closest('.field').hidden = due === 0;
    };
    useCredits.addEventListener('change', updateAmount);
    const form = el('form', {class: 'payment-proof'}, creditPanel, amountMessage,
      field('UPI Transaction Reference', reference, 'Copy the reference shown after your payment succeeds.'),
      field('Payment Note (optional)', note), submit, feedback);
    bindForm(form, submit, feedback, async () => {
      const result = await api(`${path}/payment`, {ctx, auth: true, method: 'POST',
        json: {reference: reference.required ? textValue(reference, 'UPI transaction reference') : reference.value.trim(),
          note: note.value.trim(), useCredits: useCredits.checked}});
      if (result.status === 'approved') {
        await action.refreshProfile(session);
        action.purchased(course.title);
        return;
      }
      showManualPayment(target, ctx, session, course, path, action);
    }, 'Submitting payment…');
    target.replaceChildren(el('div', {class: 'manual-payment'},
      el('div', {class: 'payment-steps'}, el('span', {}, '1'),
        el('div', {}, el('h2', {}, `Pay ${priceText(amount)}`),
          !order ? el('p', {class: 'muted'}, 'Not Purchased') : null,
          el('p', {class: 'muted'}, order?.status === 'rejected' ? 'Rejected' : 'Payment Pending'),
          el('p', {class: 'muted'}, payment.configured ? `Use your preferred UPI app to pay ${payment.payeeName}.` :
            'Your available credits cover this course. Submit the request for admin approval.'))),
      el('div', {class: 'payment-grid'},
        el('div', {class: 'payment-choice'}, methodButtons, methodPanel),
        el('div', {class: 'payment-instructions'}, el('h3', {}, 'After Paying'),
          el('ol', {}, el('li', {}, 'Keep the successful payment screen or SMS.'),
            el('li', {}, 'Copy its transaction reference.'), el('li', {}, 'Submit the reference below for admin approval.')),
          order?.status === 'rejected' ? el('div', {class: 'rejection', role: 'alert'},
            el('strong', {}, 'Payment Not Approved'), el('p', {}, order.reviewNote || 'Check the payment and submit again.')) : null)),
      el('div', {class: 'payment-form-panel'}, el('span', {}, '2'),
        el('div', {}, el('h3', {}, 'Submit Payment Proof'), form))));
    if (methods.length) renderMethod(methods[0]);
    updateAmount();
  });
}
