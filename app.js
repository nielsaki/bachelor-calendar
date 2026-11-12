/* Bachelor – Niels & Ró: a simple weekly calendar. Plain JavaScript, no build step. */
(function () {
  'use strict';

  // ---- Settings -------------------------------------------------------------
  const TZ = 'Atlantic/Faroe';  // time zone of the times saved in events.js
  const ZONES = { 'Atlantic/Faroe': 'Faroese time', 'Europe/Copenhagen': 'Danish time' };
  const DEFAULT_ZONE = 'Europe/Copenhagen'; // time zone the calendar is shown in by default
  const START_HOUR = 6;
  const END_HOUR = 23;
  const HOUR_PX = 48;        // keep in sync with --hour in style.css
  const SNAP = 15;           // minutes; dragged events snap to this
  const USERNAME = 'NielsRo';
  const PASSWORD = 'Britte'; // not secret: anyone can read it in this file
  const LOGIN_KEY = 'bachelor-calendar:logged-in';
  const DAY_MS = 86400000;
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // ---- Date helpers ---------------------------------------------------------
  // Dates are 'YYYY-MM-DD' strings and times are 'HH:MM' strings.
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

  // Moves a date + minutes from one time zone to another.
  function convert(date, min, from, to) {
    if (from === to) return { date, min };
    return wallClock(zonedToMs(toUTC(date) + min * 60000, from), to);
  }

  const nowFaroe = () => wallClock(Date.now(), TZ);
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  // ---- Storage --------------------------------------------------------------
  // Everyone sees INITIAL_EVENTS (events.js). Changes made on the page are kept in memory
  // only, as { saved: {id: event}, deleted: [id] }, and laid on top of them. Nothing is
  // saved in the browser: reloading the page shows events.js again. Use Export to keep them.
  const initial = Array.isArray(window.INITIAL_EVENTS) ? window.INITIAL_EVENTS : [];
  const initialIds = new Set(initial.map(ev => ev.id));
  const changes = { saved: {}, deleted: [] };
  // Earlier versions saved changes in this browser. Remove what they left behind.
  try { localStorage.removeItem('bachelor-calendar:changes'); } catch (e) { /* nothing to remove */ }

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
  let loggedIn = false;
  let zone = DEFAULT_ZONE;
  try {
    loggedIn = localStorage.getItem(LOGIN_KEY) === '1';
  } catch (e) { /* defaults */ }
  let weekStart = mondayOf(wallClock(Date.now(), zone).date);
  let drag = null;           // the event being dragged, if any
  let justDragged = false;   // ignore the click that follows a drag

  // Saved (Faroe) time <-> time in the zone the calendar is shown in.
  const toShown = (date, min) => convert(date, min, TZ, zone);
  const toSaved = (date, min) => convert(date, min, zone, TZ);

  function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
  }

  // ---- Rendering ------------------------------------------------------------
  // Each shown event is an "item": { ev, occDate (saved date), date (shown date),
  // start, end (shown minutes), s, e (minutes clipped to the visible hours) }.
  function render() {
    const days = DAYS.map((_, i) => addDays(weekStart, i));
    const now = wallClock(Date.now(), zone);
    $('#week-label').textContent = weekLabel(days[0], days[6]);
    document.body.classList.toggle('editing', loggedIn);

    // Find what happens on each shown day. Saved dates one day either side are checked
    // too, because changing time zone can move an event across midnight.
    let timed = days.map(() => []);
    let allDay = days.map(() => []);
    allEvents().forEach(ev => {
      for (let saved = addDays(days[0], -1); saved <= addDays(days[6], 1); saved = addDays(saved, 1)) {
        if (!occursOn(ev, saved)) continue;
        if (ev.allDay) {
          const i = daysBetween(days[0], saved);
          if (i >= 0 && i < 7) allDay[i].push({ ev, occDate: saved, date: saved });
          continue;
        }
        const a = toShown(saved, toMin(ev.start));
        const b = toShown(saved, toMin(ev.end));
        const i = daysBetween(days[0], a.date);
        if (i < 0 || i > 6) continue;
        const start = a.min;
        const end = b.date === a.date ? b.min : 24 * 60;
        const s = Math.max(start, START_HOUR * 60);
        const e = Math.min(end, END_HOUR * 60);
        if (e > s) timed[i].push({ ev, occDate: saved, date: a.date, start, end, s, e });
      }
    });

    // Visitors only see when we are busy, not what we are doing
    if (!loggedIn) {
      timed = timed.map(busyBlocks);
      allDay = allDay.map(items => (items.length ? [{ ev: { type: 'fixed', title: 'Busy', allDay: true } }] : []));
    }

    calendar.textContent = '';

    // Header: day names and an all-day row
    const head = el('div', 'cal-head');
    head.appendChild(el('div', 'corner', ZONES[zone]));
    days.forEach((date, i) => {
      const h = el('div', 'day-head' + (date === now.date ? ' today' : ''));
      h.appendChild(el('span', 'dow', DAYS[i]));
      h.appendChild(el('span', 'dom', String(+date.slice(8))));
      head.appendChild(h);
    });
    head.appendChild(el('div', 'corner allday-label', 'All day'));
    allDay.forEach(items => {
      const cell = el('div', 'allday');
      items.forEach(item => cell.appendChild(eventBlock(item)));
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
        const b = eventBlock(item);
        b.style.top = (item.s - START_HOUR * 60) / 60 * HOUR_PX + 'px';
        b.style.height = Math.max((item.e - item.s) / 60 * HOUR_PX, 18) + 'px';
        b.style.left = `${item.col / item.cols * 100}%`;
        b.style.width = `calc(${100 / item.cols}% - 2px)`;
        if (loggedIn && item.ev.type === 'flexible') {
          b.addEventListener('pointerdown', e => startDrag(e, b, item));
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
        const min = Math.min(START_HOUR * 60 + Math.floor(e.offsetY / HOUR_PX * 2) * 30, END_HOUR * 60 - 60);
        openEvent({ ev: null, date, start: min, end: min + 60 });
      });
      body.appendChild(col);
    });
    calendar.appendChild(body);
  }

  function eventBlock(item) {
    const ev = item.ev;
    const b = el('div', 'event ' + (ev.type === 'flexible' ? 'flexible' : 'fixed'));
    const time = ev.allDay ? 'All day' : `${toTime(item.start)}–${toTime(item.end)}`;
    b.appendChild(el('div', 'title', ev.title));
    if (!ev.allDay) b.appendChild(el('div', 'time', time + (ev.weekly ? ' · weekly' : '')));
    if (ev.location) b.appendChild(el('div', 'location', ev.location));
    b.title = [ev.title, time, ev.location].filter(Boolean).join('\n');
    if (loggedIn) {
      b.addEventListener('click', e => {
        e.stopPropagation();
        if (!justDragged) openEvent(item);
      });
    }
    return b;
  }

  // For visitors: merges overlapping events into blocks without details,
  // grey "Busy" for fixed events and blue "Bachelor work" for sessions.
  function busyBlocks(items) {
    const blocks = [];
    [['fixed', 'Busy'], ['flexible', 'Bachelor work']].forEach(([type, title]) => {
      items
        .filter(item => (item.ev.type === 'flexible') === (type === 'flexible'))
        .sort((a, b) => a.start - b.start)
        .forEach(item => {
          const last = blocks[blocks.length - 1];
          if (last && last.ev.type === type && item.start <= last.end) {
            last.end = Math.max(last.end, item.end);
            last.e = Math.max(last.e, item.e);
          } else {
            blocks.push({ ev: { type, title }, start: item.start, end: item.end, s: item.s, e: item.e });
          }
        });
    });
    return blocks;
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

  // ---- Week navigation and time zone ----------------------------------------
  $('#prev-btn').addEventListener('click', () => { weekStart = addDays(weekStart, -7); render(); });
  $('#next-btn').addEventListener('click', () => { weekStart = addDays(weekStart, 7); render(); });
  $('#today-btn').addEventListener('click', () => { weekStart = mondayOf(wallClock(Date.now(), zone).date); render(); });

  const zoneSelect = $('#zone-select');
  zoneSelect.value = zone;
  zoneSelect.addEventListener('change', () => {
    zone = zoneSelect.value;
    render();
  });

  // ---- Event dialog (logged in only) ----------------------------------------
  const dialog = $('#event-dialog');
  const form = $('#event-form');
  const fields = form.elements;
  let current = null; // the item shown in the dialog; item.ev is null for a new session

  const canEdit = ev => loggedIn && (!ev || ev.type === 'flexible');

  function openEvent(item) {
    const ev = item.ev;
    current = item;
    const editable = canEdit(ev);
    const allDay = !!(ev && ev.allDay);
    fields.title.value = ev ? ev.title : 'Bachelor work';
    fields.location.value = (ev && ev.location) || '';
    fields.date.value = item.date;
    fields.start.value = allDay ? '' : toTime(item.start);
    fields.end.value = allDay ? '' : toTime(item.end);
    fields.weekly.checked = !!(ev && ev.weekly);
    fields.until.value = (ev && ev.until) || '';
    form.querySelectorAll('input').forEach(input => { input.disabled = !editable; });
    $('#event-heading').textContent = !ev ? 'New session' : editable ? 'Edit session' : 'Fixed event';
    form.classList.toggle('editable', editable);
    form.classList.toggle('deletable', !!ev && loggedIn);
    form.classList.toggle('is-new', !ev);
    form.classList.toggle('is-fixed', !!ev && ev.type !== 'flexible');
    form.classList.toggle('all-day', allDay);
    form.classList.toggle('weekly', fields.weekly.checked);
    $('#event-error').textContent = '';
    dialog.showModal();
  }

  fields.weekly.addEventListener('change', () => form.classList.toggle('weekly', fields.weekly.checked));
  $('#close-btn').addEventListener('click', () => dialog.close());

  // Converts a shown date + start/end minutes to saved (Faroe) date, start and end.
  function savedTimes(date, start, end) {
    const a = toSaved(date, start);
    const b = toSaved(date, end);
    return { date: a.date, start: toTime(a.min), end: b.date === a.date ? toTime(b.min) : '24:00' };
  }

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
    Object.assign(f, savedTimes(f.date, toMin(f.start), toMin(f.end)));
    if (!current.ev) putEvent(withFields({ id: newId(), type: 'flexible' }, f));
    else if (!(await applyEdit(current.ev, current.occDate, f))) return;
    dialog.close();
    render();
  });

  // Logged in: any single event can be deleted, also fixed (grey) ones.
  $('#delete-btn').addEventListener('click', async () => {
    const { ev, occDate } = current;
    if (!ev || !loggedIn) return;
    if (ev.weekly) {
      const scope = await ask('This event repeats every week. Delete:',
        [['one', 'Only this week'], ['all', 'All weeks']]);
      if (!scope) return;
      if (scope === 'one') putEvent({ ...ev, skip: [...(ev.skip || []), occDate] });
      else removeEvent(ev.id);
    } else {
      if (!confirm(`Delete "${ev.title}"?`)) return;
      removeEvent(ev.id);
    }
    dialog.close();
    render();
  });

  // Copies form values `f` (in saved time) onto event `ev`.
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

  // Saves changed values `f` (in saved time) for the occurrence of `ev` on saved date `date`.
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
  function startDrag(e, block, item) {
    if (e.button !== 0) return;
    drag = { block, item, x: e.clientX, y: e.clientY, moved: false, newDate: item.date, newStart: item.start };
  }

  window.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    drag.moved = true;
    const length = drag.item.end - drag.item.start;
    const latest = Math.max(END_HOUR * 60 - length, START_HOUR * 60);
    const moved = drag.item.start + Math.round(dy / HOUR_PX * 60 / SNAP) * SNAP;
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
    const { ev, date, start, end, occDate } = d.item;
    if (d.newDate !== date || d.newStart !== start) {
      const f = {
        title: ev.title, location: ev.location || '', weekly: !!ev.weekly, until: ev.until || '',
        ...savedTimes(d.newDate, d.newStart, d.newStart + end - start)
      };
      await applyEdit(ev, occDate, f);
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
    const today = wallClock(Date.now(), zone).date;
    const inWeek = today >= weekStart && today <= addDays(weekStart, 6);
    openEvent({ ev: null, date: inWeek ? today : weekStart, start: 9 * 60, end: 10 * 60 });
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
  const WEEKDAY_CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

  function validZone(tz) {
    try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch (e) { return false; }
  }

  // ---- Time zones while importing --------------------------------------------
  // A zone is { offset(ms) }: minutes ahead of UTC at timestamp `ms`.
  // A "naive" time is a wall-clock time stored as if it were a UTC timestamp.
  const UTC_ZONE = { offset: () => 0 };
  const ianaZones = {};
  function ianaZone(name) {
    return ianaZones[name] || (ianaZones[name] = {
      offset: ms => {
        const w = wallClock(ms, name);
        return (toUTC(w.date) + w.min * 60000 - Math.floor(ms / 60000) * 60000) / 60000;
      }
    });
  }
  // Wall-clock time in `zone` -> timestamp, and back. Both follow daylight saving time.
  const wallToMs = (naive, zone) => naive - zone.offset(naive - zone.offset(naive) * 60000) * 60000;
  const msToWall = (ms, zone) => ms + zone.offset(ms) * 60000;

  // '20261109T080000', '20261109T080000Z' or '20261109' -> { naive, utc, allDay }
  function icsValue(v) {
    const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z?))?$/.exec(v.trim());
    if (!m) return null;
    return {
      naive: Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)),
      utc: !!m[7],
      allDay: !m[4]
    };
  }

  function parseRule(rule) {
    const r = {};
    rule.split(';').forEach(part => {
      const [k, v] = part.split('=');
      if (k) r[k.trim().toUpperCase()] = (v || '').trim().toUpperCase();
    });
    return r;
  }

  const parseOffset = v => {
    const m = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec((v || '').trim());
    return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : null;
  };

  // Start times (naive) of a yearly VTIMEZONE rule such as FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU,
  // not counting the first one (DTSTART). Stops at UNTIL/COUNT or the year 2100.
  function yearlyOnsets(rule, startNaive, fromOffset) {
    const r = parseRule(rule);
    if (r.FREQ !== 'YEARLY') return [];
    const first = new Date(startNaive);
    const time = startNaive - Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate());
    const months = (r.BYMONTH ? r.BYMONTH.split(',').map(Number) : [first.getUTCMonth() + 1]).sort((a, b) => a - b);
    const monthDays = r.BYMONTHDAY ? r.BYMONTHDAY.split(',').map(Number) : null;
    const until = r.UNTIL ? icsValue(r.UNTIL) : null;
    const count = +r.COUNT || Infinity;
    const out = [];
    for (let y = Math.max(first.getUTCFullYear(), 1900); y <= 2100; y++) {
      for (const m of months) {
        const length = new Date(Date.UTC(y, m, 0)).getUTCDate();
        let days = [];
        for (let d = 1; d <= length; d++) days.push(d);
        if (monthDays) days = days.filter(d => monthDays.includes(d) || monthDays.includes(d - length - 1));
        if (r.BYDAY) {
          const picked = [];
          r.BYDAY.split(',').forEach(code => {
            const n = parseInt(code, 10) || 0; // '-1SU' -> -1 (last), '2SU' -> 2 (second), 'SU' -> every
            const wd = WEEKDAY_CODES.indexOf(code.slice(-2));
            const matching = days.filter(d => weekday(fromUTC(Date.UTC(y, m - 1, d))) === wd);
            if (!n) picked.push(...matching);
            else if (matching[n > 0 ? n - 1 : matching.length + n]) picked.push(matching[n > 0 ? n - 1 : matching.length + n]);
          });
          days = picked;
        } else if (!monthDays) {
          days = [first.getUTCDate()];
        }
        for (const d of [...new Set(days)].sort((a, b) => a - b)) {
          const naive = Date.UTC(y, m - 1, d) + time;
          if (naive <= startNaive) continue;
          if (until && (until.utc ? naive - fromOffset * 60000 : naive) > until.naive) return out;
          out.push(naive);
          if (out.length >= count - 1) return out; // COUNT includes DTSTART
        }
      }
    }
    return out;
  }

  // A zone defined in the file by a VTIMEZONE block (its STANDARD and DAYLIGHT rules).
  function vtimezoneZone(comp) {
    const changes = []; // { at: timestamp, to: offset }
    let earliest = null;
    comp.children.filter(c => c.name === 'STANDARD' || c.name === 'DAYLIGHT').forEach(c => {
      const prop = name => (c.props[name] ? c.props[name][0].value : '');
      const start = icsValue(prop('DTSTART'));
      const from = parseOffset(prop('TZOFFSETFROM'));
      const to = parseOffset(prop('TZOFFSETTO'));
      if (!start || from === null || to === null) return;
      if (!earliest || start.naive < earliest.naive) earliest = { naive: start.naive, from };
      const add = naive => changes.push({ at: naive - from * 60000, to });
      add(start.naive);
      (c.props.RDATE || []).forEach(p => p.value.split(',').map(icsValue).forEach(d => d && add(d.naive)));
      if (c.props.RRULE) yearlyOnsets(prop('RRULE'), start.naive, from).forEach(add);
    });
    if (!earliest) return null;
    changes.sort((a, b) => a.at - b.at);
    return {
      offset: ms => {
        let offset = earliest.from;
        for (const change of changes) {
          if (change.at > ms) break;
          offset = change.to;
        }
        return offset;
      }
    };
  }

  // Parses an .ics file into nested components: { name, props: { NAME: [{ value, params }] }, children }.
  function parseICS(text) {
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
    const root = { name: '', props: {}, children: [] };
    const stack = [root];
    for (const raw of lines) {
      const line = raw.trimEnd();
      let i = 0, quoted = false;
      for (; i < line.length; i++) {
        if (line[i] === '"') quoted = !quoted;
        else if (line[i] === ':' && !quoted) break;
      }
      if (i >= line.length) continue;
      const [rawName, ...rest] = line.slice(0, i).split(';');
      const name = rawName.toUpperCase();
      const value = line.slice(i + 1);
      const top = stack[stack.length - 1];
      if (name === 'BEGIN') {
        const comp = { name: value.trim().toUpperCase(), props: {}, children: [] };
        top.children.push(comp);
        stack.push(comp);
      } else if (name === 'END') {
        if (stack.length > 1) stack.pop();
      } else {
        const params = {};
        rest.forEach(p => {
          const j = p.indexOf('=');
          if (j > 0) params[p.slice(0, j).toUpperCase()] = p.slice(j + 1).replace(/^"|"$/g, '');
        });
        (top.props[name] = top.props[name] || []).push({ value, params });
      }
    }
    return root;
  }

  const unescapeText = v => v.replace(/\\([\\;,nN])/g, (_, c) => (c === 'n' || c === 'N' ? ' ' : c)).trim();

  function icsDuration(v) {
    const m = /^[+]?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
    if (!m) return 0;
    const [w, d, h, min, s] = m.slice(1).map(x => +x || 0);
    return ((((w * 7 + d) * 24 + h) * 60 + min) * 60 + s) * 1000;
  }

  // Start timestamps of a repeating event, repeated in wall-clock time of `start.zone`
  // (so daylight saving time doesn't move it). Supports DAILY and WEEKLY rules,
  // up to one year ahead. Returns null for other rules.
  function expandRule(rule, start) {
    const r = parseRule(rule);
    if (r.FREQ !== 'WEEKLY' && r.FREQ !== 'DAILY') return null;
    const interval = +r.INTERVAL || 1;
    const count = +r.COUNT || Infinity;
    const to = toUTC(nowFaroe().date) + 366 * DAY_MS;
    const toMs = naive => (start.allDay ? naive : wallToMs(naive, start.zone));
    const u = r.UNTIL ? icsValue(r.UNTIL) : null;
    const beforeUntil = naive => !u || (u.allDay || start.allDay
      ? naive < u.naive - (u.naive % DAY_MS) + DAY_MS
      : toMs(naive) <= (u.utc ? u.naive : toMs(u.naive)));
    const startDate = fromUTC(start.naive);
    const timeOfDay = start.naive - toUTC(startDate);
    const byDay = r.BYDAY ? r.BYDAY.split(',').map(d => WEEKDAY_CODES.indexOf(d.slice(-2))) : null;
    const out = [];
    for (let date = startDate, n = 0; n < count && out.length < 3000; date = addDays(date, 1)) {
      const naive = toUTC(date) + timeOfDay;
      if (naive > to || !beforeUntil(naive)) break;
      const match = r.FREQ === 'DAILY'
        ? daysBetween(startDate, date) % interval === 0 && (!byDay || byDay.includes(weekday(date)))
        : (byDay || [weekday(startDate)]).includes(weekday(date)) &&
          Math.floor(daysBetween(mondayOf(startDate), date) / 7) % interval === 0;
      if (!match) continue;
      n++;
      out.push(toMs(naive));
    }
    return out;
  }

  // Turns one occurrence (timestamp `ms`, `length` ms long) into calendar events in
  // Faroe time, one per day it touches. This is the only conversion to Faroe time.
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
    const root = parseICS(text);
    const calendars = root.children.filter(c => c.name === 'VCALENDAR');
    const result = { events: [], unsupported: 0, broken: 0 };
    (calendars.length ? calendars : [root]).forEach(cal => importCalendar(cal, result));
    const notes = [];
    if (result.unsupported) notes.push(`${result.unsupported} event(s) repeat monthly/yearly: only their first date was imported.`);
    if (result.broken) notes.push(`${result.broken} event(s) had dates that could not be read and were skipped.`);
    return { events: result.events, notes };
  }

  function importCalendar(cal, result) {
    // Time zones defined in the file (VTIMEZONE) come first, then known zone names.
    const defined = {};
    cal.children.filter(c => c.name === 'VTIMEZONE').forEach(c => {
      const id = c.props.TZID && c.props.TZID[0].value.trim();
      const zone = id && vtimezoneZone(c);
      if (zone) defined[id] = zone;
    });
    const resolve = tzid => {
      if (!tzid) return null;
      if (defined[tzid]) return defined[tzid];
      const name = WINDOWS_TZ[tzid] || tzid;
      if (validZone(name)) return ianaZone(name);
      const tail = name.split('/').slice(-2).join('/'); // e.g. /mozilla.org/.../Europe/Oslo
      return validZone(tail) ? ianaZone(tail) : null;
    };
    // The calendar's own time zone (X-WR-TIMEZONE). Used for floating times, and for
    // repeating events whose start is written in UTC: Apple Calendar keeps those at the
    // same local clock time all year, so they are repeated in this zone, not in UTC.
    const named = cal.props['X-WR-TIMEZONE'] && resolve(cal.props['X-WR-TIMEZONE'][0].value.trim());
    const calZone = named || ianaZone(TZ);

    // A date or date-time: { naive, allDay, zone }. Floating times use `fallback` or the calendar zone.
    const read = (prop, fallback) => {
      const v = prop && icsValue(prop.value);
      if (!v) return null;
      const zone = v.allDay ? null
        : v.utc ? UTC_ZONE
        : (prop.params.TZID && resolve(prop.params.TZID)) || fallback || calZone;
      return { naive: v.naive, allDay: v.allDay, zone };
    };
    const instant = t => (t.allDay ? t.naive : wallToMs(t.naive, t.zone));
    const get = (v, name) => v.props[name] && v.props[name][0];

    const vevents = cal.children.filter(c => c.name === 'VEVENT');

    // Moved or edited single occurrences (RECURRENCE-ID) replace that occurrence of their series
    const overridden = {};
    vevents.forEach(v => {
      const uid = get(v, 'UID');
      const t = uid && read(get(v, 'RECURRENCE-ID'));
      if (t) (overridden[uid.value] = overridden[uid.value] || []).push(instant(t));
    });

    vevents.forEach(v => {
      const status = get(v, 'STATUS') ? get(v, 'STATUS').value.toUpperCase() : '';
      if (!get(v, 'DTSTART') || status === 'CANCELLED') return;
      let start = read(get(v, 'DTSTART'));
      if (!start) { result.broken++; return; }
      const end = read(get(v, 'DTEND'));
      const length = end ? instant(end) - instant(start)
        : get(v, 'DURATION') ? icsDuration(get(v, 'DURATION').value)
        : start.allDay ? DAY_MS : 0;

      const base = { title: unescapeText(get(v, 'SUMMARY') ? get(v, 'SUMMARY').value : '') || '(No title)' };
      const location = get(v, 'LOCATION') ? unescapeText(get(v, 'LOCATION').value) : '';
      if (location) base.location = location;

      let starts = [instant(start)];
      if (get(v, 'RRULE') && !get(v, 'RECURRENCE-ID')) {
        if (!start.allDay && start.zone === UTC_ZONE && named) {
          start = { naive: msToWall(instant(start), named), allDay: false, zone: named };
        }
        const expanded = expandRule(get(v, 'RRULE').value, start);
        if (expanded) starts = expanded;
        else result.unsupported++;
      }

      const exclude = new Set();
      (v.props.EXDATE || []).forEach(p => p.value.split(',').forEach(x => {
        const t = read({ value: x, params: p.params }, start.zone);
        if (t) exclude.add(instant(t));
      }));
      const uid = get(v, 'UID');
      if (!get(v, 'RECURRENCE-ID') && uid && overridden[uid.value]) {
        overridden[uid.value].forEach(ms => exclude.add(ms));
      }

      starts.forEach(ms => {
        if (!exclude.has(ms)) addOccurrence(result.events, base, start.allDay, ms, length);
      });
    });
  }

  // ---- Start ----------------------------------------------------------------
  render();
  setInterval(() => { if (!drag) render(); }, 60000); // keep the red "now" line current
})();
