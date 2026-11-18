import { t } from './i18n.js';

export function paginate(container, controls, items, limit) {
  let page = 0;
  const pages = Math.max(1, Math.ceil(items.length / limit));
  controls.replaceChildren();
  if (pages === 1) return;
  const previous = document.createElement('button');
  const next = document.createElement('button');
  const count = document.createElement('span');
  previous.type = next.type = 'button';
  previous.className = next.className = 'ghost';
  previous.textContent = t('Previous');
  next.textContent = t('Next');
  count.setAttribute('aria-live', 'polite');
  controls.append(previous, count, next);

  function show() {
    for (const [index, item] of items.entries()) item.hidden = Math.floor(index / limit) !== page;
    count.textContent = (page + 1) + ' / ' + pages;
    previous.disabled = page === 0;
    next.disabled = page === pages - 1;
    container.scrollTop = 0;
  }

  previous.onclick = () => { if (page > 0) { page--; show(); } };
  next.onclick = () => { if (page < pages - 1) { page++; show(); } };
  show();
}
