// Синхронизация с Яндекс Календарем прямо с телефона (для тех, у кого нет Планера на компьютере).
// Яндекс не пускает браузер в CalDAV, поэтому запросы идут через посредника в Яндекс Облаке.
// Логика та же, что в app/cal.py на компьютере: связь запись <-> событие хранится в planer.calmap.
'use strict';
const CAL_PROXY = 'https://functions.yandexcloud.net/d4edecbpapp3g7s99vvg';
const CAL_CLIENT = 'b03c086153504ad3849e914ec74b4240';
const CAL_PAST = 30, CAL_FUTURE = 400, CAL_DONE = '✓ ';
const CAL = {busy: false, state: 'idle', err: '', last: LS.get('callast', '')};

function calLogin() {
  location.href = `https://oauth.yandex.ru/authorize?response_type=token&client_id=${CAL_CLIENT}&redirect_uri=${encodeURIComponent(location.origin + location.pathname)}&state=cal&force_confirm=yes`;
}
async function dav(method, path, body, headers) {
  const r = await fetch(CAL_PROXY, {method: 'POST', headers: {'X-Cal-Auth': 'OAuth ' + CFG.cal.token, 'Content-Type': 'application/json'},
    body: JSON.stringify({method, path, headers: headers || {}, body: body || null})});
  if (!r.ok) throw new Error(`посредник ответил ${r.status}`);
  const j = await r.json();
  if (j.status === 401) throw new Error('CAL_AUTH');
  return j;
}
const xml = s => new DOMParser().parseFromString(s, 'application/xml');
const byNS = (n, ns, tag) => Array.from(n.getElementsByTagNameNS(ns, tag));
const DAVNS = 'DAV:', CALNS = 'urn:ietf:params:xml:ns:caldav';

