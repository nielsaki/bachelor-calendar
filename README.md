# Bachelor – Niels & Ró

A simple weekly calendar for planning bachelor work sessions.

**Live website:** https://nielsaki.github.io/bachelor-calendar/

Plain HTML, CSS and JavaScript. No database, no backend and no build step.

## ⚠️ Important: changes are saved in one browser only

There is no database. Everything you add, move, edit, delete or import on the website is saved
in **that browser's localStorage only**:

- Changes made on one computer or phone **do not appear on other devices**.
- Other people **do not see your changes**.
- Clearing the browser data (or using a private window) **removes your changes**.

Everyone sees the events in [`events.js`](events.js). To share your changes with everyone, put
them in that file (see below).

### Sharing changes with everyone

1. Log in on the website and make your changes (import your timetable, add sessions, …).
2. Click **Export**. This downloads an `events.js` file containing every event you can see.
3. Replace `events.js` in this repository with the downloaded file.
4. Commit and push. GitHub Pages updates the website within a minute or two.

## Using the calendar

- **Viewing:** anyone can open the website and browse weeks with **‹ ›** and **Today**.
  It opens on the current week.
- **Time zone:** times are shown in **Danish time** by default. Use the menu at the top to switch
  to **Faroese time**. The choice is remembered in that browser.
- **Visitors (not logged in)** only see when you are busy, not what you are doing. Overlapping
  events are merged into one block (for example 08:00–08:45 and 08:30–10:00 become one block
  08:00–10:00). Grey blocks say "Busy" and blue blocks say "Bachelor work". Note that this only
  hides the details on the page: the full titles can still be read in `events.js`, which is public.
- **Logging in:** click **Log in** and use username `NielsRo` and password `Britte`.
  Logged in, you see every event with its title. The login is not real security: anyone can
  read the password in `app.js`.

There are two kinds of events:

| Colour | Type | Used for | Can be changed on the website? |
| --- | --- | --- | --- |
| Grey | Fixed | School, work and other times you are busy | Only deleted (when logged in) |
| Blue | Flexible | Bachelor work sessions | Yes, when logged in |

When logged in you can:

- **Create** a session: click an empty slot in the calendar, or click **+ New session**.
- **Edit or delete** a session: click it.
- **Delete** a single fixed (grey) event: click it and click **Delete**. Fixed events can't be
  moved or edited.
- **Move** a session: drag it to another time or day. It snaps to 15 minutes.
- **Repeat** a session every week: tick **Repeat every week** (optionally with an end date). When
  you change, move or delete a weekly session you can choose **Only this week** or **All weeks**.
- **Import a timetable:** click **Import .ics** and choose an `.ics` file (for example exported
  from Google Calendar, Outlook or the school timetable system). Imported events become grey
  fixed events. If you import again you can replace the earlier import or keep both.

### About the .ics import

- Times are converted to Faroe time.
- Repeating events (daily and weekly) are imported from one year ago to one year ahead, with
  their exceptions. Monthly or yearly repeating events only get their first date.
- To remove all imported events at once, import a new timetable and choose **Replace them**.

## Event format (`events.js`)

`events.js` sets `window.INITIAL_EVENTS` to a list of events. Times in `events.js` are always
Faroe time (`Atlantic/Faroe`), whichever time zone the calendar is shown in. Each event looks
like this:

```js
{ "id": "work-mon", "type": "fixed", "title": "Work", "date": "2026-11-09", "start": "16:00", "end": "20:00", "weekly": true }
```

| Field | Required | Meaning |
| --- | --- | --- |
| `id` | yes | Any unique text |
| `type` | yes | `"fixed"` (grey) or `"flexible"` (blue) |
| `title` | yes | Text shown in the calendar |
| `date` | yes | `YYYY-MM-DD`. For weekly events: the first date |
| `start`, `end` | yes, unless `allDay` | `HH:MM`, Faroe time |
| `allDay` | no | `true` for an all-day event (shown above the hours) |
| `weekly` | no | `true` to repeat every week on the same weekday |
| `until` | no | `YYYY-MM-DD`, last date of a weekly event |
| `skip` | no | List of dates (`YYYY-MM-DD`) when a weekly event does not happen |
| `location` | no | Shown under the title |
| `source` | no | `"ics"` for imported events (used by "Replace them" when importing again) |

## Running it locally

Open `index.html` in a browser. Or serve the folder:

```sh
cd bachelor-calendar
python3 -m http.server 8000
# then open http://localhost:8000
```

## Files

- `index.html`: page layout and dialogs
- `style.css`: styling
- `app.js`: calendar, login, editing, `.ics` import and export
- `events.js`: the shared events everyone sees

The calendar shows 06:00–23:00, Monday to Sunday. To change the hours, edit `START_HOUR` and
`END_HOUR` at the top of `app.js`.
