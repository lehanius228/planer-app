// Виджет «Успею» (модуль). Ключ передает скрипт-загрузчик в Scriptable, здесь его нет.
module.exports = async function (TOKEN, REPO, OPEN_URL) {
const LAT = 55.94, LON = 37.50; // Долгопрудный
const ORANGE = new Color("#F0954A");
const TXT = new Color("#F2F0EE");
const DIM = new Color("#9A948E");
const FAINT = new Color("#FFFFFF", 0.08);

const pad = n => String(n).padStart(2, "0");
const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromIso = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };
function nextDate(d, rep) {
  if (rep === "daily") return addDays(d, 1);
  if (rep === "weekdays") { d = addDays(d, 1); while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1); return d; }
  if (rep === "weekly") return addDays(d, 7);
  if (rep === "monthly") return addMonths(d, 1);
  if (rep === "yearly") return addMonths(d, 12);
  return null;
}

const fm = FileManager.local();
async function cached(name, loader) {
  const p = fm.joinPath(fm.documentsDirectory(), name);
  try { const v = await loader(); fm.writeString(p, JSON.stringify(v)); return v; }
  catch (e) { return fm.fileExists(p) ? JSON.parse(fm.readString(p)) : null; }
}

const doc = await cached("uspeyu_cache.json", async () => {
  const r = new Request(`https://api.github.com/repos/${REPO}/contents/sync.json`);
  r.headers = { Authorization: "Bearer " + TOKEN, Accept: "application/vnd.github.raw+json" };
  const d = JSON.parse(await r.loadString());
  if (!d.items) throw new Error("bad");
  return d;
}) || { items: [] };

