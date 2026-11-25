import {api} from './services.js';
import {button, el, field, heading, idPart, run, say, status, textValue} from './ui.js';

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
      return el('li', {class: 'workspace-folder'},
        el('details', {open: ''},
          el('summary', {}, el('strong', {}, folder.name),
            el('span', {class: 'muted'}, `${items.filter(item => item.folderId === folder.id).length} items`)),
          folderForm,
          children.length ? el('ul', {class: 'workspace-folder-list'}, ...children) : null));
    });

    const tree = renderTree('');
    const folderSection = el('section', {class: 'panel folder-manager'},
      el('h2', {}, 'Folders'),
      folderForm,
      tree.length ? el('ul', {class: 'workspace-folder-list'}, ...tree) :
        el('p', {class: 'muted'}, 'No folders yet. Create one above; folders can be nested.'),
      folders.length ? button('Refresh', 'secondary') : null);
    const rootRefresh = folderSection.querySelector('button[type="button"]');
    rootRefresh?.addEventListener('click', () => run(rootRefresh, feedback, load, 'Refreshing folders…'));
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
      const move = button('Move', 'secondary');
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
