// Разбор фраз на русском - перенос app/parse_ru.py один в один (проверка: node test_parse.mjs).
// Даты считаются в поясе планера: объект Date, у которого UTC-поля = местное время планера.
(function (root) {
'use strict';
const W = '[\\p{L}\\p{N}_]';
const B = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;
const cache = new Map();
function rx(src, flags = 'iu') {
  const k = flags + '|' + src;
  let r = cache.get(k);
  if (!r) { r = new RegExp(src.replace(/\\b/g, B).replace(/\\w/g, W), flags); cache.set(k, r); }
  r.lastIndex = 0;
  return r;
}
const R = String.raw;

const UNITS = {
  'ноль': 0, 'один': 1, 'одна': 1, 'одну': 1, 'одного': 1, 'два': 2, 'две': 2, 'двух': 2,
  'три': 3, 'трех': 3, 'четыре': 4, 'четырех': 4, 'пять': 5, 'пяти': 5, 'шесть': 6, 'шести': 6,
  'семь': 7, 'семи': 7, 'восемь': 8, 'восьми': 8, 'девять': 9, 'девяти': 9, 'десять': 10, 'десяти': 10,
  'одиннадцать': 11, 'двенадцать': 12, 'тринадцать': 13, 'четырнадцать': 14, 'пятнадцать': 15,
  'шестнадцать': 16, 'семнадцать': 17, 'восемнадцать': 18, 'девятнадцать': 19,
};
const TENS = {'двадцать': 20, 'тридцать': 30, 'сорок': 40, 'пятьдесят': 50};
const ORD = {
  'первого': 1, 'второго': 2, 'третьего': 3, 'четвертого': 4, 'пятого': 5, 'шестого': 6,
  'седьмого': 7, 'восьмого': 8, 'девятого': 9, 'десятого': 10, 'одиннадцатого': 11,
  'двенадцатого': 12, 'тринадцатого': 13, 'четырнадцатого': 14, 'пятнадцатого': 15,
  'шестнадцатого': 16, 'семнадцатого': 17, 'восемнадцатого': 18, 'девятнадцатого': 19,
  'двадцатого': 20, 'тридцатого': 30,
};
const MONTHS = ['январ', 'феврал', 'март', 'апрел', 'ма', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
const MONTH_RE = '(январ[яьею]|феврал[яьею]|март[аеу]?|апрел[яьею]|ма[яйею]|июн[яьею]|июл[яьею]|август[аеу]?|сентябр[яьею]|октябр[яьею]|ноябр[яьею]|декабр[яьею])';
const WD_RE = R`(понедельник\w*|вторник\w*|сред\w*|четверг\w*|пятниц\w*|суббот\w*|воскресень\w*|пн|вт|ср|чт|пт|сб|вс)`;
const WD_KEYS = [['понед', 0], ['вторн', 1], ['сред', 2], ['четв', 3], ['пятн', 4], ['субб', 5], ['воскр', 6],
  ['пн', 0], ['вт', 1], ['ср', 2], ['чт', 3], ['пт', 4], ['сб', 5], ['вс', 6]];
const EXCL_AFTER = R`(?!\s*(?:кабинет|этаж|ауд|офис|зал|раз\b|%|руб|тыс|экз|стр|лист|документ|копи|числ|минут|мин\b|дн|день|недел|месяц|год|лет|человек|шт|пункт|п\.|ст\.|стать|част))`;
const MEETING = R`(встреч|созвон|звонок с|заседани|\bсуд\b|в суде|судебн|переговор|совещани|консультаци|при[её]м\b|собеседовани|конференц|\bzoom\b|\bзум\b|обед с|ужин с|планерк|вебинар|семинар|допрос|следовател|ознакомлени)`;
const DEADLINE = R`(срок|дедлайн|крайний день|истекает|последний день|подать до|сдать до|оплатить до)`;

// --- даты ---
const mk = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const dim = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const valid = (y, m, d) => m >= 1 && m <= 12 && d >= 1 && d <= dim(y, m);
const Y = d => d.getUTCFullYear(), M = d => d.getUTCMonth() + 1, Dd = d => d.getUTCDate();
const iso = d => d.toISOString().slice(0, 10);
const hm = d => d.toISOString().slice(11, 16);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const addMin = (d, n) => new Date(d.getTime() + n * 60000);
const wday = d => (d.getUTCDay() + 6) % 7;
function addMonths(d, n) {
  const m0 = M(d) - 1 + n, y = Y(d) + Math.floor(m0 / 12), m = ((m0 % 12) + 12) % 12 + 1;
  return mk(y, m, Math.min(Dd(d), dim(y, m)));
}
function isoWeek(d) {
  const t = mk(Y(d), M(d), Dd(d)), day = wday(t);
  const th = addDays(t, 3 - day), y1 = mk(Y(th), 1, 1);
  return 1 + Math.floor((th - y1) / 86400000 / 7);
}
function pyRound(x) {  // банковское округление, как round() в Python
  const f = Math.floor(x), diff = x - f;
  if (Math.abs(diff - 0.5) < 1e-9) return f % 2 === 0 ? f : f + 1;
  return Math.round(x);
}
function nowTz(off) { const d = new Date(Date.now() + off * 3600000); d.setUTCSeconds(0, 0); return d; }

function _wd(word) {
  const w = word.toLowerCase();
  for (const [k, v] of WD_KEYS) if (w.startsWith(k)) return v;
  return null;
}
const byLen = o => Object.keys(o).sort((a, b) => b.length - a.length);

function wordsToDigits(s) {
  const units = byLen(UNITS).join('|');
  const tens = Object.keys(TENS).join('|');
  const ords = byLen(ORD).join('|');
  const ordUnits = Object.keys(ORD).filter(k => ORD[k] < 10).join('|');
  s = s.replace(rx(R`\b(${tens})\s+(${ordUnits})\b`, 'giu'), (_, a, b) => `${TENS[a.toLowerCase()] + ORD[b.toLowerCase()]}-го`);
  s = s.replace(rx(R`(?<!половине )(?<!половину )\b(${ords})\b(?=\s+(?:${MONTH_RE}|числа))`, 'giu'), (_, a) => `${ORD[a.toLowerCase()]}-го`);
  s = s.replace(rx(R`\b(${tens})(?:\s+(один|одна|одну|два|две|три|четыре|пять|шесть|семь|восемь|девять))?\b`, 'giu'),
    (_, a, b) => String(TENS[a.toLowerCase()] + (b ? UNITS[b.toLowerCase()] : 0)));
  s = s.replace(rx(R`\b(${units})\b`, 'giu'), (_, a) => String(UNITS[a.toLowerCase()]));
  return s;
}

function _hour(h, qual, strict) {
  const q = (qual || '').toLowerCase();
  if (['дня', 'вечера', 'вечером', 'днем'].includes(q) && h < 12) h += 12;
  else if (q === 'ночи' || q === 'ночью') { if (h === 12) h = 0; else if (h >= 6 && h < 12) h += 12; }
  else if (!q && !strict && h >= 1 && h <= 7) h += 12;
  return h;
}
function _amount(num, half, oneandhalf) {
  if (half) return 0.5;
  if (oneandhalf) return 1.5;
  if (num) return parseFloat(num.replace(',', '.'));
  return 1.0;
}
function _unitMinutes(unit) {
  const u = unit.toLowerCase();
  if (u.startsWith('мин')) return 1;
  if (u.startsWith('ч')) return 60;
  if (u.startsWith('д') || u.startsWith('сут')) return 1440;
  if (u.startsWith('нед')) return 10080;
  return null;
}

function parse(text, now, off) {
  if (!now) now = nowTz(off == null ? 3 : off);
  now = new Date(now.getTime()); now.setUTCSeconds(0, 0);
  const today = mk(Y(now), M(now), Dd(now));
  const original = (text || '').trim();
  let s = original.replace(/ё/g, 'е').replace(/Ё/g, 'Е').replace(/[—–]/g, '-');
  s = ' ' + wordsToDigits(s.replace(/\s+/g, ' ')) + ' ';
  const lowAll = s.toLowerCase();
  const r = {date: null, time: null, duration: null, remind: [], repeat: 'none', tags: [], important: false, urgent: false, type: null};
  const st = {s, dl: false};

  function take(pat, fn, many) {
    let hit = false;
    const re = rx(pat);
    for (;;) {
      const m = st.s.match(re);
      if (!m) return hit;
      if (fn(m) === false) return hit;
      st.s = st.s.slice(0, m.index) + ' ' + st.s.slice(m.index + m[0].length);
      hit = true;
      if (!many) return hit;
    }
  }

  take('#([\\p{L}\\p{N}_-]+)', m => { r.tags.push(m[1]); }, true);
  take(R`(?<!\S)!{1,3}(?!\S)`, () => { r.important = true; });
  take(R`\b(?:очень\s+)?срочн(?:о|ое|ая|ый)\b`, () => { r.urgent = true; r.important = true; });
  take(R`\b(?:очень\s+)?важн(?:о|ое|ая|ый)\b`, () => { r.important = true; });

  take(R`(?:\bнапомн\w*\s+(?:мне\s+)?|\bуведом\w*\s+(?:меня\s+)?)?\bза\s+(?:(\d+(?:[.,]5)?)\s*|(пол)\s*|(полтора)\s+)?` +
       R`(минут\w*|мин\b|час\w*|ч\b|дн\w*|день|сутки|недел\w+)` +
       R`(\s+до\s+(?:начала|встречи|события|этого|заседания|срока))?`, m => {
    const mins = _unitMinutes(m[4]);
    if (mins == null) return false;
    const g0 = m[0].toLowerCase().trim();
    const explicit = g0.startsWith('напомн') || g0.startsWith('уведом') || !!m[5];
    if (!explicit && mins >= 1440 && !lowAll.includes('напомн')) return false;
    r.remind.push(pyRound(_amount(m[1], m[2], m[3]) * mins));
  }, true);

  const rep = kind => () => { r.repeat = kind; };
  take(R`\b(?:каждый\s+день|ежедневно|каждое\s+утро|каждый\s+вечер)\b`, rep('daily'));
  take(R`\b(?:по\s+будням|каждый\s+будний\s+день|в\s+будни)\b`, rep('weekdays'));
  take(R`\b(?:каждую\s+неделю|еженедельно|раз\s+в\s+неделю)\b`, rep('weekly'));
  take(R`\b(?:каждый\s+месяц|ежемесячно|раз\s+в\s+месяц)\b`, rep('monthly'));
  take(R`\b(?:каждый\s+год|ежегодно|раз\s+в\s+год)\b`, rep('yearly'));

  take(R`\b(?:каждый|каждую|каждое|по)\s+` + WD_RE + R`\b`, m => {
    const w = _wd(m[1]);
    if (w == null) return false;
    r.repeat = 'weekly';
    r.date = iso(addDays(today, ((w - wday(today)) % 7 + 7) % 7));
  });

  function nextDay(day) {  // ближайшее число day начиная с сегодня
    let d = today;
    for (let i = 0; i < 13; i++) {
      if (valid(Y(d), M(d), day)) { const c = mk(Y(d), M(d), day); if (c >= today) return c; }
      d = addMonths(mk(Y(d), M(d), 1), 1);
    }
    return null;
  }
  take(R`\b(каждое\s+)?(\d{1,2})(?:-?(?:е|го))?\s+числ\w*(\s+каждого\s+месяца)?`, m => {
    const day = +m[2];
    if (day < 1 || day > 31) return false;
    const c = nextDay(day);
    if (!c) return false;
    r.date = iso(c);
    if (m[1] || m[3]) r.repeat = 'monthly';
  });

  take(R`\b(?:на|продолжительностью|длительностью)\s+(?:(\d+(?:[.,]5)?)\s*|(пол)\s*|(полтора)\s+)?(час\w*|минут\w*|мин\b)`, m => {
    const mins = _unitMinutes(m[4]);
    if (mins == null || mins > 60) return false;
    r.duration = pyRound(_amount(m[1], m[2], m[3]) * mins);
  });

  take(R`\bс\s+(\d{1,2})(?::(\d{2}))?\s+до\s+(\d{1,2})(?::(\d{2}))?(?!\d)(?!\s*(?:числ|` + MONTH_RE + '))', m => {
    let h1 = +m[1], m1 = +(m[2] || 0), h2 = +m[3], m2 = +(m[4] || 0);
    h1 = _hour(h1); h2 = _hour(h2);
    if (h2 < h1 && h2 + 12 <= 23) h2 += 12;
    if (!(h1 <= 23 && h2 <= 23 && m1 < 60 && m2 < 60) || (h2 * 60 + m2) <= (h1 * 60 + m1)) return false;
    r.time = `${String(h1).padStart(2, '0')}:${String(m1).padStart(2, '0')}`;
    r.duration = (h2 * 60 + m2) - (h1 * 60 + m1);
  });

  take(R`\bчерез\s+(?:(\d+(?:[.,]5)?)\s*|(пол)\s*|(полтора)\s+)?(минут\w*|мин\b|час\w*|ч\b|дн\w*|день|сутки|недел\w+|месяц\w*|год\w*|лет)\b`, m => {
    const a = _amount(m[1], m[2], m[3]), u = m[4].toLowerCase();
    if (u.startsWith('мин') || u.startsWith('ч')) {
      const t = addMin(now, pyRound(a * (u.startsWith('мин') ? 1 : 60)));
      r.date = iso(t); r.time = hm(t);
    } else if (u.startsWith('д') || u.startsWith('сут')) r.date = iso(addDays(today, pyRound(a)));
    else if (u.startsWith('нед')) r.date = iso(addDays(today, pyRound(a * 7)));
    else if (u.startsWith('мес')) r.date = iso(addMonths(today, Math.max(1, pyRound(a))));
    else if (u.startsWith('год') || u.startsWith('лет')) r.date = iso(addMonths(today, 12 * Math.max(1, pyRound(a))));
  });

  take(R`\bпослезавтра\b`, () => { r.date = iso(addDays(today, 2)); });
  take(R`\bзавтра\b`, () => { r.date = iso(addDays(today, 1)); });
  take(R`\bсегодня\b`, () => { r.date = iso(today); });
  take(R`\b(?:на|в)\s+следующей\s+неделе\b`, () => { r.date = iso(addDays(today, 7 - wday(today))); });
  take(R`\b(?:в|на)\s+(?:эти\s+)?выходн\w+\b`, () => { r.date = iso(addDays(today, ((5 - wday(today)) % 7 + 7) % 7)); });

  take(R`\b(?:(до|к|на|с|по)\s+)?(\d{1,2})(?:-?(?:го|е))?\s+` + MONTH_RE + R`\b(?:\s+(\d{4})(?:\s*(?:г\.?|года?)\b)?)?`, m => {
    const day = +m[2], mw = m[3].toLowerCase();
    const mon = MONTHS.findIndex(k => mw.startsWith(k)) + 1;
    let year = m[4] ? +m[4] : Y(today);
    if (!valid(year, mon, day)) return false;
    let d = mk(year, mon, day);
    if (!m[4] && d < today) {
      if (!valid(year + 1, mon, day)) return false;
      d = mk(year + 1, mon, day);
    }
    r.date = iso(d);
    if (m[1] && m[1].toLowerCase().startsWith('до')) st.dl = true;
  });

  take(R`(?<![\d:.])(?:\b(в|к|до|с|по|на|около)\s+)?(\d{1,2})[./](\d{1,2})(?:[./](\d{4}|\d{2}))?(?![\d:])(?:\s*(утра|дня|вечера|ночи)\b)?`, m => {
    const prep = (m[1] || '').toLowerCase();
    const a = +m[2], b = +m[3], y = m[4];
    let asTime = false;
    if (!y) {
      if ((prep === 'в' || prep === 'около') && a <= 23 && b <= 59) asTime = true;
      else if (b > 12 && a <= 23 && b <= 59) asTime = true;
    }
    if (asTime) {
      r.time = `${String(_hour(a, m[5], true)).padStart(2, '0')}:${String(b).padStart(2, '0')}`;
      return;
    }
    let year = Y(today);
    if (y) year = +y + (y.length === 2 ? 2000 : 0);
    if (!valid(year, b, a)) return false;
    let d = mk(year, b, a);
    if (!y && d < today) {
      if (!valid(year + 1, b, a)) return false;
      d = mk(year + 1, b, a);
    }
    r.date = iso(d);
    if (prep === 'до') st.dl = true;
  });

  take(R`\b(?:на|к|до)?\s*(\d{1,2})-?го\b`, m => {
    const day = +m[1];
    if (day < 1 || day > 31 || r.date) return false;
    const c = nextDay(day);
    if (!c) return false;
    r.date = iso(c);
  });

  take(R`\b(?:(?:в|во|на|к|ко|до)\s+)?(?:(следующ\w*|эт\w*|ближайш\w*)\s+)?` + WD_RE + R`\b`, m => {
    const w = _wd(m[2]);
    if (w == null || r.date) return false;
    const ahead = ((w - wday(today)) % 7 + 7) % 7 || 7;
    let d = addDays(today, ahead);
    const mod = (m[1] || '').toLowerCase();
    if (mod.startsWith('следующ') && isoWeek(d) === isoWeek(today)) d = addDays(d, 7);
    if (mod.startsWith('эт') && ahead === 7) d = today;
    r.date = iso(d);
  });

  function setTime(h, mi, qual, strict) {
    h = _hour(h, qual, strict);
    if (h > 23 || mi > 59) return false;
    r.time = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
  }
  if (!r.time) take(R`\b(?:в|к|около|до)?\s*полдень\b`, () => setTime(12, 0, null, true));
  if (!r.time) take(R`\b(?:в|к)\s+обед\b`, () => setTime(13, 0, null, true));
  if (!r.time) {
    take(R`\b(?:в|к|около)\s+половин\w*\s+(` + Object.keys(ORD).join('|') + R`|\d{1,2}(?:-?го)?)(?:\s+(утра|дня|вечера|ночи))?`, m => {
      const g = m[1].toLowerCase();
      const dg = g.replace(/\D/g, '');
      const n = ORD[g] || (dg ? +dg : null);
      if (!n || n > 12) return false;
      return setTime(n > 1 ? n - 1 : 12, 30, m[2]);
    });
  }
  if (!r.time) take(R`(?<![\d.])\b(?:(?:в|к|около|до|с|на)\s+)?(\d{1,2}):(\d{2})\b(?:\s*(утра|дня|вечера|ночи)\b)?`,
    m => setTime(+m[1], +m[2], m[3], true));
  if (!r.time) take(R`\b(?:в|к|около|до)\s+(\d{1,2})\s+(\d{2})(?!\d)` + EXCL_AFTER + R`(?:\s*(утра|дня|вечера|ночи)\b)?`,
    m => setTime(+m[1], +m[2], m[3]));
  if (!r.time) take(R`\b(?:в|к|около|до|на)\s+(\d{1,2})(?!\d)(?:\s*(?:ч\b\.?|час\w*))?(?:\s*(\d{1,2})\s*мин\w*)?` +
    R`(?:\s*(утра|дня|вечера|ночи)\b)?` + EXCL_AFTER, m => setTime(+m[1], +(m[2] || 0), m[3]));
  if (!r.time) take(R`\b(\d{1,2})(?!\d)\s*(?:час\w*\s+)?(утра|дня|вечера|ночи)\b`, m => setTime(+m[1], 0, m[2]));
  if (!r.time) {
    for (const [pat, h] of [[R`\b(?:утром|с\s+утра)\b`, 9], [R`\bдн[её]м\b`, 13], [R`\bвечером\b`, 19], [R`\bночью\b`, 22]]) {
      if (take(pat, () => setTime(h, 0, null, true))) break;
    }
  }

  if (r.time && !r.date) {
    const [h, mi] = r.time.split(':').map(Number);
    const cand = new Date(today.getTime() + (h * 60 + mi) * 60000);
    r.date = iso(cand >= addMin(now, -1) ? today : addDays(today, 1));
  }

  const low = lowAll;
  if (rx(R`^\s*(напомн|не\s+забыть|не\s+забудь)`).test(low)) r.type = 'reminder';
  else if (rx(MEETING).test(low)) r.type = 'meeting';
  else if (rx(DEADLINE).test(low) || st.dl) r.type = 'deadline';
  else r.type = 'task';

  let t = st.s;
  t = t.replace(rx(R`^\s*(?:напомни(?:те)?|напомнить|напоминание)\s*(?:мне\s+)?(?:,\s*)?(?:о|об|про|что(?:бы)?|чтобы)?\s+`), ' ');
  t = t.replace(rx(R`^\s*(?:не\s+забыть|не\s+забудь)\s*(?:,\s*)?`), ' ');
  t = t.replace(rx(R`^\s*(?:мне\s+)?(?:надо|нужно|необходимо)\s+`), ' ');
  t = t.replace(/\s+/g, ' ').trim();
  const edge = '(?:в|во|на|к|ко|до|с|со|по|и|а|около|часов|часа|час|,|-|\\.|;|:)';
  for (let i = 0; i < 4; i++) {
    t = t.replace(rx(`^(?:${edge})(?:\\s+|$)`), '').trim();
    t = t.replace(rx(`(?:^|\\s+)(?:${edge})$`), '').trim();
    t = t.replace(rx(R`\s+(?:в|во|на|к|до|с)\s+(?=(?:и|,)\s)`, 'giu'), ' ');
    t = t.replace(/\s+([,.;:!?])/g, '$1');
    t = t.replace(/\s+/g, ' ').trim();
  }
  t = t.replace(/^[ ,.;:-]+|[ ,.;:-]+$/g, '');
  if (!t) t = original || 'Без названия';
  r.title = t.slice(0, 1).toUpperCase() + t.slice(1);

  if (!r.remind.length) {
    if (r.type === 'meeting' && r.time) r.remind = [30];
    else if (r.type === 'deadline' && r.date) r.remind = [4320, 1440, 0];
    else if ((r.type === 'reminder' || r.type === 'task') && r.date && (r.time || r.type === 'reminder')) r.remind = [0];
  }
  r.remind = [...new Set(r.remind)].sort((a, b) => b - a);
  if (r.type === 'meeting' && r.time && !r.duration) r.duration = 60;
  if (r.repeat !== 'none' && !r.date) r.date = iso(today);
  return r;
}

const api = {parse, nowTz, mk, iso, hm, addDays, addMonths, wday, valid, dim};
if (typeof module !== 'undefined' && module.exports) module.exports = api;
else root.ParseRu = api;
})(typeof self !== 'undefined' ? self : this);
