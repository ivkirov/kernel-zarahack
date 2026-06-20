// ============================================================================
//  i18n — lightweight, dependency-free internationalization for the TPM frontend
// ----------------------------------------------------------------------------
//  • Two locales: Bulgarian (default) and English.
//  • Locale is cached in the browser (localStorage) so it survives reloads.
//  • Switching locale NEVER reloads the page — it re-translates the DOM in place
//    (every [data-i18n*] node) and notifies listeners so JS-rendered UI updates.
//
//  Load order matters: this file must run before config.js / app.js so the
//  global `t()` and `window.I18n` are available when they build dynamic UI.
// ============================================================================
(function () {
  "use strict";

  const STORAGE_KEY = "tpm_locale";
  const DEFAULT_LOCALE = "bg";
  const LOCALES = ["bg", "en"];

  // --- Translation tables ---------------------------------------------------
  // Flat dotted keys. `{name}` placeholders are filled by t(key, params).
  const DICT = {
    en: {
      // Brand
      "brand": "The Time Poverty Matrix",

      // Language switcher
      "lang.aria": "Change language",
      "lang.name.bg": "Български",
      "lang.name.en": "English",

      // Landing portal
      "landing.badge": "Bulgaria · 28 provinces · real open data",
      "landing.subtitle": "The geography of lost time — the invisible commute tax that thin infrastructure puts on young children and seniors. Pick a lens to begin.",
      "landing.municipal.title": "Municipal planner",
      "landing.municipal.desc": "Simulate civic facility placements, read regional time-loss across a district, and let a trained model recommend the highest-impact build sites.",
      "landing.municipal.cta": "Open planner",
      "landing.personal.title": "Relocation planner",
      "landing.personal.desc": "Drop two pins — your current home and a prospective one — and compare the weekly hours each address would cost your household in travel.",
      "landing.personal.cta": "Compare two homes",
      "landing.footer": "Built on OpenStreetMap · NSI census · GeoNames — 349 settlements, 2,772 services.",

      // Map overlays
      "map.loading.matrix": "Loading the time-poverty matrix…",
      "map.loading.services": "Loading nearby services…",
      "layers.title": "Layers",
      "layers.collapse": "Collapse layers",
      "layers.timePoverty": "Time-poverty",
      "amenity.place": "Place a",
      "amenity.tapMap": "tap the map",
      "legend.title": "Legend",
      "legend.collapse": "Collapse legend",
      "legend.goodAccess": "good access",
      "legend.severe": "severe time-poverty",
      "legend.rampNote": "Circle size = population · colour = nearest-service travel time",
      "legend.simSite": "Your simulated site",
      "legend.aiSite": "AI-recommended site",
      "legend.dotsNote": "Service dots are keyed in the Layers panel ↗",
      "legend.current": "Current residence",
      "legend.prospective": "Prospective residence",
      "legend.personalNote": "Drop both pins to compare weekly travel hours.",

      // Amenity dropdown (what to simulate)
      "amenityOpt.kindergarten": "Kindergarten · children 0–6",
      "amenityOpt.school": "School · children 0–6",
      "amenityOpt.clinic": "Clinic · seniors 65+",
      "amenityOpt.hospital": "Hospital · seniors 65+",

      // Dashboard
      "dash.viewing": "Viewing",
      "dash.modes": "← Modes",
      "dash.modesTitle": "Back to mode selection",
      "scope.provinces": "Provinces",
      "scope.towns": "Towns",
      "town.loading": "Loading towns…",
      "town.select": "Select a town… ({n})",
      "town.failed": "Failed to load towns",
      "metric.systemic": "Annual wasted hours · baseline",
      "metric.saved": "Annual hours saved · this intervention",
      "metric.people": "People impacted",
      "metric.cells": "Neighborhoods improved",
      "metric.avgMin": "Avg one-way time saved / trip",
      "unit.min": " min",
      "unit.h": " h",
      "reco.button": "Recommend best sites",
      "reco.subtitle": "Where to build for the most hours saved",

      // Personal panel
      "personal.title": "Relocation planner",
      "personal.desc": "Drop two pins on the map to compare your weekly commute time-tax.",
      "personal.step1": "1 · Current residence",
      "personal.step2": "2 · Prospective residence",
      "personal.tapHint": "Tap, then click the map…",
      "personal.needsTitle": "Which places does your household travel to?",
      "personal.needsNote": "Each need is weighted by how often you actually go there.",
      "personal.curWeekly": "Current weekly time-tax",
      "personal.proWeekly": "Prospective weekly time-tax",
      "personal.efficiency": "Efficiency shift",
      "personal.breakdown": "Per-need breakdown · weekly hours",

      // Service layer labels (plural — used in the Layers panel + popups)
      "svc.kindergarten": "Kindergartens",
      "svc.school": "Schools",
      "svc.clinic": "Clinics",
      "svc.hospital": "Hospitals",
      "svc.pharmacy": "Pharmacies",

      // Personal needs (singular labels + frequency hints)
      "need.kindergarten": "Kindergarten",
      "need.school": "School",
      "need.clinic": "Clinic / GP",
      "need.hospital": "Hospital",
      "need.pharmacy": "Pharmacy",
      "needHint.kindergarten": "daily drop-off",
      "needHint.school": "daily run",
      "needHint.clinic": "check-ups",
      "needHint.hospital": "occasional",
      "needHint.pharmacy": "weekly",

      // Dynamic status / popup strings
      "status.loadingMatrix": "Loading matrix…",
      "status.loaded": "Loaded {nodes} services, {cells} cells.",
      "status.matrixFailed": "Failed to load matrix: {err}",
      "status.servicesFailed": "Failed to load services: {err}",
      "status.simulating": "Simulating intervention…",
      "status.simSaved": "Intervention would save {hours} hours/year.",
      "sim.popup": "Simulated {amenity}",
      "reco.asking": "Asking the AI model for the best build sites…",
      "reco.popupTitle": "★ Recommended site #{rank}",
      "reco.popupBuild": "Build: {amenity}",
      "reco.popupNear": "Near: {town}",
      "reco.popupPred": "Predicted: {hours} h/yr saved",
      "reco.saved": "saved",
      "reco.result": "AI recommends {n} site(s) for a new {amenity}.",
      "reco.none": "No high-impact sites found for this selection.",
      "reco.failed": "Recommendation failed: {err}",
      "personal.calculating": "Calculating your time-tax…",
      "personal.compared": "Compared across {label} need(s) using nationwide services.",
      "badge.returned": "+{h} h returned / week",
      "badge.cost": "{h} h / week",
      "pin.current": "Current residence",
      "pin.prospective": "Prospective residence",
      "oob.title": "Out of coverage",
      "oob.msg": "We currently only have data for Bulgaria.",
      "common.all": "all",

      // Provinces (keyed by the English value sent to the backend)
      "prov.all": "All Bulgaria",
      "prov.Blagoevgrad": "Blagoevgrad",
      "prov.Burgas": "Burgas",
      "prov.Dobrich": "Dobrich",
      "prov.Gabrovo": "Gabrovo",
      "prov.Haskovo": "Haskovo",
      "prov.Kardzhali": "Kardzhali",
      "prov.Kyustendil": "Kyustendil",
      "prov.Lovech": "Lovech",
      "prov.Montana": "Montana",
      "prov.Pazardzhik": "Pazardzhik",
      "prov.Pernik": "Pernik",
      "prov.Pleven": "Pleven",
      "prov.Plovdiv": "Plovdiv",
      "prov.Razgrad": "Razgrad",
      "prov.Ruse": "Ruse",
      "prov.Shumen": "Shumen",
      "prov.Silistra": "Silistra",
      "prov.Sliven": "Sliven",
      "prov.Smolyan": "Smolyan",
      "prov.Sofia (Capital)": "Sofia (Capital)",
      "prov.Sofia Province": "Sofia Province",
      "prov.Stara Zagora": "Stara Zagora",
      "prov.Targovishte": "Targovishte",
      "prov.Varna": "Varna",
      "prov.Veliko Tarnovo": "Veliko Tarnovo",
      "prov.Vidin": "Vidin",
      "prov.Vratsa": "Vratsa",
      "prov.Yambol": "Yambol",
    },

    bg: {
      // Brand
      "brand": "Матрицата на изгубеното време",

      // Language switcher
      "lang.aria": "Смяна на езика",
      "lang.name.bg": "Български",
      "lang.name.en": "English",

      // Landing portal
      "landing.badge": "България · 28 области · реални отворени данни",
      "landing.subtitle": "Географията на изгубеното време — невидимият „данък пътуване“, който слабата инфраструктура налага на малките деца и възрастните хора. Избери гледна точка, за да започнеш.",
      "landing.municipal.title": "Общинско планиране",
      "landing.municipal.desc": "Симулирай разполагане на обществени обекти, виж загубата на време в дадена област и остави обучен модел да препоръча местата с най-голям ефект.",
      "landing.municipal.cta": "Отвори планирането",
      "landing.personal.title": "Планер за преместване",
      "landing.personal.desc": "Постави две точки — настоящия си дом и евентуален нов — и сравни седмичните часове, които всеки адрес би струвал на домакинството ти за пътуване.",
      "landing.personal.cta": "Сравни два дома",
      "landing.footer": "Изградено върху OpenStreetMap · НСИ преброяване · GeoNames — 349 населени места, 2772 услуги.",

      // Map overlays
      "map.loading.matrix": "Зареждане на матрицата на изгубеното време…",
      "map.loading.services": "Зареждане на близките услуги…",
      "layers.title": "Слоеве",
      "layers.collapse": "Свий слоевете",
      "layers.timePoverty": "Изгубено време",
      "amenity.place": "Постави",
      "amenity.tapMap": "докосни картата",
      "legend.title": "Легенда",
      "legend.collapse": "Свий легендата",
      "legend.goodAccess": "добър достъп",
      "legend.severe": "тежка загуба на време",
      "legend.rampNote": "Размер на кръга = население · цвят = време до най-близката услуга",
      "legend.simSite": "Твоят симулиран обект",
      "legend.aiSite": "Препоръчан от ИИ обект",
      "legend.dotsNote": "Точките на услугите са обяснени в панел „Слоеве“ ↗",
      "legend.current": "Настоящо жилище",
      "legend.prospective": "Бъдещо жилище",
      "legend.personalNote": "Постави и двете точки, за да сравниш седмичните часове за пътуване.",

      // Amenity dropdown (what to simulate)
      "amenityOpt.kindergarten": "Детска градина · деца 0–6",
      "amenityOpt.school": "Училище · деца 0–6",
      "amenityOpt.clinic": "Поликлиника · 65+",
      "amenityOpt.hospital": "Болница · 65+",

      // Dashboard
      "dash.viewing": "Преглеждаш",
      "dash.modes": "← Режими",
      "dash.modesTitle": "Назад към избора на режим",
      "scope.provinces": "Области",
      "scope.towns": "Градове",
      "town.loading": "Зареждане на градове…",
      "town.select": "Избери град… ({n})",
      "town.failed": "Неуспешно зареждане на градове",
      "metric.systemic": "Годишни загубени часове · базова стойност",
      "metric.saved": "Годишни спестени часове · тази намеса",
      "metric.people": "Засегнати хора",
      "metric.cells": "Подобрени райони",
      "metric.avgMin": "Ср. спестено време в посока / пътуване",
      "unit.min": " мин",
      "unit.h": " ч",
      "reco.button": "Препоръчай най-добрите места",
      "reco.subtitle": "Къде да строиш за максимални спестени часове",

      // Personal panel
      "personal.title": "Планер за преместване",
      "personal.desc": "Постави две точки на картата, за да сравниш седмичния си „данък време“.",
      "personal.step1": "1 · Настоящо жилище",
      "personal.step2": "2 · Бъдещо жилище",
      "personal.tapHint": "Докосни, после кликни картата…",
      "personal.needsTitle": "До кои места пътува домакинството ти?",
      "personal.needsNote": "Всяка нужда е претеглена според това колко често ходиш там.",
      "personal.curWeekly": "Настоящ седмичен данък време",
      "personal.proWeekly": "Бъдещ седмичен данък време",
      "personal.efficiency": "Промяна в ефективността",
      "personal.breakdown": "Разбивка по нужди · седмични часове",

      // Service layer labels (plural)
      "svc.kindergarten": "Детски градини",
      "svc.school": "Училища",
      "svc.clinic": "Поликлиники",
      "svc.hospital": "Болници",
      "svc.pharmacy": "Аптеки",

      // Personal needs
      "need.kindergarten": "Детска градина",
      "need.school": "Училище",
      "need.clinic": "Поликлиника / ОПЛ",
      "need.hospital": "Болница",
      "need.pharmacy": "Аптека",
      "needHint.kindergarten": "ежедневно водене",
      "needHint.school": "ежедневно",
      "needHint.clinic": "прегледи",
      "needHint.hospital": "понякога",
      "needHint.pharmacy": "седмично",

      // Dynamic status / popup strings
      "status.loadingMatrix": "Зареждане на матрицата…",
      "status.loaded": "Заредени {nodes} услуги, {cells} клетки.",
      "status.matrixFailed": "Неуспешно зареждане на матрицата: {err}",
      "status.servicesFailed": "Неуспешно зареждане на услугите: {err}",
      "status.simulating": "Симулиране на намеса…",
      "status.simSaved": "Намесата би спестила {hours} часа/година.",
      "sim.popup": "Симулиран обект: {amenity}",
      "reco.asking": "Питам ИИ модела за най-добрите места за строеж…",
      "reco.popupTitle": "★ Препоръчано място №{rank}",
      "reco.popupBuild": "Строеж: {amenity}",
      "reco.popupNear": "Близо до: {town}",
      "reco.popupPred": "Прогноза: {hours} ч/год спестени",
      "reco.saved": "спестени",
      "reco.result": "ИИ препоръчва {n} места за нов обект „{amenity}“.",
      "reco.none": "Няма места с висок ефект за този избор.",
      "reco.failed": "Неуспешна препоръка: {err}",
      "personal.calculating": "Изчисляване на твоя данък време…",
      "personal.compared": "Сравнено по {label} нужди чрез услуги в цялата страна.",
      "badge.returned": "+{h} ч върнати / седмица",
      "badge.cost": "{h} ч / седмица",
      "pin.current": "Настоящо жилище",
      "pin.prospective": "Бъдещо жилище",
      "oob.title": "Извън покритие",
      "oob.msg": "В момента разполагаме с данни само за България.",
      "common.all": "всички",

      // Provinces (Cyrillic display; backend value stays English)
      "prov.all": "Цяла България",
      "prov.Blagoevgrad": "Благоевград",
      "prov.Burgas": "Бургас",
      "prov.Dobrich": "Добрич",
      "prov.Gabrovo": "Габрово",
      "prov.Haskovo": "Хасково",
      "prov.Kardzhali": "Кърджали",
      "prov.Kyustendil": "Кюстендил",
      "prov.Lovech": "Ловеч",
      "prov.Montana": "Монтана",
      "prov.Pazardzhik": "Пазарджик",
      "prov.Pernik": "Перник",
      "prov.Pleven": "Плевен",
      "prov.Plovdiv": "Пловдив",
      "prov.Razgrad": "Разград",
      "prov.Ruse": "Русе",
      "prov.Shumen": "Шумен",
      "prov.Silistra": "Силистра",
      "prov.Sliven": "Сливен",
      "prov.Smolyan": "Смолян",
      "prov.Sofia (Capital)": "София (столица)",
      "prov.Sofia Province": "София-област",
      "prov.Stara Zagora": "Стара Загора",
      "prov.Targovishte": "Търговище",
      "prov.Varna": "Варна",
      "prov.Veliko Tarnovo": "Велико Търново",
      "prov.Vidin": "Видин",
      "prov.Vratsa": "Враца",
      "prov.Yambol": "Ямбол",
    },
  };

  // --- State ----------------------------------------------------------------
  let current = readStored();
  const listeners = new Set();

  function readStored() {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v && LOCALES.includes(v)) return v;
    } catch { /* private mode / disabled storage */ }
    return DEFAULT_LOCALE;
  }

  // Resolve a key for the active locale, falling back to English, then the key.
  function t(key, params) {
    const table = DICT[current] || DICT[DEFAULT_LOCALE];
    let s = table[key];
    if (s == null) s = DICT.en[key];
    if (s == null) return key;
    if (params) {
      s = s.replace(/\{(\w+)\}/g, (m, name) =>
        params[name] != null ? params[name] : m);
    }
    return s;
  }

  // Re-translate every annotated node under `root`.
  //   data-i18n            → textContent
  //   data-i18n-html       → innerHTML (for the rare node with safe inline markup)
  //   data-i18n-title      → title attribute
  //   data-i18n-aria-label → aria-label attribute
  function apply(root) {
    root = root || document;
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    root.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });
    root.querySelectorAll("[data-i18n-aria-label]").forEach((el) => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria-label")));
    });
    document.documentElement.lang = current;
  }

  function setLocale(locale) {
    if (!LOCALES.includes(locale) || locale === current) {
      if (locale === current) syncSwitcher();   // keep menu state tidy
      return;
    }
    current = locale;
    try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* ignore */ }
    apply(document);
    syncSwitcher();
    listeners.forEach((cb) => { try { cb(locale); } catch (e) { console.error(e); } });
  }

  // Register a callback fired after each locale change (JS-rendered UI hook).
  function onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); }

  // --- Language switcher (always-on dropdown, top-right) --------------------
  let switcherBtnLabel = null;
  const FLAG = { bg: "🇧🇬", en: "🇬🇧" };

  function buildSwitcher() {
    const wrap = document.createElement("div");
    wrap.id = "langSwitch";
    wrap.className = "fixed top-4 right-4 z-[3000] text-sm";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.id = "langSwitchBtn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", t("lang.aria"));
    btn.className =
      "glass flex items-center gap-2 rounded-lg px-3 py-2 text-slate-100 " +
      "hover:text-accent transition focus:outline-none focus-visible:border-accent";
    btn.innerHTML =
      `<svg class="w-4 h-4 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.7">` +
      `<circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M3 12h18M12 3c2.5 2.4 2.5 15.6 0 18M12 3c-2.5 2.4-2.5 15.6 0 18"/></svg>` +
      `<span id="langSwitchLabel" class="font-semibold tracking-wide">${FLAG[current]} ${current.toUpperCase()}</span>` +
      `<svg class="w-3 h-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4"><path stroke-linecap="round" stroke-linejoin="round" d="M6 9l6 6 6-6"/></svg>`;

    const menu = document.createElement("div");
    menu.id = "langSwitchMenu";
    menu.setAttribute("role", "listbox");
    menu.className =
      "glass absolute right-0 mt-2 w-44 rounded-lg p-1 hidden " +
      "shadow-[0_16px_40px_-12px_rgba(3,8,20,.9)]";
    menu.innerHTML = LOCALES.map((loc) =>
      `<button type="button" role="option" data-locale="${loc}" ` +
      `class="lang-opt w-full flex items-center gap-2.5 rounded-md px-3 py-2 text-left ` +
      `text-slate-200 hover:bg-panel2 transition">` +
      `<span class="text-base leading-none">${FLAG[loc]}</span>` +
      `<span data-i18n="lang.name.${loc}">${t("lang.name." + loc)}</span></button>`
    ).join("");

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    document.body.appendChild(wrap);
    switcherBtnLabel = document.getElementById("langSwitchLabel");

    const closeMenu = () => {
      menu.classList.add("hidden");
      btn.setAttribute("aria-expanded", "false");
    };
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = menu.classList.toggle("hidden") === false;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    });
    menu.querySelectorAll("[data-locale]").forEach((opt) => {
      opt.addEventListener("click", (e) => {
        e.stopPropagation();
        setLocale(opt.getAttribute("data-locale"));
        closeMenu();
      });
    });
    document.addEventListener("click", closeMenu);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
    syncSwitcher();
  }

  // Reflect the active locale in the switcher (label + checked option styling).
  function syncSwitcher() {
    if (switcherBtnLabel) {
      switcherBtnLabel.textContent = `${FLAG[current]} ${current.toUpperCase()}`;
    }
    document.querySelectorAll("#langSwitchMenu .lang-opt").forEach((opt) => {
      const active = opt.getAttribute("data-locale") === current;
      opt.classList.toggle("text-accent", active);
      opt.classList.toggle("font-semibold", active);
      opt.setAttribute("aria-selected", active ? "true" : "false");
    });
    const btn = document.getElementById("langSwitchBtn");
    if (btn) btn.setAttribute("aria-label", t("lang.aria"));
  }

  // --- Public API + first paint --------------------------------------------
  window.I18n = {
    get locale() { return current; },
    locales: LOCALES.slice(),
    t, apply, setLocale, onChange,
  };
  window.t = t;   // convenience global used throughout app.js

  function init() {
    apply(document);     // translate the static markup
    buildSwitcher();     // mount the always-on dropdown
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
