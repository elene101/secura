export function mountViews(root, { hash = false, initial } = {}) {
  const within = selector => [...root.querySelectorAll(selector)].filter(item => item.closest('[data-views]') === root);
  const tabs = within('[data-tab]');
  const panels = within('[data-view]');
  if (!tabs.length || !panels.length) return null;
  let active;

  function show(name, { focus = false, updateHash = false } = {}) {
    const available = panels.find(panel => panel.dataset.view === name);
    const value = available ? name : panels[0].dataset.view;
    const changed = active !== value;
    active = value;
    root.dataset.activeView = value;
    for (const panel of panels) panel.hidden = panel.dataset.view !== value;
    for (const tab of tabs) {
      const selected = tab.dataset.tab === value;
      tab.setAttribute('aria-selected', selected);
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus({ preventScroll: true });
    }
    if (changed && (root === document.body || root.matches('main'))) {
      const scroller = root === document.body ? root.querySelector('main') : root;
      if (scroller) scroller.scrollTop = 0;
    }
    if (hash && updateHash && location.hash !== '#' + value) {
      history.pushState(null, '', '#' + value);
    }
    return available;
  }

  const visibleTab = () => tabs.find(tab => tab.dataset.tab === active && !tab.hidden);
  for (const tab of tabs) {
    const panel = panels.find(panel => panel.dataset.view === tab.dataset.tab);
    if (!panel) continue;
    tab.setAttribute('role', 'tab');
    tab.id ||= panel.id + '-tab';
    tab.setAttribute('aria-controls', panel.id);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
  }

  root.addEventListener('click', event => {
    const tab = event.target.closest('[data-tab]');
    if (!tabs.includes(tab) || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    show(tab.dataset.tab, { focus: true, updateHash: true });
  });

  root.addEventListener('keydown', event => {
    const available = tabs.filter(tab => !tab.hidden);
    if (!available.includes(event.target)) return;
    const offset = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!offset && !['Home', 'End', ' '].includes(event.key)) return;
    event.preventDefault();
    const index = available.indexOf(event.target);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? available.length - 1 :
      offset ? (index + offset + available.length) % available.length : index;
    show(available[next].dataset.tab, { focus: true, updateHash: true });
  });

  if (hash) window.addEventListener('hashchange', () => show(location.hash.slice(1)));
  show((hash && location.hash.slice(1)) || initial);
  return { show, current: () => active, focus: () => visibleTab()?.focus() };
}