const weather = await cached("uspeyu_weather.json", async () => {
  const r = new Request(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4`);
  return await r.loadJSON();
});

const now = new Date();
const today = iso(now);
const tomorrow = iso(addDays(now, 1));
const items = (doc.items || [])
  .filter(i => !i.deleted && !i.done && i.date)
  .map(i => {
    let date = i.date;
    if (i.repeat && i.repeat !== "none" && date < today) {
      let d = fromIso(date); const t = fromIso(today);
      while (d && d < t) d = nextDate(d, i.repeat);
      if (d) date = iso(d);
    }
    return { ...i, date };
  })
  .sort((a, b) => ((a.date + (a.time || "99")) < (b.date + (b.time || "99")) ? -1 : 1));
const overdue = items.filter(i => i.date < today && i.type !== "meeting").length;
const upcoming = items.filter(i => i.date >= today);
const busyDays = new Set(upcoming.map(i => i.date));

function wIcon(code) {
  if (code === 0) return "sun.max.fill";
  if (code <= 3) return "cloud.sun.fill";
  if (code <= 48) return "cloud.fog.fill";
  if (code <= 67) return "cloud.rain.fill";
  if (code <= 77) return "cloud.snow.fill";
  if (code <= 82) return "cloud.heavyrain.fill";
  if (code <= 86) return "cloud.snow.fill";
  return "cloud.bolt.fill";
}

// --- мини-календарь картинкой ---
function monthImage() {
  const W = 300, H = 270;
  const c = new DrawContext();
  c.size = new Size(W, H); c.opaque = false; c.respectScreenScale = true;
  const box = new Path(); box.addRoundedRect(new Rect(0, 0, W, H), 26, 26);
  c.addPath(box); c.setFillColor(FAINT); c.fillPath();
  c.setTextAlignedCenter();
  c.setFont(Font.semiboldSystemFont(17)); c.setTextColor(DIM);
  const title = now.toLocaleDateString("ru-RU", { month: "short", year: "numeric" }).replace(" г.", "");
  c.drawTextInRect(title, new Rect(150, 14, 140, 24));
  const days = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const cw = (W - 24) / 7, x0 = 12, y0 = 44, rh = 34;
  c.setFont(Font.mediumSystemFont(14));
  days.forEach((d, i) => { c.setTextColor(i >= 5 ? ORANGE : DIM); c.drawTextInRect(d, new Rect(x0 + i * cw, y0, cw, 20)); });
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const shift = (first.getDay() + 6) % 7;
  const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  c.setFont(Font.mediumSystemFont(16));
  for (let d = 1; d <= dim; d++) {
    const k = shift + d - 1, col = k % 7, row = Math.floor(k / 7);
    const r = new Rect(x0 + col * cw, y0 + 26 + row * rh, cw, rh);
    const ds = iso(new Date(now.getFullYear(), now.getMonth(), d));
    if (d === now.getDate()) {
      c.setFillColor(ORANGE); c.fillEllipse(new Rect(r.x + cw / 2 - 15, r.y + 1, 30, 30));
      c.setTextColor(new Color("#1A1612"));
    } else c.setTextColor(ds < today ? new Color("#FFFFFF", 0.35) : TXT);
    c.drawTextInRect(String(d), new Rect(r.x, r.y + 6, cw, 22));
    if (busyDays.has(ds) && d !== now.getDate()) {
      c.setFillColor(ORANGE); c.fillEllipse(new Rect(r.x + cw / 2 - 2.5, r.y + 28, 5, 5));
    }
  }
  return c.getImage();
}

// --- экран блокировки ---
const fam = config.widgetFamily || "";
if (fam.startsWith("accessory")) {
  const a = new ListWidget();
  a.url = OPEN_URL;
  a.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  const next = upcoming[0];
  const todayCount = upcoming.filter(i => i.date === today).length;
  const whenOf = it => it.date === today ? (it.time || "сегодня") : it.date === tomorrow ? `завтра${it.time ? " " + it.time : ""}` :
    fromIso(it.date).toLocaleDateString("ru-RU", { day: "numeric", month: "short" }) + (it.time ? " " + it.time : "");
  if (fam === "accessoryInline") {
    // строка над часами
    const t = weather && weather.current ? `${Math.round(weather.current.temperature_2m)}°  ` : "";
    a.addText(next ? `${t}${whenOf(next)} · ${next.title}` : `${t}Дел нет`);
  } else if (fam === "accessoryCircular") {
    a.addAccessoryWidgetBackground = true;
    const s = a.addStack(); s.layoutVertically(); s.centerAlignContent();
    const n = s.addText(String(todayCount)); n.font = Font.boldRoundedSystemFont(24); n.centerAlignText();
    const l = s.addText("сегодня"); l.font = Font.systemFont(9); l.centerAlignText();
  } else {
    // прямоугольный: два ближайших дела
    const h = a.addText(overdue ? `Успею · просрочено ${overdue}` : "Успею");
    h.font = Font.boldSystemFont(13);
    if (!upcoming.length) { const e = a.addText("Дел нет"); e.font = Font.systemFont(13); }
    for (const it of upcoming.slice(0, 2)) {
      const r = a.addText(`${whenOf(it)}  ${it.title || "Без названия"}`);
      r.font = Font.systemFont(13); r.lineLimit = 1;
    }
  }
  return a;
}

// --- сборка ---
const w = new ListWidget();
const g = new LinearGradient();
g.colors = [new Color("#2A2522", 0.92), new Color("#3A2A1F", 0.92)];
g.locations = [0, 1];
w.backgroundGradient = g;
w.setPadding(16, 18, 14, 18);
w.url = OPEN_URL;

// шапка: вкладки + погода
const head = w.addStack(); head.centerAlignContent();
const tab1 = head.addText("Календарь"); tab1.font = Font.semiboldSystemFont(13); tab1.textColor = ORANGE;
head.addSpacer(14);
const tab2 = head.addText("Погода"); tab2.font = Font.mediumSystemFont(13); tab2.textColor = TXT;
head.addSpacer();
if (weather && weather.current) {
  const ic = head.addImage(SFSymbol.named(wIcon(weather.current.weather_code)).image);
  ic.imageSize = new Size(15, 15); ic.tintColor = ORANGE;
  head.addSpacer(5);
  const tt = head.addText(`${Math.round(weather.current.temperature_2m)}°`);
  tt.font = Font.semiboldSystemFont(14); tt.textColor = TXT;
  if (weather.daily) {
    head.addSpacer(6);
    const mm = head.addText(`${Math.round(weather.daily.temperature_2m_max[0])}° / ${Math.round(weather.daily.temperature_2m_min[0])}°`);
    mm.font = Font.systemFont(11); mm.textColor = DIM;
  }
}
w.addSpacer(4);
const line = w.addStack(); line.size = new Size(0, 2); line.backgroundColor = new Color("#FFFFFF", 0.12);
const u = line.addStack(); u.size = new Size(78, 2); u.backgroundColor = ORANGE;
line.addSpacer();
w.addSpacer(12);

// середина: большая дата + месяц
const mid = w.addStack(); mid.centerAlignContent();
const left = mid.addStack(); left.layoutVertically();
const big = left.addText(String(now.getDate())); big.font = Font.lightSystemFont(64); big.textColor = TXT;
const wd = now.toLocaleDateString("ru-RU", { weekday: "long" });
const wdt = left.addText(wd[0].toUpperCase() + wd.slice(1)); wdt.font = Font.semiboldSystemFont(20); wdt.textColor = ORANGE;
const mt = left.addText(now.toLocaleDateString("ru-RU", { month: "long", year: "numeric" }).replace(" г.", ""));
mt.font = Font.systemFont(12); mt.textColor = DIM;
mid.addSpacer();
const cal = mid.addImage(monthImage()); cal.imageSize = new Size(150, 135);
w.addSpacer(14);

// низ: дела из Успею
const listHead = w.addStack();
const lh = listHead.addText("Успею"); lh.font = Font.semiboldSystemFont(12); lh.textColor = DIM;
listHead.addSpacer();
if (overdue) { const od = listHead.addText(`просрочено ${overdue}`); od.font = Font.mediumSystemFont(11); od.textColor = new Color("#FF6B5B"); }
w.addSpacer(6);
if (!upcoming.length) {
  const e = w.addText("Дел нет. Можно отдыхать"); e.font = Font.systemFont(13); e.textColor = DIM;
} else {
  for (const it of upcoming.slice(0, upcoming.length > 3 ? 4 : 3)) {
    const row = w.addStack(); row.centerAlignContent();
    const dot = row.addStack(); dot.size = new Size(7, 7); dot.cornerRadius = 3.5;
    dot.backgroundColor = it.date === today ? ORANGE : new Color("#FFFFFF", 0.35);
    row.addSpacer(8);
    const t = row.addText(it.title || "Без названия"); t.font = Font.mediumSystemFont(13); t.textColor = TXT; t.lineLimit = 1;
    row.addSpacer();
    const when = it.date === today ? "сегодня" : it.date === tomorrow ? "завтра" :
      fromIso(it.date).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
    const wt = row.addText(it.time ? `${when}, ${it.time}` : when); wt.font = Font.systemFont(11); wt.textColor = DIM;
    w.addSpacer(6);
  }
}
w.addSpacer();
// прогноз на 3 дня
if (weather && weather.daily && weather.daily.time && weather.daily.time.length > 3) {
  const fr = w.addStack(); fr.centerAlignContent();
  fr.backgroundColor = new Color("#FFFFFF", 0.06); fr.cornerRadius = 14; fr.setPadding(8, 12, 8, 12);
  for (let k = 1; k <= 3; k++) {
    const cell = fr.addStack(); cell.centerAlignContent();
    const dn = fromIso(weather.daily.time[k]).toLocaleDateString("ru-RU", { weekday: "short" });
    const dt = cell.addText(dn[0].toUpperCase() + dn.slice(1)); dt.font = Font.mediumSystemFont(12); dt.textColor = DIM;
    cell.addSpacer(6);
    const im = cell.addImage(SFSymbol.named(wIcon(weather.daily.weather_code[k])).image); im.imageSize = new Size(14, 14); im.tintColor = ORANGE;
    cell.addSpacer(6);
    const tv = cell.addText(`${Math.round(weather.daily.temperature_2m_max[k])}°/${Math.round(weather.daily.temperature_2m_min[k])}°`);
    tv.font = Font.mediumSystemFont(12); tv.textColor = TXT;
    if (k < 3) fr.addSpacer();
  }
}
w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

return w;
};
