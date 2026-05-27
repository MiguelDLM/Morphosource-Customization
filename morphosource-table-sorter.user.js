// ==UserScript==
// @name         MorphoSource Generic Table Sorter
// @namespace    https://www.morphosource.org/
// @version      0.1
// @description  Sort static tables on MorphoSource dynamically by clicking on column headers.
// @author       Antigravity
// @match        https://www.morphosource.org/dashboard/my/*
// @match        https://www.morphosource.org/dashboard/my/cart*
// @match        https://www.morphosource.org/concern/*
// @run-at       document-end
// ==/UserScript==

(function() {
  'use strict';

  // Premium CSS styling for sorting headers and hover states
  const STYLE = `
    .ms-sortable {
      cursor: pointer !important;
      position: relative !important;
      user-select: none !important;
      transition: background-color 0.2s ease, color 0.2s ease !important;
    }
    .ms-sortable:hover {
      background-color: rgba(0, 123, 255, 0.08) !important;
      color: #0056b3 !important;
    }
    .ms-sort-icon {
      display: inline-block;
      vertical-align: middle;
      margin-left: 6px;
      opacity: 0.25;
      transition: transform 0.2s ease, opacity 0.2s ease, color 0.2s ease;
      color: currentColor;
    }
    .ms-sortable:hover .ms-sort-icon {
      opacity: 0.6;
    }
    th[aria-sort="ascending"] .ms-sort-icon {
      opacity: 1 !important;
      transform: rotate(180deg);
      color: #007bff !important;
    }
    th[aria-sort="descending"] .ms-sort-icon {
      opacity: 1 !important;
      transform: rotate(0deg);
      color: #007bff !important;
    }
  `;

  const CHEVRON_SVG = `
    <svg class="ms-sort-icon" viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
  `;

  function injectStyle() {
    if (document.getElementById('ms-table-sort-style')) return;
    const s = document.createElement('style');
    s.id = 'ms-table-sort-style';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  // Get clean text contents for sorting, filtering out screen reader text and status badges
  function cellText(td) {
    if (!td) return '';
    const titleLink = td.querySelector('a.document-title');
    if (titleLink) {
      const clone = titleLink.cloneNode(true);
      clone.querySelectorAll('.sr-only, .badge').forEach(el => el.remove());
      return clone.textContent.trim();
    }
    const link = td.querySelector('a');
    if (link) {
      const clone = link.cloneNode(true);
      clone.querySelectorAll('.sr-only, .badge').forEach(el => el.remove());
      return clone.textContent.trim();
    }
    const clone = td.cloneNode(true);
    clone.querySelectorAll('.sr-only, .badge').forEach(el => el.remove());
    return clone.textContent.trim();
  }

  // Check data type of cell content dynamically
  function detectColumnType(table, colIndex, th) {
    const thText = th.textContent.trim().toLowerCase();
    if (th.querySelector('input[type="checkbox"]') || th.classList.contains('check-all')) {
      return 'none';
    }
    if (thText === 'action' || (thText.includes('translation missing') && thText.includes('.action'))) {
      return 'none';
    }
    // Check if it's the second column and empty (commonly thumbnail/image on MorphoSource lists)
    if (thText === '' && colIndex === 1) {
      return 'none';
    }

    const rows = Array.from(table.querySelectorAll('tbody > tr'));
    if (rows.length === 0) return 'text';

    let isNumeric = true;
    let isDate = true;
    let isNone = true;
    let sampleCount = 0;

    for (let r = 0; r < Math.min(rows.length, 10); r++) {
      const cell = rows[r].children[colIndex];
      if (!cell) continue;

      const text = cellText(cell);
      if (text !== '') {
        isNone = false;
        sampleCount++;

        // Strict numeric check (strip spaces, commas, and currency symbols)
        const cleanNum = text.replace(/[\s,$€£¥]/g, '');
        const isNum = /^-?\d+(\.\d+)?$/.test(cleanNum) || /^-?\.\d+$/.test(cleanNum);
        if (!isNum) {
          isNumeric = false;
        }

        // Date format check (YYYY-MM-DD, MM/DD/YYYY, or Month DD, YYYY)
        const isDateFormat = /^\d{4}[-\/.]\d{1,2}[-\/.]\d{1,2}/.test(text) || 
                             /^\d{1,2}[-\/.]\d{1,2}[-\/.]\d{4}/.test(text) ||
                             /^[A-Za-z]{3,9}\s+\d{1,2},\s+\d{4}/.test(text);
        const ts = Date.parse(text);
        if (!isDateFormat || isNaN(ts)) {
          isDate = false;
        }
      } else {
        // If text is empty but contains interactive nodes, check if it's a structural column
        if (cell.querySelector('input[type="checkbox"]') || cell.querySelector('img') || cell.querySelector('button') || cell.querySelector('.btn')) {
          // Keep as is, it could still be a 'none' column
        } else {
          isNone = false;
        }
      }
    }

    if (sampleCount === 0 && isNone) {
      return 'none';
    }

    if (isDate && sampleCount > 0) return 'date';
    if (isNumeric && sampleCount > 0) return 'number';

    return 'text';
  }

  function parseValueByType(val, type) {
    if (type === 'number') {
      const clean = val.replace(/[\s,$€£¥]/g, '');
      const n = parseFloat(clean);
      return isNaN(n) ? Number.NEGATIVE_INFINITY : n;
    }
    if (type === 'date') {
      const ts = Date.parse(val);
      return isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
    }
    // Natural alphanumeric sorting (lowercase, stripped of accents/diacritics)
    return val.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function getThIndex(th) {
    let idx = 0;
    let n = th;
    while ((n = n.previousElementSibling)) {
      if (n.tagName === 'TH') idx++;
    }
    return idx;
  }

  function clearAriaSort(ths) {
    ths.forEach(t => t.removeAttribute('aria-sort'));
  }

  function makeSortable(table) {
    if (!table || table.dataset.msSortable === '1') return;
    const thead = table.querySelector('thead');
    const tbody = table.querySelector('tbody');
    if (!thead || !tbody) return;

    const ths = Array.from(thead.querySelectorAll('th'));
    ths.forEach((th, i) => {
      const type = detectColumnType(table, i, th);
      if (type === 'none') return;

      th.classList.add('ms-sortable');
      th.setAttribute('role', 'button');
      th.setAttribute('tabindex', '0');
      th.dataset.msSortType = type;

      // Append Chevron SVG icon if not already present
      if (!th.querySelector('.ms-sort-icon')) {
        th.insertAdjacentHTML('beforeend', CHEVRON_SVG);
      }

      const handler = (ev) => {
        if (ev.type === 'click' || (ev.type === 'keydown' && (ev.key === 'Enter' || ev.key === ' '))) {
          ev.preventDefault();
          const idx = getThIndex(th);
          const sortType = th.dataset.msSortType || 'text';
          const currentDir = th.getAttribute('aria-sort');
          const newDir = currentDir === 'ascending' ? 'descending' : 'ascending';

          // Reset other headers' sort state
          clearAriaSort(ths);
          th.setAttribute('aria-sort', newDir);

          // Collect rows and decorate with stable index
          const rows = Array.from(tbody.querySelectorAll('tr'));
          const decorated = rows.map((row, pos) => {
            const td = row.children[idx];
            const val = cellText(td);
            const parsed = parseValueByType(val, sortType);
            return { row, key: parsed, pos };
          });

          // Sort decorated entries
          decorated.sort((a, b) => {
            const dir = newDir === 'ascending' ? 1 : -1;
            if (a.key < b.key) return -1 * dir;
            if (a.key > b.key) return 1 * dir;
            // Stable sort fallback
            return (a.pos - b.pos);
          });

          // Reinsert rows in order (preserves event listeners, inputs, checkbox checked states)
          const frag = document.createDocumentFragment();
          decorated.forEach(d => frag.appendChild(d.row));
          tbody.appendChild(frag);
        }
      };

      th.addEventListener('click', handler);
      th.addEventListener('keydown', handler);
    });

    table.dataset.msSortable = '1';
  }

  function enhanceAll() {
    injectStyle();
    // Match standard tables on dashboard
    const tables = Array.from(document.querySelectorAll('table.table, table.works-list'));
    tables.forEach(makeSortable);
  }

  // Run on load
  enhanceAll();

  // Watch for dynamic updates (navigating tabs, pagination, rows per page changes)
  const observer = new MutationObserver(() => enhanceAll());
  observer.observe(document.body, { childList: true, subtree: true });

  // Re-run periodically to cover edge cases
  setTimeout(enhanceAll, 500);
  setTimeout(enhanceAll, 1500);
})();