// ---------- iCalendar: разбор ----------
function icsLines(text) {
  return text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/).filter(Boolean);
}
const unesc = v => v.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
function icsParse(text) {
  const root = {name: 'ROOT', props: {}, comps: []}, stack = [root];
  for (const line of icsLines(text)) {
    const i = line.indexOf(':'); if (i < 0) continue;
    const head = line.slice(0, i), val = line.slice(i + 1);
    const [name, ...ps] = head.split(';');
    const params = {}; ps.forEach(p => { const [k, v] = p.split('='); params[k.toUpperCase()] = (v || '').replace(/"/g, ''); });
    const N = name.toUpperCase();
    if (N === 'BEGIN') { const c = {name: val.toUpperCase(), props: {}, comps: []}; stack[stack.length - 1].comps.push(c); stack.push(c); }
    else if (N === 'END') stack.pop();
    else (stack[stack.length - 1].props[N] = stack[stack.length - 1].props[N] || []).push({val, params});
  }
  return root;
}
const prop = (c, n) => c.props[n] && c.props[n][0];
const findComps = (c, n) => c.comps.flatMap(x => x.name === n ? [x] : findComps(x, n));
function tzOffsetMin(tz, utcMs) {  // смещение пояса tz в минутах в момент utcMs
  try {
    const f = new Intl.DateTimeFormat('en-US', {timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'});
    const p = Object.fromEntries(f.formatToParts(new Date(utcMs)).map(x => [x.type, x.value]));
    return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute) - Math.floor(utcMs / 60000) * 60000) / 60000;
  } catch { return TZ * 60; }
}
// значение даты -> {allDay, ms (UTC), date 'YYYY-MM-DD'}
function icsTime(p) {
  if (!p) return null;
  const v = p.val, m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  if (!m[4] || p.params.VALUE === 'DATE') return {allDay: true, date: `${m[1]}-${m[2]}-${m[3]}`, ms: Date.UTC(+m[1], m[2] - 1, +m[3])};
  let ms = Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  if (!m[7]) {
    const tz = p.params.TZID;
    if (tz) { const o1 = tzOffsetMin(tz, ms); ms -= o1 * 60000; const o2 = tzOffsetMin(tz, ms); if (o2 !== o1) ms += (o1 - o2) * 60000; }
    else ms -= TZ * 3600000;  // «плавающее» время считаем местным
  }
  return {allDay: false, ms};
}
function durMin(s) {  // -PT15M, P1D, -PT1H30M
  const m = (s || '').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const v = (+(m[2] || 0)) * 10080 + (+(m[3] || 0)) * 1440 + (+(m[4] || 0)) * 60 + (+(m[5] || 0));
  return m[1] === '-' ? -v : v;
}
// ближайший повтор серии начиная с сегодня (DAILY/WEEKLY/MONTHLY/YEARLY, INTERVAL, BYDAY, COUNT, UNTIL)
function nextOccurrence(start, rrule, exdates) {
  const r = Object.fromEntries(rrule.split(';').map(x => x.split('=')));
  const iv = +(r.INTERVAL || 1), until = r.UNTIL ? icsTime({val: r.UNTIL, params: {}}).ms : Infinity;
  const count = r.COUNT ? +r.COUNT : Infinity;
  const todayMs = fromIso(today()).getTime() - TZ * 3600000;
  const days = r.BYDAY ? r.BYDAY.split(',').map(d => ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'].indexOf(d.slice(-2))) : null;
  const local = ms => new Date(ms + TZ * 3600000);
  let n = 0;
  const ok = ms => !exdates.has(ms);
  if (r.FREQ === 'WEEKLY' && days) {
    const s = local(start.ms), wk0 = s.getTime() - P.wday(s) * 86400000;
    for (let w = 0; w < 2000; w += iv) {
      for (const d of [...days].sort()) {
        const ms = wk0 + (w * 7 + d) * 86400000 - TZ * 3600000;
        if (ms < start.ms) continue;
        if (++n > count || ms > until) return null;
        if (ms + 86400000 > todayMs && ok(ms)) return ms;
      }
    }
    return null;
  }
  for (let k = 0; k < 5000; k += iv) {
    let ms;
    const s = local(start.ms);
    if (r.FREQ === 'DAILY') ms = start.ms + k * 86400000;
    else if (r.FREQ === 'WEEKLY') ms = start.ms + k * 7 * 86400000;
    else if (r.FREQ === 'MONTHLY') { const d = P.addMonths(P.mk(s.getUTCFullYear(), s.getUTCMonth() + 1, s.getUTCDate()), k); ms = d.getTime() + (s.getTime() % 86400000) - TZ * 3600000; }
    else if (r.FREQ === 'YEARLY') { const d = P.addMonths(P.mk(s.getUTCFullYear(), s.getUTCMonth() + 1, s.getUTCDate()), 12 * k); ms = d.getTime() + (s.getTime() % 86400000) - TZ * 3600000; }
    else return null;
    if (++n > count || ms > until) return null;
    if (ms + 86400000 > todayMs && ok(ms)) return ms;
  }
  return null;
}
function fromEvent(ev, occMs) {
  const st = icsTime(prop(ev, 'DTSTART')), en = icsTime(prop(ev, 'DTEND'));
  let title = unesc((prop(ev, 'SUMMARY') || {val: 'Без названия'}).val).trim(), done = false;
  if (title.startsWith(CAL_DONE.trim())) { title = title.slice(CAL_DONE.trim().length).trim(); done = true; }
  const f = {title, place: unesc((prop(ev, 'LOCATION') || {val: ''}).val), notes: unesc((prop(ev, 'DESCRIPTION') || {val: ''}).val), done};
  const ms = occMs != null ? occMs : st.ms;
  if (st.allDay) { f.date = occMs != null ? P.iso(new Date(ms)) : st.date; f.time = null; f.duration = null; f.type = 'task'; }
  else {
    const loc = new Date(ms + TZ * 3600000);
    f.date = P.iso(loc); f.time = P.hm(loc); f.type = 'meeting';
    f.duration = en && !en.allDay && occMs == null ? Math.round((en.ms - st.ms) / 60000) : null;
    if (f.duration != null && (f.duration <= 0 || f.duration > 1440)) f.duration = null;
  }
  f.remind = [...new Set(findComps(ev, 'VALARM').map(a => -durMin((prop(a, 'TRIGGER') || {}).val)).filter(x => x != null && x >= 0))].sort((a, b) => b - a);
  return f;
}

// ---------- iCalendar: сборка ----------
const esc2 = s => String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/([,;])/g, '\\$1');
const utcStamp = ms => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
function fold(line) { const out = []; let s = line; while (s.length > 70) { out.push(s.slice(0, 70)); s = ' ' + s.slice(70); } out.push(s); return out.join('\r\n'); }
function toIcs(it, uid) {
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Planer//RU', 'BEGIN:VEVENT', 'UID:' + uid, 'DTSTAMP:' + utcStamp(Date.now()),
    'SUMMARY:' + esc2((it.done ? CAL_DONE : '') + it.title)];
  if (it.time) {
    const [h, mi] = it.time.split(':').map(Number);
    const ms = fromIso(it.date).getTime() + (h * 60 + mi) * 60000 - TZ * 3600000;
    const dur = it.duration || (it.type === 'meeting' ? 60 : 30);
    L.push('DTSTART:' + utcStamp(ms), 'DTEND:' + utcStamp(ms + dur * 60000));
  } else {
    L.push('DTSTART;VALUE=DATE:' + it.date.replace(/-/g, ''), 'DTEND;VALUE=DATE:' + P.iso(P.addDays(fromIso(it.date), 1)).replace(/-/g, ''));
  }
  if (it.place) L.push('LOCATION:' + esc2(it.place));
  if (it.notes) L.push('DESCRIPTION:' + esc2(it.notes));
  if (!it.done) for (const m of it.remind) L.push('BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc2(it.title), `TRIGGER:-PT${m}M`, 'END:VALARM');
  L.push('END:VEVENT', 'END:VCALENDAR');
  return L.map(fold).join('\r\n') + '\r\n';
}
function calSig(it) {
  return JSON.stringify(['title', 'date', 'time', 'duration', 'place', 'notes', 'done', 'remind', 'deleted'].map(k => it[k] ?? null));
}

// ---------- проход синхронизации ----------
const enc = p => p.split('/').map(encodeURIComponent).join('/');
async function calFind() {
  if (CFG.cal.url) return;
  let r = await dav('PROPFIND', '/', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>', {Depth: '0'});
  const principal = byNS(byNS(xml(r.body), DAVNS, 'current-user-principal')[0], DAVNS, 'href')[0].textContent;
  r = await dav('PROPFIND', principal, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>', {Depth: '0'});
  const home = byNS(byNS(xml(r.body), CALNS, 'calendar-home-set')[0], DAVNS, 'href')[0].textContent;
  r = await dav('PROPFIND', home, '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:displayname/><c:supported-calendar-component-set/></d:prop></d:propfind>', {Depth: '1'});
  for (const resp of byNS(xml(r.body), DAVNS, 'response')) {
    if (byNS(resp, CALNS, 'comp').some(c => c.getAttribute('name') === 'VEVENT')) {
      CFG.cal.url = decodeURIComponent(byNS(resp, DAVNS, 'href')[0].textContent);
      const dn = byNS(resp, DAVNS, 'displayname')[0];
      CFG.cal.name = dn ? dn.textContent : '';
      LS.set('cfg', CFG);
      return;
    }
  }
  throw new Error('в Яндекс Календаре нет календаря для событий');
}
async function calFetch() {
  const t = fromIso(today());
  const a = P.iso(P.addDays(t, -CAL_PAST)).replace(/-/g, '') + 'T000000Z', b = P.iso(P.addDays(t, CAL_FUTURE)).replace(/-/g, '') + 'T000000Z';
  const r = await dav('REPORT', enc(CFG.cal.url), `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${a}" end="${b}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`, {Depth: '1'});
  if (r.status !== 207) throw new Error(`календарь ответил ${r.status}`);
  const out = {};
  for (const resp of byNS(xml(r.body), DAVNS, 'response')) {
    const data = byNS(resp, CALNS, 'calendar-data')[0];
    if (!data || !data.textContent) continue;
    const et = byNS(resp, DAVNS, 'getetag')[0];
    out[decodeURIComponent(byNS(resp, DAVNS, 'href')[0].textContent)] = {etag: et ? et.textContent : null, ics: data.textContent};
  }
  return out;
}
const calExists = async href => (await dav('GET', enc(href))).status !== 404;

async function calOnce() {
  await calFind();
  const remote = await calFetch();
  const map = LS.get('calmap', {});
  const byHref = Object.fromEntries(Object.entries(map).map(([id, m]) => [m.href, id]));
  const lo = P.iso(P.addDays(fromIso(today()), -CAL_PAST));
  // 1. события календаря -> Планер
  for (const [href, r] of Object.entries(remote)) {
    const root = icsParse(r.ics), ev = findComps(root, 'VEVENT')[0];
    if (!ev) continue;
    const uid = (prop(ev, 'UID') || {val: ''}).val;
    let id = byHref[href];
    if (!id && uid.startsWith('planer-')) { id = uid.slice(7).split('@')[0]; if (!find(id)) id = null; }
    const rr = prop(ev, 'RRULE');
    let f;
    if (rr) {
      const ex = new Set((ev.props.EXDATE || []).flatMap(p => p.val.split(',').map(v => (icsTime({val: v, params: p.params}) || {}).ms)));
      const occ = nextOccurrence(icsTime(prop(ev, 'DTSTART')), rr.val, ex);
      if (occ == null) continue;
      f = fromEvent(ev, occ);
    } else f = fromEvent(ev);
    let it = id ? find(id) : null;
    if (!it) {
      it = addItem(Object.assign({}, f, {done: false}), 'calendar');
      if (f.done) complete(it.id, true);
      map[it.id] = {href, etag: r.etag, sig: calSig(find(it.id)), rr: !!rr};
      continue;
    }
    const m = map[it.id] || {href, etag: null, sig: null, rr: !!rr};
    m.href = href;
    if (m.etag == null) m.etag = r.etag;
    if (rr) {
      if (it.done && f.date > (it.date || '')) complete(it.id, false);
      const want = {title: f.title, date: f.date, time: f.time, place: f.place};
      if (Object.entries(want).some(([k, v]) => it[k] !== v)) updateItem(it.id, want);
      Object.assign(m, {etag: r.etag, sig: calSig(find(it.id)), rr: true});
    } else if (r.etag !== m.etag && calSig(it) === m.sig) {
      const done = f.done; delete f.done;
      updateItem(it.id, f);
      if (done !== it.done) complete(it.id, done);
      Object.assign(m, {etag: r.etag, sig: calSig(find(it.id))});
    }
    map[it.id] = m;
  }
  // 2. Планер -> календарь
  for (const it of D.items.slice()) {
    const m = map[it.id];
    if (m && m.rr) {
      if (!remote[m.href] && !(await calExists(m.href))) { delete map[it.id]; if (!it.deleted) setDeleted(it.id, true); }
      continue;
    }
    if (m && it.deleted) { await dav('DELETE', enc(m.href), null, m.etag ? {'If-Match': m.etag} : {}); delete map[it.id]; continue; }
    if (m && !remote[m.href] && it.date && it.date >= lo) {
      if (!(await calExists(m.href))) { delete map[it.id]; setDeleted(it.id, true); }
      continue;
    }
    if (m && !it.date) { await dav('DELETE', enc(m.href)); delete map[it.id]; continue; }
    if (it.deleted || !it.date || it.date < lo) continue;
    const s = calSig(it);
    if (m && s === m.sig) continue;
    const href = m ? m.href : `${CFG.cal.url}planer-${it.id}@planer.ics`;
    let uid = `planer-${it.id}@planer`;
    if (m && remote[href]) { const e = findComps(icsParse(remote[href].ics), 'VEVENT')[0]; if (e && prop(e, 'UID')) uid = prop(e, 'UID').val; }
    const hdr = {'Content-Type': 'text/calendar; charset=utf-8'};
    if (m && m.etag) hdr['If-Match'] = m.etag; else if (!m) hdr['If-None-Match'] = '*';
    let p = await dav('PUT', enc(href), toIcs(it, uid), hdr);
    if (p.status === 412 && m && remote[href]) { hdr['If-Match'] = remote[href].etag; p = await dav('PUT', enc(href), toIcs(it, uid), hdr); }
    if ([200, 201, 204].includes(p.status)) map[it.id] = {href, etag: p.etag, sig: s, rr: false};
  }
  // 3. записи, удаленные навсегда
  for (const id of Object.keys(map)) {
    if (!find(id)) { const m = map[id]; delete map[id]; if (!m.rr) await dav('DELETE', enc(m.href)); }
  }
  LS.set('calmap', map);
}
async function calSync() {
  if (!CFG || !CFG.cal || CFG.cal.bad || CAL.busy) return;
  CAL.busy = true; CAL.state = 'busy'; renderCalChip();
  try {
    await calOnce();
    CAL.state = 'ok'; CAL.err = ''; CAL.last = new Date().toISOString(); LS.set('callast', CAL.last);
  } catch (e) {
    CAL.state = 'err';
    if (e && e.message === 'CAL_AUTH') { CFG.cal.bad = true; LS.set('cfg', CFG); CAL.err = 'нужно заново войти в Яндекс'; }
    else CAL.err = navigator.onLine === false ? 'нет интернета' : (e && e.message === 'Failed to fetch' ? 'нет связи' : String(e.message || e));
  } finally {
    CAL.busy = false; renderCalChip();
  }
}
function renderCalChip() {
  const el = document.getElementById('calchip'); if (el) el.outerHTML = calCardHTML();
}
// карточка на главном экране
function calCardHTML() {
  if (!CFG || !CFG.local) return '';
  const c = CFG.cal;
  if (!c || c.bad) {
    if (!c && LS.get('calhide', false)) return '<div id="calchip"></div>';
    return `<div id="calchip" class="card calc"><div class="calc-i">${ic('cal')}</div><div class="calc-b"><b>${c ? 'Войдите в Яндекс заново' : 'Яндекс Календарь'}</b><span>${c ? 'Вход устарел, синхронизация остановлена' : 'Встречи будут и здесь, и в календаре, с напоминаниями от Яндекса'}</span></div>
      <button class="btn primary sm2" data-act="cal-login">Подключить</button>${c ? '' : `<button class="ib" data-act="cal-hide" aria-label="Скрыть">${ic('x')}</button>`}</div>`;
  }
  const last = CAL.last ? new Date(CAL.last) : null;
  const txt = CAL.state === 'busy' ? 'синхронизирую…' : CAL.state === 'err' ? `<span style="color:var(--danger)">${esc(CAL.err)}</span>` : last ? `синхронизирован в ${pad(last.getHours())}:${pad(last.getMinutes())}` : 'подключен';
  return `<div id="calchip" class="calline">${ic('cal')}<span>Яндекс Календарь: ${txt}</span><button data-act="cal-now">Обновить</button></div>`;
}
