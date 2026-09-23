import { parseCodes } from './cohort.js?v=d8068fd47f0c';

const PAGE_SIZE = 50;
const MAX_CODES = 500;
const catalogs = new Map();
const bundled = new Set(['DX', 'PCS', 'HCPCS', 'DRG']);
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const codeTokens = (text, domain) => parseCodes(text, domain).map(row => row.code + (row.match === 'PREFIX' ? '*' : ''));

export function searchCodes(rows, query, group = '') {
  const terms = query.toUpperCase().trim().split(/\s+/).filter(Boolean);
  const codeQuery = terms.length === 1 && /[0-9]/.test(terms[0]) ? terms[0].replaceAll('.', '') : null;
  return rows.filter(row => (!group || row[2] === group) &&
    ((codeQuery && row[0].includes(codeQuery)) || terms.every(term => row[1].toUpperCase().includes(term))));
}

export function importCatalog(text, domain) {
  let records;
  if (text.trimStart().startsWith('[')) records = JSON.parse(text);
  else {
    // Read quoted commas, newlines, and escaped quotes without changing leading zeros.
    const rows = []; let row = [], cell = '', quoted = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"') {
        if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
        else quoted = !quoted;
      } else if (!quoted && (c === ',' || c === '\n' || c === '\r')) {
        row.push(cell); cell = '';
        if (c !== ',') { if (row.some(value => value.trim())) rows.push(row); row = []; if (c === '\r' && text[i + 1] === '\n') i++; }
      } else cell += c;
    }
    if (quoted) throw new Error('The CSV contains an unclosed quote.');
    row.push(cell); if (row.some(value => value.trim())) rows.push(row);
    const headers = rows.shift()?.map(value => value.trim().toLowerCase()) || [];
    const code = headers.indexOf('code'), description = headers.indexOf('description');
    if (code < 0 || description < 0) throw new Error('Use CSV headers code,description.');
    records = rows.map(values => ({code: values[code], description: values[description]}));
  }
  if (!Array.isArray(records) || !records.length || records.length > 150000) throw new Error('Import 1–150,000 catalog rows.');
  const unique = new Map();
  for (const [i, record] of records.entries()) {
    if (typeof record?.code !== 'string' || typeof record?.description !== 'string' || !record.description.trim() || record.description.length > 2000) throw new Error(`Row ${i + 1} needs a text code and description. Preserve leading zeros.`);
    const codes = codeTokens(record.code, domain);
    if (codes.length !== 1) throw new Error(`Row ${i + 1} must contain exactly one code.`);
    if (unique.has(codes[0])) throw new Error(`Duplicate code ${codes[0]}.`);
    unique.set(codes[0], [codes[0], record.description.trim(), codes[0][0], 0]);
  }
  return { rows: [...unique.values()].sort((a,b)=>a[0].localeCompare(b[0])), groups: [...new Set([...unique.keys()].map(code=>code[0]))].sort(), periods: [], sources: [], note: 'Local catalog for this browser session. Verify its coding year. Descriptions stay on this device. Selected codes are included in your definition and SAS export.' };
}

