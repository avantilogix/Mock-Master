import {api} from './services.js';
import {button, el, heading, link, loadInto, panel, status, run, say} from './ui.js';

const appUrl = 'https://mission-selection-ba819.web.app/';
const playUrl = 'https://play.google.com/store/apps/details?id=com.avantilogix.missionselection';

export function showShareRate(main) {
  main.append(...heading('Share Mission Selection', 'Help a friend prepare, or rate the app after your experience.'));
  const feedback = status();
  const share = button('Share app', null);
  const rate = link('Rate app', playUrl, 'button secondary');
  rate.target = '_blank';
  rate.rel = 'noopener noreferrer';
  share.addEventListener('click', () => run(share, feedback, async () => {
    if (navigator.share) {
      await navigator.share({title: 'Mission Selection', text: 'Prepare smarter with Mission Selection.', url: appUrl});
      say(feedback, 'Thanks for sharing Mission Selection.');
      return;
    }
    await navigator.clipboard.writeText(`${appUrl} Prepare smarter with Mission Selection.`);
    say(feedback, 'App link copied. Share it with your friends.');
  }, ''));
  main.append(panel('Support the community', el('p', {}, 'Share the app with classmates or leave a review on Google Play.'),
    el('div', {class: 'actions'}, share, rate), feedback));
}

export function showCourseGroups(main, ctx, me, action) {
  main.append(...heading('Course discussions', 'Private text groups for purchased courses only.'));
  if (!ctx.user) {
    main.append(panel('Purchased course groups', el('p', {}, 'Sign in to see the groups unlocked on your account.'),
      action.signInLink()));
    return;
  }
  const groups = el('div', {class: 'group-list'});
  main.append(groups);
  loadInto(groups, ctx, async () => {
    const courses = (await api('/courses', {ctx})).filter(course =>
      me?.purchases?.some(id => String(id) === String(course.id)));
    groups.replaceChildren(...(courses.length ? courses.map(course => el('a',
      {class: 'group-card', href: `#course/${encodeURIComponent(course.id)}`},
      el('span', {class: 'group-avatar', 'aria-hidden': 'true'}, course.title.slice(0, 1)),
      el('div', {}, el('strong', {}, course.title), el('p', {class: 'muted'},
        'Purchased members only · ask questions and share study tips')),
      el('span', {class: 'group-arrow', 'aria-hidden': 'true'}, '→'))) :
      [el('div', {class: 'empty-library'}, el('h2', {}, 'No purchased groups yet'),
        el('p', {class: 'muted'}, 'Purchase a course to join its protected discussion group.'),
        link('Browse missions', '#catalog', 'button'))]));
  });
}

export function showVideos(main) {
  main.append(...heading('YouTube Videos', 'Learn from videos published by the Mission Selection team.'));
  const list = el('div', {class: 'video-grid'});
  main.append(list);
  loadInto(list, {current: () => true}, async () => {
    const rows = await api('/videos');
    list.replaceChildren(...(rows.length ? rows.map(video => el('article', {class: 'video-card'},
      el('div', {class: 'video-frame'},
        el('iframe', {src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(video.videoId)}`,
          title: video.title, loading: 'lazy',
          allow: 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
          allowfullscreen: '', referrerpolicy: 'strict-origin-when-cross-origin'})),
      el('div', {class: 'video-copy'}, el('span', {class: 'badge'}, video.courseTitle || 'Mission Selection'),
        el('h2', {}, video.title), el('p', {class: 'muted'}, video.description)))) :
      [el('div', {class: 'empty-library'}, el('h2', {}, 'Videos coming soon'),
        el('p', {class: 'muted'}, 'New lessons will appear here after the admin publishes them.'))]));
  });
}
