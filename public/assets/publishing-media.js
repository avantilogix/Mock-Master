import {api} from './services.js';
import {button, el, field, rule} from './ui.js';

const imageUrl = id => `/api/publishing-images/${encodeURIComponent(id)}`;

export function coverPicker(ctx, {existing = [], required = false} = {}) {
  const file = rule(el('input', {type: 'file', multiple: '', accept: '.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp',
    required: required ? '' : null}), (_, control) => {
    const files = [...control.files];
    if (files.length > 8) return 'Choose no more than 8 images.';
    if (files.some(item => !/\.(jpe?g|png|webp)$/i.test(item.name) || item.size > 6 * 1024 * 1024)) {
      return 'Choose JPEG, PNG, or WebP images no larger than 6 MB each.';
    }
    return '';
  });
  const node = field('Cover Images', file, existing.length ?
    `Current gallery: ${existing.length} images. Select 1–8 images to replace it, or leave blank to keep it.` :
    `${required ? 'Add' : 'Optional: add'} 1–8 JPEG, PNG, or WebP images (6 MB each). These are visible to students.`);
  const feedback = el('p', {class: 'muted cover-selection', role: 'status'});
  node.append(feedback);
  const clear = () => { file.value = ''; feedback.textContent = ''; };
  file.addEventListener('change', () => {
    feedback.textContent = file.files.length ? `${file.files.length} selected: ${[...file.files].map(item => item.name).join(', ')}` : '';
  });
  return {
    node, file, clear,
    async upload() {
      const files = [...file.files];
      if (!files.length) return undefined;
      const ids = [];
      for (const [index, binary] of files.entries()) {
        feedback.textContent = `Uploading image ${index + 1} of ${files.length}…`;
        try {
          ids.push((await api('/admin/publishing-images', {ctx, auth: true, method: 'POST', binary})).id);
        } catch (error) {
          feedback.textContent = '';
          throw error;
        }
      }
      feedback.textContent = `${files.length} image${files.length === 1 ? '' : 's'} ready.`;
      if (new Set(ids).size !== ids.length) throw new Error('Choose different images for the gallery.');
      return ids;
    },
  };
}

export function coverGallery(item, className = '') {
  const images = item.images || [];
  if (!images.length) return null;
  const photos = images.map((id, index) => el('img', {class: 'cover-photo', src: imageUrl(id),
    alt: `${item.title} — ${images.length === 1 ? 'cover image' : `image ${index + 1} of ${images.length}`}`,
    loading: 'lazy', decoding: 'async', draggable: 'false'}));
  const gallery = el('div', {class: `cover-gallery ${className}`});
  if (images.length === 1) {
    gallery.append(photos[0]);
    return gallery;
  }
  const track = el('div', {class: 'cover-track', tabindex: '0', role: 'group', 'aria-label': `Images for ${item.title}`}, photos);
  const back = button('‹', 'secondary');
  const next = button('›', 'secondary');
  back.setAttribute('aria-label', 'Previous image');
  next.setAttribute('aria-label', 'Next image');
  const label = el('span', {class: 'cover-position', role: 'status'});
  let position = 0;
  const update = index => {
    position = index;
    back.disabled = index === 0;
    next.disabled = index === images.length - 1;
    label.textContent = `${index + 1} / ${images.length}`;
  };
  const go = step => {
    const index = Math.max(0, Math.min(images.length - 1, position + step));
    track.scrollTo({left: track.clientWidth * index});
    update(index);
  };
  track.addEventListener('scroll', () => {
    if (track.clientWidth) update(Math.round(track.scrollLeft / track.clientWidth));
  }, {passive: true});
  back.addEventListener('click', () => go(-1));
  next.addEventListener('click', () => go(1));
  update(0);
  gallery.append(track, el('div', {class: 'cover-controls'}, back, label, next));
  return gallery;
}
