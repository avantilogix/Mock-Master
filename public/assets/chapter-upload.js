import {idPart} from './ui.js';

export const videoAccept = '.mp4,.m4v,.webm,.mov,video/mp4,video/webm,video/quicktime';
export const maxVideoBytes = 300 * 1024 * 1024;
const videoTypes = {mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime'};
export const videoType = file => file && (Object.values(videoTypes).includes(file.type) ? file.type :
  videoTypes[file.name.split('.').pop().toLowerCase()]);

export async function uploadChapterVideo({ctx, post, coursePath, placement, file, onPublish}) {
  const type = videoType(file);
  const {id, url, headers, direct} = await post(`${coursePath}/videos/upload`,
    {json: {...placement, type, size: file.size}});
  if (direct) {
    await post(`${coursePath}/videos?${new URLSearchParams(placement)}`, {binary: file, imageUpload: type});
    return;
  }
  const response = await fetch(url, {method: 'PUT', headers: {...headers, 'Content-Type': type},
    body: file, signal: ctx.signal, credentials: 'omit', redirect: 'error'});
  if (!response.ok) throw new Error(`The video could not be uploaded (${response.status}). Please try again.`);
  onPublish?.();
  await post(`${coursePath}/videos/${idPart(id)}/publish`, {json: {}});
}
