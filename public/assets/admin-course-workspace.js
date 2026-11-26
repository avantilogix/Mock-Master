import {api} from './services.js';
import {coverPicker} from './publishing-media.js';
import {maxVideoBytes, uploadChapterVideo, videoAccept, videoType} from './chapter-upload.js';
import {bindForm, button, el, field, heading, icon, idPart, link, rule, run, say, status, textValue} from './ui.js?v=workspace-refresh-v1';

const kinds = [
  {id: 'content', label: 'Course Content'},
  {id: 'tests', label: 'Mock Tests'},
];

export function showAdminCourseWorkspace(main, ctx, courseId) {
  const feedback = status();
  const tabs = el('div', {class: 'tabs workspace-tabs', role: 'tablist', 'aria-label': 'Course workspace'},
    ...kinds.map(({id, label}) => {
      const tab = button(label, 'tab-button');
      tab.type = 'button';
      tab.dataset.kind = id;
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => {
        if (activeKind !== id) {
          activeKind = id;
          run(tab, feedback, load, 'Loading workspace…');
        }
      });
      return tab;
    }));
  const contents = el('div', {class: 'course-workspace'});
  main.append(...heading('Course Workspace', 'Organize course materials and mock tests with nested folders.'),
    tabs, feedback, contents);

  let activeKind = 'content';
  let workspace;
  const coursePath = `/admin/courses/${idPart(courseId)}`;

  async function load() {
    workspace = await api(`${coursePath}/workspace?kind=${activeKind}`, {ctx, auth: true});
    if (ctx.current()) {
      render();
      say(feedback, '');
    }
  }

  function render() {
    const folders = Array.isArray(workspace?.folders) ? workspace.folders : [];
    const items = Array.isArray(workspace?.items) ? workspace.items : [];
    const foldersById = new Map(folders.map(folder => [folder.id, folder]));
    const folderLabel = folder => {
      const names = [folder.name];
      const seen = new Set([folder.id]);
      let parent = foldersById.get(folder.parentId);
      while (parent && !seen.has(parent.id)) {
        seen.add(parent.id);
        names.unshift(parent.name);
        parent = foldersById.get(parent.parentId);
      }
      return names.join(' / ');
    };
    const byParent = new Map();
    for (const folder of folders) {
      const parent = folder.parentId || '';
      if (!byParent.has(parent)) byParent.set(parent, []);
      byParent.get(parent).push(folder);
    }
    for (const children of byParent.values()) children.sort((a, b) => a.name.localeCompare(b.name));

    for (const tab of tabs.children) {
      const selected = tab.dataset.kind === activeKind;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    }

    const folderOptions = [
      el('option', {value: ''}, 'Course root'),
      ...folders.map(folder => el('option', {value: folder.id}, folderLabel(folder))),
    ];
    const folderForm = el('form', {class: 'folder-create-form'},
      field('New Folder Name', el('input', {required: '', maxlength: '100', autocomplete: 'off'})),
      field('Create Inside', el('select', {}, ...folderOptions.map(option => option.cloneNode(true)))),
      button('Create Folder', null, 'submit'));
    const rootRefresh = button('', 'secondary icon-button workspace-refresh');
    rootRefresh.setAttribute('aria-label', 'Refresh folders and content');
    rootRefresh.title = 'Refresh folders and content';
    rootRefresh.prepend(icon('refresh', 'line-icon'));
    rootRefresh.addEventListener('click', () => run(rootRefresh, feedback, load, 'Refreshing folders…'));
    const nameInput = folderForm.querySelector('input');
    const parentSelect = folderForm.querySelector('select');
    const createButton = folderForm.querySelector('button');
    const renderTree = parentId => (byParent.get(parentId) || []).map(folder => {
      const renameInput = el('input', {required: '', maxlength: '100', value: folder.name, 'aria-label': `Folder name: ${folder.name}`});
      const descendants = new Set([folder.id]);
      const collectDescendants = id => {
        for (const child of byParent.get(id) || []) {
          descendants.add(child.id);
          collectDescendants(child.id);
        }
      };
      collectDescendants(folder.id);
      const parentChoice = el('select', {'aria-label': `Parent folder for ${folder.name}`},
        el('option', {value: ''}, 'Course root'),
        ...folders.filter(candidate => !descendants.has(candidate.id))
          .map(candidate => el('option', {value: candidate.id}, folderLabel(candidate))));
      parentChoice.value = folder.parentId || '';
      const save = button('Save', 'secondary', 'submit');
      const folderForm = el('form', {class: 'folder-edit-form'},
        field('Name', renameInput), field('Move inside', parentChoice), save);
      folderForm.addEventListener('submit', event => {
        event.preventDefault();
        run(save, feedback, async () => {
          await api(`${coursePath}/folders/${idPart(folder.id)}`, {ctx, auth: true, method: 'PATCH',
            json: {name: textValue(renameInput, 'Folder name'), parentId: parentChoice.value || null}});
          await load();
          say(feedback, 'Folder updated.');
        }, 'Saving folder…');
      });
      const children = renderTree(folder.id);
      let uploadForm = null;
      if (activeKind === 'content') {
        const title = el('input', {required: '', maxlength: '120'});
        const subject = el('input', {required: '', maxlength: '100', value: 'General'});
        const chapter = el('input', {required: '', maxlength: '120', value: 'Chapter 1'});
        const type = el('select', {}, el('option', {value: 'pdf'}, 'PDF Study Book'),
          el('option', {value: 'video'}, 'Chapter Video'));
        const pdf = rule(el('input', {type: 'file', accept: '.pdf,application/pdf', required: ''}),
          (_, control) => {
            const file = control.files[0];
            if (type.value === 'pdf') return /\.pdf$/i.test(file?.name || '') ? '' : 'Choose a PDF file.';
            if (!videoType(file)) return 'Choose an MP4, WebM, or MOV video.';
            return file.size < 12 || file.size > maxVideoBytes ? 'Choose a non-empty video up to 300 MB.' : '';
          });
        const covers = ctx.publishingMedia ? coverPicker(ctx) : null;
        const upload = button('Upload PDF to Folder', null, 'submit');
        const uploadFeedback = status();
        const fileField = field('PDF File', pdf, 'PDF pages are protected and watermarked.');
        type.addEventListener('change', () => {
          const video = type.value === 'video';
          pdf.value = '';
          pdf.accept = video ? videoAccept : '.pdf,application/pdf';
          pdf.dataset.label = video ? 'Video File' : 'PDF File';
          fileField.querySelector('label').textContent = pdf.dataset.label;
          fileField.querySelector(`#${pdf.id}-hint`).textContent = video ?
            'MP4, WebM, or MOV, up to 300 MB.' : 'PDF pages are protected and watermarked.';
          upload.textContent = video ? 'Upload Video to Folder' : 'Upload PDF to Folder';
          if (covers) {
            covers.node.hidden = video;
            covers.file.disabled = video;
          }
        });
        uploadForm = el('form', {class: 'section'}, field('Content Type', type), field('Title', title), field('Subject', subject),
          field('Chapter', chapter), fileField,
          covers?.node, upload, uploadFeedback);
        bindForm(uploadForm, upload, uploadFeedback, async () => {
          const placement = {title: textValue(title, 'Title'), subject: textValue(subject, 'Subject'),
            chapter: textValue(chapter, 'Chapter'), folderId: folder.id};
          const query = new URLSearchParams(placement);
          const file = pdf.files[0];
          const video = type.value === 'video';
          if (video) {
            await uploadChapterVideo({ctx, coursePath, placement, file,
              post: (path, body) => api(path, {ctx, auth: true, method: 'POST', ...body}),
              onPublish: () => say(uploadFeedback, 'Publishing video…')});
          } else {
            const images = await covers?.upload();
            if (images) query.set('images', images.join(','));
            await api(`${coursePath}/books?${query}`, {ctx, auth: true, method: 'POST', binary: file});
          }
          uploadForm.reset();
          covers?.clear();
          type.dispatchEvent(new Event('change'));
          try {
            await load();
            say(feedback, `${video ? 'Video' : 'PDF'} uploaded to the folder.`);
          } catch (error) {
            if (error.name === 'AbortError') throw error;
            say(feedback, `${video ? 'Video' : 'PDF'} uploaded, but the workspace could not refresh: ${error.message}`, true);
          }
        }, 'Uploading PDF…');
      }
      return el('li', {class: 'workspace-folder'},
        el('details', {open: ''},
          el('summary', {}, el('strong', {}, folder.name),
            el('span', {class: 'muted'}, `${items.filter(item => item.folderId === folder.id).length} items`)),
          folderForm,
          uploadForm,
          activeKind === 'tests' ? link('Import Questions to Folder',
            `#admin-publish-test/${idPart(courseId)}/${idPart(folder.id)}`, 'button secondary') : null,
          children.length ? el('ul', {class: 'workspace-folder-list'}, ...children) : null));
    });

    const tree = renderTree('');
    const folderSection = el('section', {class: 'panel folder-manager'},
      el('div', {class: 'folder-manager-heading'}, el('h2', {}, 'Folders'), rootRefresh),
      folderForm,
      tree.length ? el('ul', {class: 'workspace-folder-list'}, ...tree) :
        el('p', {class: 'muted'}, 'No folders yet. Create one above; folders can be nested.'));
    folderForm.addEventListener('submit', event => {
      event.preventDefault();
      run(createButton, feedback, async () => {
        await api(`${coursePath}/folders`, {ctx, auth: true, method: 'POST',
          json: {kind: activeKind, name: textValue(nameInput, 'Folder name'), parentId: parentSelect.value || null}});
        await load();
        say(feedback, 'Folder created.');
      }, 'Creating folder…');
    });

    const itemRows = items.map(item => {
      const destination = el('select', {'aria-label': `Move ${item.title} to folder`},
        el('option', {value: ''}, 'Course root'),
        ...folders.map(folder => el('option', {value: folder.id}, folderLabel(folder))));
      destination.value = item.folderId || '';
      const move = button('', 'secondary workspace-move');
      move.setAttribute('aria-label', `Move ${item.title} to selected folder`);
      move.title = 'Move to selected folder';
      move.prepend(icon('move', 'line-icon'));
      move.addEventListener('click', () => run(move, feedback, async () => {
        await api(`${coursePath}/workspace-items/${encodeURIComponent(item.type)}/${idPart(item.id)}`,
          {ctx, auth: true, method: 'PATCH', json: {folderId: destination.value || null}});
        await load();
        say(feedback, 'Item moved.');
      }, 'Moving item…'));
      return el('article', {class: 'workspace-item'},
        el('div', {}, el('strong', {}, item.title), el('span', {class: 'badge'}, item.type)),
        el('div', {class: 'actions'}, destination, move));
    });
    const itemSection = el('section', {class: 'panel folder-manager'},
      el('h2', {}, activeKind === 'content' ? 'Course Content' : 'Mock Tests'),
      itemRows.length ? el('div', {class: 'workspace-item-list'}, ...itemRows) :
        el('p', {class: 'muted'}, activeKind === 'content' ?
          'No books or chapter videos are linked to this course yet.' : 'No tests are linked to this course yet.'));
    contents.replaceChildren(folderSection, itemSection);
  }

  run(contents, feedback, load, 'Loading course workspace…');
}
