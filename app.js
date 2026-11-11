/* Bachelor – Niels & Ró: a simple weekly calendar. Plain JavaScript, no build step. */
(function () {
  'use strict';

  // ---- Settings -------------------------------------------------------------
  const TZ = 'Atlantic/Faroe';
  const START_HOUR = 6;
  const END_HOUR = 23;
  const HOUR_PX = 48;        // keep in sync with --hour in style.css
  const SNAP = 15;           // minutes; dragged events snap to this
  const USERNAME = 'NielsRo';
  const PASSWORD = 'Britte'; // not secret: anyone can read it in this file
  const CHANGES_KEY = 'bachelor-calendar:changes';
  const LOGIN_KEY = 'bachelor-calendar:logged-in';
  const DAY_MS = 86400000;
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---- Date helpers ---------------------------------------------------------
  // Dates are 'YYYY-MM-DD' strings and times are 'HH:MM' strings, both in Faroe time.
  // Date maths uses UTC so the visitor's own time zone never matters.
  const pad = n => String(n).padStart(2, '0');
  const toUTC = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  const fromUTC = ms => new Date(ms).toISOString().slice(0, 10);
  const addDays = (s, n) => fromUTC(toUTC(s) + n * DAY_MS);
  const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / DAY_MS);
  const weekday = s => (new Date(toUTC(s)).getUTCDay() + 6) % 7; // 0 = Monday
  const mondayOf = s => addDays(s, -weekday(s));
  const toMin = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
  const toTime = m => pad(Math.floor(m / 60)) + ':' + pad(m % 60);

  // Wall-clock date and minutes-since-midnight of timestamp `ms` in time zone `tz`.
  const formatters = {};
  function wallClock(ms, tz) {
    const f = formatters[tz] || (formatters[tz] = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }));
    const p = {};
    f.formatToParts(new Date(ms)).forEach(x => { p[x.type] = x.value; });
    return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
  }

  // Converts a wall-clock time in zone `tz` (given as if it were UTC) to a real timestamp.
  function zonedToMs(naive, tz) {
    const offset = ms => {
      const w = wallClock(ms, tz);
      return toUTC(w.date) + w.min * 60000 - Math.floor(ms / 60000) * 60000;
    };
    return naive - offset(naive - offset(naive));
  }

  const nowFaroe = () => wallClock(Date.now(), TZ);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // ---- Storage --------------------------------------------------------------
  // Everyone sees INITIAL_EVENTS (events.js). Changes made in this browser are kept in
  // localStorage as { saved: {id: event}, deleted: [id] } and laid on top of them.
  const initial = Array.isArray(window.INITIAL_EVENTS) ? window.INITIAL_EVENTS : [];
  const initialIds = new Set(initial.map(ev => ev.id));
  let changes = { saved: {}, deleted: [] };
  try {
    const stored = JSON.parse(localStorage.getItem(CHANGES_KEY));
    if (stored && stored.saved && stored.deleted) changes = stored;
  } catch (e) { /* no saved changes */ }

  function saveChanges() {
    try {
      localStorage.setItem(CHANGES_KEY, JSON.stringify(changes));
    } catch (e) {
      alert('Could not save in this browser: ' + e.message);
    }
  }

  function allEvents() {
    const byId = new Map();
    initial.forEach(ev => byId.set(ev.id, ev));
    Object.values(changes.saved).forEach(ev => byId.set(ev.id, ev));
    changes.deleted.forEach(id => byId.delete(id));
    return [...byId.values()].filter(ev => ev && ev.date);
  }

  function putEvent(ev) {
    changes.saved[ev.id] = ev;
    changes.deleted = changes.deleted.filter(id => id !== ev.id);
  }

  function removeEvent(id) {
    delete changes.saved[id];
    if (initialIds.has(id) && !changes.deleted.includes(id)) changes.deleted.push(id);
  }

  function occursOn(ev, date) {
    if (ev.skip && ev.skip.includes(date)) return false;
    if (!ev.weekly) return ev.date === date;
    const diff = daysBetween(ev.date, date);
    return diff >= 0 && diff % 7 === 0 && (!ev.until || date <= ev.until);
  }

  // ---- State ----------------------------------------------------------------
  const $ = sel => document.querySelector(sel);
  const calendar = $('#calendar');
  let weekStart = mondayOf(nowFaroe().date);
  let loggedIn = false;
  try { loggedIn = localStorage.getItem(LOGIN_KEY) === '1'; } catch (e) { /* not logged in */ }
  let drag = null;           // the event being dragged, if any
  let justDragged = false;   // ignore the click that follows a drag

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---- Rendering ------------------------------------------------------------
  function render() {
    const days = DAYS.map((_, i) => addDays(weekStart, i));
    const now = nowFaroe();
    $('#week-label').textContent = weekLabel(days[0], days[6]);
    document.body.classList.toggle('editing', loggedIn);

    // Find what happens on each day of this week
    const timed = days.map(() => []);
    const allDay = days.map(() => []);
    allEvents().forEach(ev => {
      days.forEach((date, i) => {
        if (!occursOn(ev, date)) return;
        if (ev.allDay) return allDay[i].push(ev);
        const s = Math.max(toMin(ev.start), START_HOUR * 60);
        const e = Math.min(toMin(ev.end), END_HOUR * 60);
        if (e > s) timed[i].push({ ev, s, e });
      });
    });

    calendar.textContent = '';

    // Header: day names and an all-day row
    const head = el('div', 'cal-head');
    head.appendChild(el('div', 'corner', 'Faroe time'));
    days.forEach((date, i) => {
      const h = el('div', 'day-head' + (date === now.date ? ' today' : ''));
      h.appendChild(el('span', 'dow', DAYS[i]));
      h.appendChild(el('span', 'dom', String(+date.slice(8))));
      head.appendChild(h);
    });
    head.appendChild(el('div', 'corner allday-label', 'All day'));
    days.forEach((date, i) => {
      const cell = el('div', 'allday');
      allDay[i].forEach(ev => cell.appendChild(eventBlock(ev, date)));
      head.appendChild(cell);
    });
    calendar.appendChild(head);

    // Body: hour labels and one column per day
    const body = el('div', 'cal-body');
    const height = (END_HOUR - START_HOUR) * HOUR_PX + 'px';
    const times = el('div', 'times');
    times.style.height = height;
    for (let h = START_HOUR; h <= END_HOUR; h++) {
      const label = el('span', '', pad(h) + ':00');
      label.style.top = (h - START_HOUR) * HOUR_PX + 'px';
      times.appendChild(label);
    }
    body.appendChild(times);

    days.forEach((date, i) => {
      const col = el('div', 'day-col');
      col.dataset.date = date;
      col.style.height = height;
      layoutDay(timed[i]);
      timed[i].forEach(item => {
        const b = eventBlock(item.ev, date);
        b.style.top = (item.s - START_HOUR * 60) / 60 * HOUR_PX + 'px';
        b.style.height = Math.max((item.e - item.s) / 60 * HOUR_PX, 18) + 'px';
        b.style.left = `${item.col / item.cols * 100}%`;
        b.style.width = `calc(${100 / item.cols}% - 2px)`;
        if (loggedIn && item.ev.type === 'flexible') {
          b.addEventListener('pointerdown', e => startDrag(e, b, item.ev, date));
        }
        col.appendChild(b);
      });
      if (date === now.date && now.min >= START_HOUR * 60 && now.min <= END_HOUR * 60) {
        const line = el('div', 'now-line');
        line.style.top = (now.min - START_HOUR * 60) / 60 * HOUR_PX + 'px';
        col.appendChild(line);
      }
      // Logged in: click an empty slot to create a session there
      col.addEventListener('click', e => {
        if (!loggedIn || justDragged || e.target !== col) return;
        const min = START_HOUR * 60 + Math.floor(e.offsetY / HOUR_PX * 2) * 30;
        openEvent(null, date, Math.min(min, END_HOUR * 60 - 60));
      });
      body.appendChild(col);
    });
    calendar.appendChild(body);
  }

  function eventBlock(ev, date) {
    const b = el('div', 'event ' + (ev.type === 'flexible' ? 'flexible' : 'fixed'));
    const time = ev.allDay ? 'All day' : `${ev.start}–${ev.end}`;
    b.appendChild(el('div', 'title', ev.title));
    if (!ev.allDay) b.appendChild(el('div', 'time', time + (ev.weekly ? ' · weekly' : '')));
    if (ev.location) b.appendChild(el('div', 'location', ev.location));
    b.title = [ev.title, time, ev.location].filter(Boolean).join('\n');
    b.addEventListener('click', e => {
      e.stopPropagation();
      if (!justDragged) openEvent(ev, date);
    });
    return b;
  }

  // Overlapping events share the width of the day, side by side.
  function layoutDay(items) {
    items.sort((a, b) => a.s - b.s || b.e - a.e);
    let group = [], colEnds = [], groupEnd = 0;
    const finish = () => {
      group.forEach(item => { item.cols = colEnds.length; });
      group = [];
      colEnds = [];
    };
    items.forEach(item => {
      if (group.length && item.s >= groupEnd) finish();
      let col = colEnds.findIndex(end => end <= item.s);
      if (col === -1) col = colEnds.length;
      colEnds[col] = item.e;
      item.col = col;
      group.push(item);
      groupEnd = Math.max(groupEnd, item.e);
    });
    finish();
  }

  function weekLabel(a, b) {
    const d = s => +s.slice(8), m = s => MONTHS[+s.slice(5, 7) - 1], y = s => s.slice(0, 4);
    let text;
    if (y(a) !== y(b)) text = `${d(a)} ${m(a)} ${y(a)} – ${d(b)} ${m(b)} ${y(b)}`;
    else if (m(a) !== m(b)) text = `${d(a)} ${m(a)} – ${d(b)} ${m(b)} ${y(b)}`;
    else text = `${d(a)}–${d(b)} ${m(b)} ${y(b)}`;
    const thursday = addDays(a, 3); // ISO week number
    const week = Math.floor(daysBetween(thursday.slice(0, 4) + '-01-01', thursday) / 7) + 1;
    return `${text} · Week ${week}`;
  }

  // ---- Week navigation ------------------------------------------------------
  $('#prev-btn').addEventListener('click', () => { weekStart = addDays(weekStart, -7); render(); });
  $('#next-btn').addEventListener('click', () => { weekStart = addDays(weekStart, 7); render(); });
  $('#today-btn').addEventListener('click', () => { weekStart = mondayOf(nowFaroe().date); render(); });

  // ---- Event dialog ---------------------------------------------------------
  const dialog = $('#event-dialog');
  const form = $('#event-form');
  const fields = form.elements;
  let current = null; // { ev, date } shown in the dialog; ev is null for a new session

  const canEdit = ev => loggedIn && (!ev || ev.type === 'flexible');

  function openEvent(ev, date, startMin) {
    current = { ev, date };
    const editable = canEdit(ev);
    fields.title.value = ev ? ev.title : 'Bachelor work';
    fields.location.value = (ev && ev.location) || '';
    fields.date.value = date;
    fields.start.value = ev ? ev.start || '' : toTime(startMin);
    fields.end.value = ev ? ev.end || '' : toTime(startMin + 60);
    fields.weekly.checked = !!(ev && ev.weekly);
    fields.until.value = (ev && ev.until) || '';
    form.querySelectorAll('input').forEach(input => { input.disabled = !editable; });
    $('#event-heading').textContent = !ev ? 'New session'
      : ev.type !== 'flexible' ? 'Fixed event'
      : editable ? 'Edit session' : 'Bachelor session';
    form.classList.toggle('editable', editable);
    form.classList.toggle('is-new', !ev);
    form.classList.toggle('is-fixed', !!ev && ev.type !== 'flexible');
    form.classList.toggle('all-day', !!(ev && ev.allDay));
    form.classList.toggle('weekly', fields.weekly.checked);
    $('#event-error').textContent = '';
    dialog.showModal();
  }

  fields.weekly.addEventListener('change', () => form.classList.toggle('weekly', fields.weekly.checked));
  $('#close-btn').addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!canEdit(current.ev)) return;
    const f = {
      title: fields.title.value.trim() || 'Bachelor work',
      location: fields.location.value.trim(),
      date: fields.date.value,
      start: fields.start.value.slice(0, 5),
      end: fields.end.value.slice(0, 5),
      weekly: fields.weekly.checked,
      until: fields.until.value
    };
    const error = toMin(f.end) <= toMin(f.start) ? 'The end time must be after the start time.'
      : f.weekly && f.until && f.until < f.date ? '"Repeat until" must be on or after the date.' : '';
    $('#event-error').textContent = error;
    if (error) return;
    if (!current.ev) putEvent(withFields({ id: newId(), type: 'flexible' }, f));
    else if (!(await applyEdit(current.ev, current.date, f))) return;
    saveChanges();
    dialog.close();
    render();
  });

  $('#delete-btn').addEventListener('click', async () => {
    const { ev, date } = current;
    if (!ev || !canEdit(ev)) return;
    if (ev.weekly) {
      const scope = await ask('This session repeats every week. Delete:',
        [['one', 'Only this week'], ['all', 'All weeks']]);
      if (!scope) return;
      if (scope === 'one') putEvent({ ...ev, skip: [...(ev.skip || []), date] });
      else removeEvent(ev.id);
    } else {
      if (!confirm('Delete this session?')) return;
      removeEvent(ev.id);
    }
    saveChanges();
    dialog.close();
    render();
  });

  // Copies form values `f` onto event `ev`.
  function withFields(ev, f) {
    const out = { ...ev, title: f.title, location: f.location, date: f.date, start: f.start, end: f.end };
    if (f.weekly) {
      out.weekly = true;
      out.until = f.until;
    } else {
      delete out.weekly;
      delete out.until;
      delete out.skip;
    }
    if (!out.location) delete out.location;
    if (!out.until) delete out.until;
    return out;
  }

  // Saves changed values `f` for the occurrence of `ev` on `date`.
  // For weekly sessions it asks whether to change only this week or all weeks.
  async function applyEdit(ev, date, f) {
    if (!ev.weekly) {
      putEvent(withFields(ev, f));
      return true;
    }
    const scope = await ask('This session repeats every week. Change:',
      [['one', 'Only this week'], ['all', 'All weeks']]);
    if (!scope) return false;
    if (scope === 'one') {
      putEvent({ ...ev, skip: [...(ev.skip || []), date] });
      putEvent(withFields({ id: newId(), type: ev.type }, { ...f, weekly: false }));
    } else {
      const shift = daysBetween(date, f.date);
      const updated = withFields(ev, { ...f, date: f.weekly ? addDays(ev.date, shift) : f.date });
      if (updated.skip) updated.skip = updated.skip.map(d => addDays(d, shift));
      putEvent(updated);
    }
    return true;
  }

  // Shows a question with buttons. Resolves to the chosen value, or '' when cancelled.
  function ask(text, choices) {
    const askDialog = $('#ask-dialog');
    const buttons = $('#ask-buttons');
    $('#ask-text').textContent = text;
    buttons.textContent = '';
    [['', 'Cancel'], ...choices].forEach(([value, label], i) => {
      const b = el('button', i === choices.length ? 'primary' : '', label);
      b.value = value;
      buttons.appendChild(b);
    });
    askDialog.returnValue = '';
    return new Promise(resolve => {
      askDialog.addEventListener('close', () => resolve(askDialog.returnValue), { once: true });
      askDialog.showModal();
    });
  }

  // ---- Drag to move (logged in, blue sessions only) -------------------------
  function startDrag(e, block, ev, date) {
    if (e.button !== 0) return;
    drag = { block, ev, date, x: e.clientX, y: e.clientY, moved: false, newDate: date, newStart: toMin(ev.start) };
  }

  window.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    drag.moved = true;
    const length = toMin(drag.ev.end) - toMin(drag.ev.start);
    const latest = Math.max(END_HOUR * 60 - length, START_HOUR * 60);
    const moved = toMin(drag.ev.start) + Math.round(dy / HOUR_PX * 60 / SNAP) * SNAP;
    const start = Math.min(Math.max(moved, START_HOUR * 60), latest);
    const col = [...calendar.querySelectorAll('.day-col')].find(c => {
      const r = c.getBoundingClientRect();
      return e.clientX >= r.left && e.clientX < r.right;
    });
    if (col && col !== drag.block.parentElement) col.appendChild(drag.block);
    drag.newDate = drag.block.parentElement.dataset.date;
    drag.newStart = start;
    drag.block.classList.add('dragging');
    drag.block.style.top = (start - START_HOUR * 60) / 60 * HOUR_PX + 'px';
    drag.block.style.left = '0';
    drag.block.style.width = 'calc(100% - 2px)';
    drag.block.querySelector('.time').textContent = toTime(start) + '–' + toTime(start + length);
  });

  window.addEventListener('pointerup', async () => {
    const d = drag;
    drag = null;
    if (!d || !d.moved) return;
    justDragged = true;
    setTimeout(() => { justDragged = false; }, 0);
    const length = toMin(d.ev.end) - toMin(d.ev.start);
    if (d.newDate !== d.date || d.newStart !== toMin(d.ev.start)) {
      const f = {
        title: d.ev.title, location: d.ev.location || '', date: d.newDate,
        start: toTime(d.newStart), end: toTime(d.newStart + length),
        weekly: !!d.ev.weekly, until: d.ev.until || ''
      };
      if (await applyEdit(d.ev, d.date, f)) saveChanges();
    }
    render();
  });

  // ---- Login ----------------------------------------------------------------
  const loginDialog = $('#login-dialog');
  const loginForm = $('#login-form');

  $('#login-btn').addEventListener('click', () => {
    loginForm.reset();
    $('#login-error').textContent = '';
    loginDialog.showModal();
  });
  $('#login-cancel').addEventListener('click', () => loginDialog.close());

  loginForm.addEventListener('submit', e => {
    e.preventDefault();
    const user = loginForm.elements.username.value.trim();
    const pass = loginForm.elements.password.value;
    if (user !== USERNAME || pass !== PASSWORD) {
      $('#login-error').textContent = 'Wrong username or password.';
      return;
    }
    loggedIn = true;
    try { localStorage.setItem(LOGIN_KEY, '1'); } catch (err) { /* stays logged in until reload */ }
    loginDialog.close();
    render();
  });

  $('#logout-btn').addEventListener('click', () => {
    loggedIn = false;
    try { localStorage.removeItem(LOGIN_KEY); } catch (err) { /* ignore */ }
    render();
  });

  $('#new-btn').addEventListener('click', () => {
    const today = nowFaroe().date;
    const inWeek = today >= weekStart && today <= addDays(weekStart, 6);
    openEvent(null, inWeek ? today : weekStart, 9 * 60);
  });

  // ---- Export: download events.js with every event --------------------------
  $('#export-btn').addEventListener('click', () => {
    const events = allEvents().sort((a, b) =>
      (a.date + (a.start || '')).localeCompare(b.date + (b.start || '')));
    const text =
      '// Shared events: everyone who opens the website sees these.\n' +
      '// Times are Faroe time (Atlantic/Faroe). See README.md for the event format.\n' +
      `// Exported from the website on ${nowFaroe().date}.\n` +
      'window.INITIAL_EVENTS = [\n' +
      events.map(ev => '  ' + JSON.stringify(ev) + ',\n').join('') +
      '];\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
    a.download = 'events.js';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  // ---- .ics import (timetable): imported events become grey and fixed -------
  $('#ics-input').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file || !loggedIn) return;
    let result;
    try {
      result = importICS(await file.text());
    } catch (err) {
      alert('Could not read this file: ' + err.message);
      return;
    }
    if (!result.events.length) {
      alert('No events were found in this file.');
      return;
    }
    const old = allEvents().filter(ev => ev.source === 'ics');
    if (old.length) {
      const choice = await ask(`You already have ${old.length} imported events. What should happen to them?`,
        [['add', 'Keep them too'], ['replace', 'Replace them']]);
      if (!choice) return;
      if (choice === 'replace') old.forEach(ev => removeEvent(ev.id));
    }
    result.events.forEach(putEvent);
    saveChanges();
    render();
    alert(`Imported ${result.events.length} events as fixed (grey) events.` +
      (result.notes.length ? '\n\n' + result.notes.join('\n') : ''));
  });

  // Common Windows (Outlook) time zone names that browsers don't know.
  const WINDOWS_TZ = {
    'GMT Standard Time': 'Europe/London',
    'Greenwich Standard Time': 'UTC',
    'Romance Standard Time': 'Europe/Copenhagen',
    'W. Europe Standard Time': 'Europe/Berlin'
  };

  function validZone(tz) {
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch (e) { return false; }
  }

  // Splits an .ics file into VEVENTs: { NAME: {value, params}, EXDATE: [..] }.
  function parseICS(text) {
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
    const events = [];
    let cur = null, depth = 0;
    for (const raw of lines) {
      const line = raw.trimEnd();
      if (line === 'BEGIN:VEVENT') { cur = { EXDATE: [] }; depth = 0; continue; }
      if (!cur) continue;
      if (line === 'END:VEVENT') { events.push(cur); cur = null; continue; }
      if (line.startsWith('BEGIN:')) { depth++; continue; } // e.g. VALARM inside an event
      if (line.startsWith('END:')) { depth--; continue; }
      if (depth) continue;
      let i = 0, quoted = false;
      for (; i < line.length; i++) {
        if (line[i] === '"') quoted = !quoted;
        else if (line[i] === ':' && !quoted) break;
      }
      if (i >= line.length) continue;
      const [name, ...rest] = line.slice(0, i).split(';');
      const params = {};
      rest.forEach(p => {
        const j = p.indexOf('=');
        if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, '');
      });
      const prop = { value: line.slice(i + 1), params };
      if (name.toUpperCase() === 'EXDATE') {
        prop.value.split(',').forEach(v => cur.EXDATE.push({ value: v, params }));
      } else {
        cur[name.toUpperCase()] = prop;
      }
    }
    return events;
  }

  const unescapeText = v => v.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? ' ' : c)).trim();

  // Reads an .ics date or date-time. `naive` is the wall-clock time as if it were UTC.
  function icsTime(prop) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z?))?$/.exec(prop.value.trim());
    if (!m) return null;
    let tz = m[7] ? 'UTC' : (prop.params.TZID || '');
    tz = WINDOWS_TZ[tz] || tz;
    if (tz && !validZone(tz)) tz = tz.split('/').slice(-2).join('/'); // e.g. /mozilla.org/.../Europe/Oslo
    if (tz && !validZone(tz)) tz = ''; // unknown zone: assume Faroe time
    return {
      naive: Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)),
      allDay: !m[4],
      tz
    };
  }

  // Real timestamp of wall-clock time `naive` in the zone of `t` (all-day dates stay as they are).
  const instant = (t, naive = t.naive) => (t.allDay ? naive : zonedToMs(naive, t.tz || TZ));

  function icsDuration(v) {
    const m = /^[+]?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
    if (!m) return 0;
    const [w, d, h, min, s] = m.slice(1).map(x => +x || 0);
    return ((((w * 7 + d) * 24 + h) * 60 + min) * 60 + s) * 1000;
  }

  // Start times (wall clock, as if UTC) of a repeating event. Supports DAILY and WEEKLY
  // rules, from one year ago to one year ahead. Returns null for other rules.
  function expandRule(rule, start) {
    const r = {};
    rule.split(';').forEach(part => {
      const [k, v] = part.split('=');
      r[k.toUpperCase()] = (v || '').toUpperCase();
    });
    if (r.FREQ !== 'WEEKLY' && r.FREQ !== 'DAILY') return null;
    const interval = +r.INTERVAL || 1;
    const count = +r.COUNT || Infinity;
    const today = toUTC(nowFaroe().date);
    const from = today - 366 * DAY_MS, to = today + 366 * DAY_MS;
    const u = r.UNTIL ? icsTime({ value: r.UNTIL, params: {} }) : null;
    const untilLimit = !u ? Infinity
      : u.allDay || start.allDay ? null
      : u.tz ? instant(u) : instant(start, u.naive);
    const beforeUntil = naive => !u || (untilLimit === null
      ? naive < u.naive - (u.naive % DAY_MS) + DAY_MS
      : instant(start, naive) <= untilLimit);
    const codes = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
    const startDate = fromUTC(start.naive);
    const timeOfDay = start.naive - toUTC(startDate);
    const byDay = r.BYDAY ? r.BYDAY.split(',').map(d => codes.indexOf(d.slice(-2))) : null;
    const out = [];
    for (let date = startDate, n = 0; n < count; date = addDays(date, 1)) {
      const naive = toUTC(date) + timeOfDay;
      if (naive > to || !beforeUntil(naive)) break;
      const match = r.FREQ === 'DAILY'
        ? daysBetween(startDate, date) % interval === 0 && (!byDay || byDay.includes(weekday(date)))
        : (byDay || [weekday(startDate)]).includes(weekday(date)) &&
          Math.floor(daysBetween(mondayOf(startDate), date) / 7) % interval === 0;
      if (!match) continue;
      n++;
      if (naive >= from) out.push(naive);
    }
    return out;
  }

  // Turns one occurrence into calendar events (one per day it touches), in Faroe time.
  function addOccurrence(list, base, allDay, ms, length) {
    const add = extra => list.push({ id: newId(), type: 'fixed', source: 'ics', ...base, ...extra });
    if (allDay) {
      const first = fromUTC(ms);
      const days = Math.min(Math.max(1, Math.round(length / DAY_MS)), 60);
      for (let i = 0; i < days; i++) add({ date: addDays(first, i), allDay: true });
      return;
    }
    const a = wallClock(ms, TZ);
    const b = wallClock(ms + length, TZ);
    for (let date = a.date, i = 0; date <= b.date && i < 60; date = addDays(date, 1), i++) {
      const s = date === a.date ? a.min : 0;
      const e = date === b.date ? b.min : 24 * 60;
      if (e > s) add({ date, start: toTime(s), end: toTime(e) });
      else if (length <= 0) add({ date, start: toTime(s), end: toTime(Math.min(s + 30, 24 * 60)) });
    }
  }

  function importICS(text) {
    const vevents = parseICS(text);
    const events = [];
    const notes = [];
    let unsupported = 0, broken = 0;

    // Single occurrences that were moved/cancelled (RECURRENCE-ID) replace that occurrence of the series
    const overridden = {};
    vevents.forEach(v => {
      const t = v['RECURRENCE-ID'] && v.UID && icsTime(v['RECURRENCE-ID']);
      if (t) (overridden[v.UID.value] = overridden[v.UID.value] || []).push(instant(t));
    });

    vevents.forEach(v => {
      const status = v.STATUS ? v.STATUS.value.toUpperCase() : '';
      if (!v.DTSTART || status === 'CANCELLED') return;
      const start = icsTime(v.DTSTART);
      if (!start) { broken++; return; }
      const end = v.DTEND && icsTime(v.DTEND);
      const length = end ? instant(end) - instant(start)
        : v.DURATION ? icsDuration(v.DURATION.value)
        : start.allDay ? DAY_MS : 0;

      const base = { title: unescapeText(v.SUMMARY ? v.SUMMARY.value : '') || '(No title)' };
      const location = v.LOCATION ? unescapeText(v.LOCATION.value) : '';
      if (location) base.location = location;

      const exclude = new Set(v.EXDATE.map(icsTime).filter(Boolean).map(t => instant(t)));
      if (!v['RECURRENCE-ID'] && v.UID && overridden[v.UID.value]) {
        overridden[v.UID.value].forEach(ms => exclude.add(ms));
      }

      let starts = [start.naive];
      if (v.RRULE && !v['RECURRENCE-ID']) {
        const expanded = expandRule(v.RRULE.value, start);
        if (expanded) starts = expanded;
        else unsupported++;
      }
      starts.forEach(naive => {
        const ms = instant(start, naive);
        if (!exclude.has(ms)) addOccurrence(events, base, start.allDay, ms, length);
      });
    });

    if (unsupported) notes.push(`${unsupported} event(s) repeat monthly/yearly: only their first date was imported.`);
    if (broken) notes.push(`${broken} event(s) had dates that could not be read and were skipped.`);
    return { events, notes };
  }

  // ---- Start ----------------------------------------------------------------
  render();
  setInterval(() => { if (!drag) render(); }, 60000); // keep the red "now" line current
})();