export async function openCodePicker({domain, codes, label, onApply}) {
  const selected = new Set(codeTokens(codes, domain));
  const opener = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'code-picker';
  dialog.setAttribute('aria-labelledby', 'picker-title');
  dialog.innerHTML = `<div class="picker-head"><div><p class="eyebrow">CODE LIBRARY · ${bundled.has(domain)?'2023 REFERENCE':'LOCAL CATALOG'}</p><h2 id="picker-title">${esc(label)}</h2><p>Search by code or description, then choose the codes for this event. ${bundled.has(domain)?'These reference descriptions cover 2023. Verify code validity for the event years.':'Load a catalog for the intended coding years.'}</p></div><button class="picker-close" aria-label="Close code library" data-picker="cancel">×</button></div>
    <div class="picker-controls"><div><label for="picker-search">Search codes or descriptions</label><input id="picker-search" type="search" placeholder="Type a code, condition, or procedure" autocomplete="off"></div><div><label for="picker-group">Browse a group</label><select id="picker-group"><option value="">All groups</option></select></div></div>
    <div class="picker-tools"><label class="check-row"><input id="picker-selected" type="checkbox">Show selected only</label><span id="picker-total" role="status">Loading catalog…</span></div>
    <p id="picker-error" class="picker-error" role="alert" hidden></p><div id="picker-results" class="picker-results" aria-label="Code results"></div>
    <div class="picker-pagination"><button class="button small" data-picker="prev">Previous</button><span id="picker-page"></span><button class="button small" data-picker="next">Next</button><button class="button small" data-picker="select-page">Select this page</button></div>
    <details class="picker-reference"><summary>Catalog details and sources</summary><p id="picker-note"></p><div id="picker-sources"></div></details>
    ${'<div class="picker-import"><label for="picker-file">Load your code catalog</label><input id="picker-file" type="file" accept=".csv,.json"><p class="hint">CSV with code,description headers, or a JSON array of code and description objects. The file stays in this browser session.</p></div>'}
    <div class="picker-footer"><div><strong id="picker-count"></strong><button class="button subtle small" data-picker="clear">Clear selection</button></div><div><button class="button" data-picker="cancel">Cancel</button><button class="button primary" data-picker="apply">Apply codes</button></div></div>`;
  document.body.append(dialog);
  let catalog, page = 0, filtered = [], timer;
  const $ = selector => dialog.querySelector(selector);
  const error = message => { $('#picker-error').textContent = message; $('#picker-error').hidden = !message; };
  const count = () => { $('#picker-count').textContent = `${selected.size} / ${MAX_CODES} selected`; $('[data-picker="apply"]').disabled = selected.size > MAX_CODES; };
  const close = () => { clearTimeout(timer); dialog.close(); dialog.remove(); opener?.focus(); };
  const releases = row => catalog.periods.filter((_,i)=>row[3] & (1 << i)).join(' · ');
  function draw() {
    if (!catalog) return;
    const selectedOnly = $('#picker-selected').checked;
    const rows = selectedOnly ? [...selected].map(code => catalog.byCode.get(code) || [code, 'Manually entered code', code[0], 0]) : catalog.rows;
    filtered = searchCodes(rows, $('#picker-search').value, $('#picker-group').value);
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    page = Math.min(page, pages - 1);
    $('#picker-total').textContent = `${filtered.length.toLocaleString()} results`;
    $('#picker-page').textContent = `Page ${page + 1} of ${pages.toLocaleString()}`;
    $('[data-picker="prev"]').disabled = page === 0;
    $('[data-picker="next"]').disabled = page >= pages - 1;
    $('[data-picker="select-page"]').disabled = !filtered.length;
    $('#picker-results').innerHTML = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(row => `<label class="picker-row ${selected.has(row[0]) ? 'picked' : ''}"><input type="checkbox" data-code="${esc(row[0])}" ${selected.has(row[0]) ? 'checked' : ''}><span class="picker-code">${esc(domain === 'DX' && row[0].replace('*','').length > 3 ? row[0].slice(0,3) + '.' + row[0].slice(3) : row[0])}${row[0].endsWith('*') ? '<small>Code family</small>' : ''}</span><span class="picker-description">${esc(row[1])}<small>${esc(releases(row))}</small></span></label>`).join('') || `<div class="picker-empty">${catalog.rows.length ? 'No matching codes. Try a shorter term or a different group.' : 'Load a local catalog to search descriptions. You can also enter codes directly in the event’s code list.'}</div>`;
    $('#picker-results').scrollTop = 0;
    count();
  }
  function useCatalog(value) {
    dialog.querySelector('.picker-head .eyebrow').textContent=value.periods.length?'CODE LIBRARY · 2023 REFERENCE':'CODE LIBRARY · LOCAL CATALOG';
    catalog = value;
    catalog.byCode ||= new Map(catalog.rows.map(row=>[row[0],row]));
    $('#picker-group').innerHTML = '<option value="">All groups</option>' + catalog.groups.map(group=>`<option value="${esc(group)}">${esc(domain === 'DRG' ? group : group + ' codes')}</option>`).join('');
    $('#picker-note').textContent = catalog.note;
    $('#picker-sources').innerHTML = catalog.sources.map((source,i)=>`<a href="${esc(source.url)}" target="_blank" rel="noreferrer">Source file ${i+1} ↗</a>`).join(' · ');
    page = 0; draw();
  }
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  dialog.addEventListener('click', e => {
    const action = e.target.closest('[data-picker]')?.dataset.picker;
    if (action === 'cancel') close();
    if (action === 'apply') { if (selected.size > MAX_CODES) return; onApply([...selected].join(', ')); close(); }
    if (action === 'clear') { selected.clear(); error(''); draw(); count(); }
    if (action === 'prev' || action === 'next') { page += action === 'prev' ? -1 : 1; draw(); }
    if (action === 'select-page') {
      const next = new Set([...selected, ...filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE).map(row=>row[0])]);
      if (next.size > MAX_CODES) { error(`An event can contain up to ${MAX_CODES} codes. Narrow the selection or choose a labeled code family.`); return; }
      next.forEach(code=>selected.add(code)); error(''); draw();
    }
  });
  $('#picker-search').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(()=>{page=0;draw();},120); });
  dialog.addEventListener('change', e => {
    if (e.target.dataset.code) {
      if (e.target.checked && selected.size >= MAX_CODES) { e.target.checked=false; error(`An event can contain up to ${MAX_CODES} codes.`); return; }
      if (e.target.checked) selected.add(e.target.dataset.code); else selected.delete(e.target.dataset.code);
      e.target.closest('.picker-row').classList.toggle('picked',e.target.checked);
      error(''); count(); if ($('#picker-selected').checked) draw();
    }
    if (['picker-group','picker-selected'].includes(e.target.id)) { page=0;draw(); }
  });
  const fileInput = $('#picker-file');
  if (fileInput) fileInput.addEventListener('change', async () => {
    const file=fileInput.files[0]; if(!file)return;
    try {
      if(file.size>30000000)throw new Error('Catalog files must be under 30 MB.');
      const imported=importCatalog(await file.text(),domain);
      if(!dialog.isConnected)return;
      catalogs.set(domain,imported);useCatalog(imported);error('');
    } catch(e) {error(e.message);} finally {fileInput.value='';}
  });
  count(); dialog.showModal(); $('#picker-search').focus();
  try {
    let value = catalogs.get(domain);
    if (!value && bundled.has(domain)) {
      const response = await fetch(`./codes-${domain.toLowerCase()}.json?v=d8068fd47f0c`);
      if (!response.ok) throw new Error('Unable to load the code catalog. Close and reopen the library to retry.');
      value = await response.json(); catalogs.set(domain,value);
    }
    value ||= {rows:[],groups:[],periods:[],sources:[],note:`${label} supports a local CSV or JSON catalog. Manual code entry remains available.`};
    if(dialog.isConnected)useCatalog(value);
  } catch(e) {if(dialog.isConnected){error(e.message);$('#picker-total').textContent='Catalog unavailable';}}
}
