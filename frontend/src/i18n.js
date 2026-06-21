// ============================================================================
//  i18n — lightweight, dependency-free internationalization for the Reclaim frontend
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
      "brand": "Reclaim",

      // Deploy version badge
      "version.deployed": "deployed",
      "version.unknown": "version unknown",

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

      // Public welcome / hero (logged-out)
      "hero.signin": "Sign in",
      "hero.title": "The geography of lost time",
      "hero.tagline": "Thin infrastructure charges Bulgaria's families and seniors an invisible tax — paid in hours on the road. Map it, simulate the fix, and compare what any address would really cost you.",
      "hero.cta.start": "Get started — it's free",
      "hero.cta.signin": "I already have an account",
      "hero.f1.title": "Municipal planner",
      "hero.f1.desc": "Simulate where a new school or clinic would save the most hours.",
      "hero.f2.title": "Relocation planner",
      "hero.f2.desc": "Compare two homes by the weekly travel time each would cost you.",
      "hero.f3.title": "Accountability Radar",
      "hero.f3.desc": "See planned civic builds against where time-poverty is worst.",
      "hero.footer": "Built on OpenStreetMap · NSI census · GeoNames — 349 settlements, 2,772 services.",
      "auth.back": "Back",
      "personal.searchCity": "Search a city or village…",
      "personal.orTapMap": "or pick it on the map",

      // Map overlays
      "map.loading.matrix": "Loading Reclaim…",
      "map.loading.services": "Loading nearby services…",
      "layers.title": "Layers",
      "layers.collapse": "Collapse layers",
      "layers.timePoverty": "Time-poverty",
      "theme.dark": "Dark",
      "theme.maps": "Light",
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
      "dash.tools": "Your tools",
      "scope.provinces": "Provinces",
      "scope.towns": "Towns",
      "town.loading": "Loading towns…",
      "town.select": "Select a town… ({n})",
      "town.failed": "Failed to load towns",
      "region.search": "Search a region…",
      "city.search": "Type 3 letters to search a town…",
      "site.aiTitle": "AI · is this a good site?",
      "site.aiThinking": "Reading the location…",
      "site.aiNone": "No read available for this spot.",
      "site.aiFailed": "Couldn't load the explanation.",
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
      "status.simWellServed": "This spot is already well-served for {amenity} — no time saved. Try a more remote area, or use “Recommend best sites”.",
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

      // ----- Auth / accounts -----
      "auth.welcomeTitle": "Welcome back",
      "auth.createTitle": "Create your account",
      "auth.signIn": "Sign in",
      "auth.signUp": "Sign up",
      "auth.name": "Display name",
      "auth.email": "Email",
      "auth.password": "Password",
      "auth.persona": "I'm signing up as…",
      "auth.persona.individual": "Individual — relocation planner",
      "auth.persona.reporter": "Reporter — accountability radar (paid)",
      "auth.persona.municipality": "Municipality — civic planner (paid)",
      "auth.paidNote": "Paid roles are activated by an administrator after signup.",
      "auth.noAccount": "No account yet?",
      "auth.haveAccount": "Already have an account?",
      "auth.failed": "Could not sign you in.",
      "auth.network": "Network error. Is the backend running?",
      "auth.expired": "Your session expired — please sign in again.",
      "auth.logout": "Log out",

      // Roles
      "role.ADMIN": "Admin",
      "role.FREE_USER": "Free user",
      "role.PAID_USER": "Paid user",
      "role.REPORTER": "Reporter",
      "role.MUNICIPALITY": "Municipality",
      "role.pending": "pending activation",

      // Free-tier quota
      "quota.label": "Free relocation checks",
      "quota.upgrade": "Upgrade",
      "plan.free": "Free plan",
      "plan.active": "Paid · active",
      "plan.pending": "Activation pending",
      "acct.checksLeft": "checks left",

      // Personal — paid extras
      "personal.aiTitle": "AI explanation",
      "personal.aiLocked": "Unlock the AI explanation",
      "personal.aiLockedNote": "A paid (tier 1) feature — get a written read on what the numbers mean.",
      "suggest.button": "Suggest the best areas to live",
      "suggest.subtitle": "Ranked by lowest weekly travel time for your needs",
      "suggest.asking": "Finding the best-fit areas…",
      "suggest.result": "Top {n} areas for your needs.",
      "suggest.none": "No suggestions found.",
      "suggest.failed": "Suggestion failed: {err}",
      "suggest.saved": "h/wk saved",
      "suggest.popup": "Suggested area",
      "suggest.needPin": "Drop your current-home pin first.",
      "suggest.needProspective": "Set a prospective home first to suggest better areas.",
      "suggest.why": "Why this area",
      "suggest.aiNone": "No read available for this area.",
      "personal.toggleHint": "Filters updated — drop a pin to run a new check.",
      "personal.soonHint": "Gyms and barbers aren't mapped yet — there's no open dataset for them.",
      "need.soon": "Soon",
      "personal.ownsCar": "I own a car",
      "personal.ownsCarHint": "Trips over 2 km are timed by car; shorter ones on foot.",

      // Future personal filters (no data yet)
      "need.gym": "Gym",
      "need.barber": "Barber",
      "needHint.gym": "weekly",
      "needHint.barber": "monthly",

      // Paywall modal
      "paywall.ok": "Maybe later",
      "paywall.pay": "Pay & unlock",
      "paywall.processing": "Unlocking…",
      "paywall.payFailed": "Try again",
      "paywall.testNote": "Test mode — no card is charged, access unlocks instantly.",
      "paywall.title.DEFAULT": "Paid feature",
      "paywall.body.DEFAULT": "This is a paid feature. Pay to unlock and test it.",
      "paywall.title.PAYWALL_QUOTA": "You're out of free checks",
      "paywall.body.PAYWALL_QUOTA": "Free accounts get 3 relocation checks. Pay to unlock unlimited checks plus AI explanations and area suggestions.",
      "paywall.title.PAYWALL_FILTER": "Locked filter",
      "paywall.body.PAYWALL_FILTER": "Free accounts can filter by schools, clinics, hospitals and pharmacies. Pay to unlock every filter.",
      "paywall.title.PAYWALL_UPGRADE": "Paid feature",
      "paywall.body.PAYWALL_UPGRADE": "Area suggestions are a paid (tier 1) feature. Pay to unlock the AI explanation and area suggestions.",
      "paywall.title.ACCESS_MUNICIPAL": "Municipality account needed",
      "paywall.body.ACCESS_MUNICIPAL": "The municipal planner is a tier-3 paid feature. Pay to unlock and test it.",
      "paywall.title.ACCESS_REPORTER": "Reporter account needed",
      "paywall.body.ACCESS_REPORTER": "The Accountability Radar is a tier-2 paid feature. Pay to unlock and test it.",
      "paywall.title.ACCESS_PERSONAL": "Not available",
      "paywall.body.ACCESS_PERSONAL": "The relocation planner is for individual accounts.",
      "paywall.title.ACCESS_PENDING": "Unlock this lens",
      "paywall.body.ACCESS_PENDING": "This is where a paywall would go. Pay to unlock your tier and start using it right away.",

      // Admin
      "admin.manage": "Admin settings",
      "admin.title": "Admin settings",
      "admin.subtitle": "Manage accounts and the Civic Radar feed.",
      "admin.tab.users": "Users",
      "admin.tab.radar": "Radar",
      "admin.users.subtitle": "Grant paid access and assign roles.",
      "admin.col.account": "Account",
      "admin.col.role": "Role",
      "admin.col.access": "Access",
      "admin.save": "Save",
      "admin.saving": "Saving…",
      "admin.saved": "Saved ✓",
      "admin.loading": "Loading users…",
      "admin.failed": "Failed to load users.",
      "admin.empty": "No users yet.",
      "admin.locked": "locked",
      "admin.radar.subtitle": "The Civic Radar feed is scraped automatically every two weeks. Force a fresh scrape now if you need up-to-date procurement data.",
      "admin.radar.heading": "Procurement scrape",
      "admin.radar.force": "Force scrape",
      "admin.radar.scraping": "Scraping…",
      "admin.radar.idle": "Idle — runs on the bi-weekly schedule.",
      "admin.radar.running": "Scrape in progress — this can take a few minutes…",
      "admin.radar.success": "Last scrape finished {when}.",
      "admin.radar.failed": "Scrape failed: {msg}",
      "admin.radar.triggerFailed": "Could not start the scrape.",

      // Demo paid toggle (admin)
      "paidToggle.label": "Paid user",
      "paidToggle.hint": "demo · toggles locked features",

      // ----- Accountability Radar (Pillar 3) -----
      "landing.radar.title": "Accountability Radar",
      "landing.radar.badge": "New",
      "landing.radar.desc": "Track the new schools, kindergartens and clinics municipalities have put out to tender — and cross-reference them against the model's optimal locations.",
      "radar.title": "Accountability Radar",
      "radar.subtitle": "New civic builds municipalities have put out to tender, scraped from the public-procurement registry (AOP).",
      "radar.stat.total": "Planned projects tracked",
      "radar.stat.buyers": "Municipalities",
      "radar.filter.label": "Type",
      "radar.filter.all": "All civic builds",
      "radar.districtName": "All Bulgaria · planned builds",
      "radar.status.loading": "Loading planned projects…",
      "radar.status.auditing": "Cross-referencing builds against ML-optimal sites…",
      "radar.status.summary": "{flag} flagged · {review} to review · {good} well-sited. Click a project to locate it.",
      "radar.status.empty": "The AOP scraper hasn't cached any records yet — its live HTML selectors still need calibrating against aop.bg. Planned builds appear here on its first write.",
      "radar.status.emptyShort": "Scraper table empty.",
      "radar.status.nomatch": "No planned projects match this filter.",
      "radar.status.failed": "Failed to load projects: {err}",
      "radar.feed.auditing": "auditing…",
      "radar.feed.ref": "AOP {num} · {date}",
      "radar.audit.good": "Well sited",
      "radar.audit.review": "Review",
      "radar.audit.flag": "Misallocation risk",
      "radar.audit.far": "Optimal elsewhere",
      "radar.audit.unknown": "Unaudited",
      "radar.legend.good": "Well sited",
      "radar.legend.review": "Review",
      "radar.legend.flag": "Misallocation risk",
      "radar.legend.far": "Optimal elsewhere in province",
      "radar.legend.optimal": "ML-optimal site",
      "radar.legend.note": "Thresholds scale with each province's size; deviations beyond it count as “optimal elsewhere”, not misalignment.",
      "radar.popup.fromOptimal": "{km} from optimal",
      "radar.popup.modelBest": "Model's best: {town} ({hours} h/yr)",
      "radar.popup.notAudited": "Not audited",
      "radar.popup.optimal": "ML-optimal site",
      "radar.popup.optimalNear": "Near {town}",

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
      "brand": "Reclaim",

      // Deploy version badge
      "version.deployed": "внедрено",
      "version.unknown": "неизвестна версия",

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

      // Public welcome / hero (logged-out)
      "hero.signin": "Вход",
      "hero.title": "Географията на изгубеното време",
      "hero.tagline": "Слабата инфраструктура налага на българските семейства и възрастни хора невидим данък — плащан в часове по пътищата. Картирай го, симулирай решението и сравни колко наистина би ти струвал всеки адрес.",
      "hero.cta.start": "Започни — безплатно е",
      "hero.cta.signin": "Вече имам акаунт",
      "hero.f1.title": "Общинско планиране",
      "hero.f1.desc": "Симулирай къде ново училище или поликлиника би спестило най-много часове.",
      "hero.f2.title": "Планер за преместване",
      "hero.f2.desc": "Сравни два дома по седмичното време за пътуване, което всеки би ти струвал.",
      "hero.f3.title": "Радар за отчетност",
      "hero.f3.desc": "Виж планираните обществени строежи спрямо това къде недостигът на време е най-голям.",
      "hero.footer": "Изградено върху OpenStreetMap · НСИ преброяване · GeoNames — 349 населени места, 2772 услуги.",
      "auth.back": "Назад",
      "personal.searchCity": "Търси град или село…",
      "personal.orTapMap": "или избери на картата",

      // Map overlays
      "map.loading.matrix": "Зареждане на Reclaim…",
      "map.loading.services": "Зареждане на близките услуги…",
      "layers.title": "Слоеве",
      "layers.collapse": "Свий слоевете",
      "layers.timePoverty": "Изгубено време",
      "theme.dark": "Тъмна",
      "theme.maps": "Светла",
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
      "dash.tools": "Вашите инструменти",
      "scope.provinces": "Области",
      "scope.towns": "Градове",
      "town.loading": "Зареждане на градове…",
      "town.select": "Избери град… ({n})",
      "town.failed": "Неуспешно зареждане на градове",
      "region.search": "Търси област…",
      "city.search": "Въведи 3 букви за търсене на град…",
      "site.aiTitle": "ИИ · добра ли е тази локация?",
      "site.aiThinking": "Анализ на локацията…",
      "site.aiNone": "Няма анализ за тази точка.",
      "site.aiFailed": "Неуспешно зареждане на обяснението.",
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
      "status.simWellServed": "Това място вече е добре обслужено за {amenity} — няма спестено време. Опитай по-отдалечен район или „Препоръчай най-добрите места“.",
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

      // ----- Вход / акаунти -----
      "auth.welcomeTitle": "Добре дошъл отново",
      "auth.createTitle": "Създай акаунт",
      "auth.signIn": "Вход",
      "auth.signUp": "Регистрация",
      "auth.name": "Име за показване",
      "auth.email": "Имейл",
      "auth.password": "Парола",
      "auth.persona": "Регистрирам се като…",
      "auth.persona.individual": "Частно лице — планер за преместване",
      "auth.persona.reporter": "Репортер — радар за отчетност (платено)",
      "auth.persona.municipality": "Община — общинско планиране (платено)",
      "auth.paidNote": "Платените роли се активират от администратор след регистрация.",
      "auth.noAccount": "Нямаш акаунт?",
      "auth.haveAccount": "Вече имаш акаунт?",
      "auth.failed": "Входът не бе успешен.",
      "auth.network": "Мрежова грешка. Работи ли бекендът?",
      "auth.expired": "Сесията изтече — влез отново.",
      "auth.logout": "Изход",

      // Роли
      "role.ADMIN": "Администратор",
      "role.FREE_USER": "Безплатен потребител",
      "role.PAID_USER": "Платен потребител",
      "role.REPORTER": "Репортер",
      "role.MUNICIPALITY": "Община",
      "role.pending": "очаква активиране",

      // Безплатен лимит
      "quota.label": "Безплатни проверки за преместване",
      "quota.upgrade": "Надгради",
      "plan.free": "Безплатен план",
      "plan.active": "Платен · активен",
      "plan.pending": "Очаква активиране",
      "acct.checksLeft": "оставащи проверки",

      // Лични — платени екстри
      "personal.aiTitle": "ИИ обяснение",
      "personal.aiLocked": "Отключи ИИ обяснението",
      "personal.aiLockedNote": "Платена функция (ниво 1) — получи писмен прочит на числата.",
      "suggest.button": "Предложи най-добрите райони за живеене",
      "suggest.subtitle": "Подредени по най-малко седмично време за пътуване според нуждите ти",
      "suggest.asking": "Търсене на най-подходящите райони…",
      "suggest.result": "Топ {n} района за твоите нужди.",
      "suggest.none": "Няма намерени предложения.",
      "suggest.failed": "Неуспешно предложение: {err}",
      "suggest.saved": "ч/седм. спестени",
      "suggest.popup": "Предложен район",
      "suggest.needPin": "Първо постави точка за настоящия дом.",
      "suggest.needProspective": "Първо задай евентуален дом, за да предложим по-добри райони.",
      "suggest.why": "Защо този район",
      "suggest.aiNone": "Няма анализ за този район.",
      "personal.toggleHint": "Филтрите са обновени — постави точка за нова проверка.",
      "personal.soonHint": "Фитнеси и бръснари още не са картирани — няма отворени данни за тях.",
      "need.soon": "Скоро",
      "personal.ownsCar": "Имам кола",
      "personal.ownsCarHint": "Пътувания над 2 км се изчисляват с кола; по-късите — пеша.",

      // Бъдещи лични филтри (още без данни)
      "need.gym": "Фитнес",
      "need.barber": "Бръснар",
      "needHint.gym": "седмично",
      "needHint.barber": "месечно",

      // Модал за плащане
      "paywall.ok": "Може би по-късно",
      "paywall.pay": "Плати и отключи",
      "paywall.processing": "Отключване…",
      "paywall.payFailed": "Опитай пак",
      "paywall.testNote": "Тестов режим — не се таксува карта, достъпът се отключва веднага.",
      "paywall.title.DEFAULT": "Платена функция",
      "paywall.body.DEFAULT": "Това е платена функция. Плати, за да я отключиш и тестваш.",
      "paywall.title.PAYWALL_QUOTA": "Изчерпа безплатните проверки",
      "paywall.body.PAYWALL_QUOTA": "Безплатните акаунти имат 3 проверки за преместване. Плати, за да отключиш неограничени проверки, ИИ обяснения и предложения за райони.",
      "paywall.title.PAYWALL_FILTER": "Заключен филтър",
      "paywall.body.PAYWALL_FILTER": "Безплатните акаунти могат да филтрират по училища, поликлиники, болници и аптеки. Плати, за да отключиш всички филтри.",
      "paywall.title.PAYWALL_UPGRADE": "Платена функция",
      "paywall.body.PAYWALL_UPGRADE": "Предложенията за райони са платена функция (ниво 1). Плати, за да отключиш ИИ обяснението и предложенията за райони.",
      "paywall.title.ACCESS_MUNICIPAL": "Нужен е общински акаунт",
      "paywall.body.ACCESS_MUNICIPAL": "Общинското планиране е платена функция от ниво 3. Плати, за да я отключиш и тестваш.",
      "paywall.title.ACCESS_REPORTER": "Нужен е репортерски акаунт",
      "paywall.body.ACCESS_REPORTER": "Радарът за отчетност е платена функция от ниво 2. Плати, за да я отключиш и тестваш.",
      "paywall.title.ACCESS_PERSONAL": "Недостъпно",
      "paywall.body.ACCESS_PERSONAL": "Планерът за преместване е за частни акаунти.",
      "paywall.title.ACCESS_PENDING": "Отключи тази гледна точка",
      "paywall.body.ACCESS_PENDING": "Тук би стоял платежен модул. Плати, за да отключиш нивото си и да започнеш да го ползваш веднага.",

      // Администрация
      "admin.manage": "Админ настройки",
      "admin.title": "Админ настройки",
      "admin.subtitle": "Управлявай акаунтите и подаването на Civic Radar.",
      "admin.tab.users": "Потребители",
      "admin.tab.radar": "Радар",
      "admin.users.subtitle": "Дай платен достъп и задай роли.",
      "admin.col.account": "Акаунт",
      "admin.col.role": "Роля",
      "admin.col.access": "Достъп",
      "admin.save": "Запази",
      "admin.saving": "Запазване…",
      "admin.saved": "Запазено ✓",
      "admin.loading": "Зареждане на потребители…",
      "admin.failed": "Неуспешно зареждане на потребители.",
      "admin.empty": "Все още няма потребители.",
      "admin.locked": "заключен",
      "admin.radar.subtitle": "Данните за Civic Radar се събират автоматично на всеки две седмици. Принуди ново събиране сега, ако ти трябват актуални данни за обществените поръчки.",
      "admin.radar.heading": "Събиране на поръчки",
      "admin.radar.force": "Принудително събиране",
      "admin.radar.scraping": "Събиране…",
      "admin.radar.idle": "Неактивно — изпълнява се на всеки две седмици.",
      "admin.radar.running": "Събирането тече — това може да отнеме няколко минути…",
      "admin.radar.success": "Последното събиране приключи {when}.",
      "admin.radar.failed": "Събирането се провали: {msg}",
      "admin.radar.triggerFailed": "Неуспешно стартиране на събирането.",

      // Демо превключвател за платен достъп (админ)
      "paidToggle.label": "Платен потребител",
      "paidToggle.hint": "демо · превключва заключените функции",

      // ----- Радар за гражданска отчетност (Стълб 3) -----
      "landing.radar.title": "Радар за отчетност",
      "landing.radar.badge": "Ново",
      "landing.radar.desc": "Следи новите училища, детски градини и поликлиники, обявени на търг от общините — и ги сравни с оптималните локации според модела.",
      "radar.title": "Радар за отчетност",
      "radar.subtitle": "Нови обществени строежи, обявени на търг от общините, събрани от регистъра за обществени поръчки (АОП).",
      "radar.stat.total": "Проследени планирани проекти",
      "radar.stat.buyers": "Общини",
      "radar.filter.label": "Тип",
      "radar.filter.all": "Всички строежи",
      "radar.districtName": "Цяла България · планирани строежи",
      "radar.status.loading": "Зареждане на планираните проекти…",
      "radar.status.auditing": "Сравняване на строежите с оптималните локации на модела…",
      "radar.status.summary": "{flag} с флаг · {review} за преглед · {good} добре разположени. Натисни проект, за да го намериш.",
      "radar.status.empty": "Скрейпърът на АОП още не е кеширал записи — селекторите му трябва да се калибрират към aop.bg. Планираните строежи ще се появят тук при първото записване.",
      "radar.status.emptyShort": "Таблицата на скрейпъра е празна.",
      "radar.status.nomatch": "Няма планирани проекти за този филтър.",
      "radar.status.failed": "Неуспешно зареждане на проектите: {err}",
      "radar.feed.auditing": "проверка…",
      "radar.feed.ref": "АОП {num} · {date}",
      "radar.audit.good": "Добре разположен",
      "radar.audit.review": "За преглед",
      "radar.audit.flag": "Риск от лошо разпределение",
      "radar.audit.far": "Оптималното е другаде",
      "radar.audit.unknown": "Непроверен",
      "radar.legend.good": "Добре разположен",
      "radar.legend.review": "За преглед",
      "radar.legend.flag": "Риск от лошо разпределение",
      "radar.legend.far": "Оптималното е другаде в областта",
      "radar.legend.optimal": "Оптимална локация (ML)",
      "radar.legend.note": "Праговете зависят от размера на областта; отклонения над него се броят като „оптималното е другаде“, а не разпределение.",
      "radar.popup.fromOptimal": "{km} от оптималното",
      "radar.popup.modelBest": "Най-добро според модела: {town} ({hours} ч/год)",
      "radar.popup.notAudited": "Непроверен",
      "radar.popup.optimal": "Оптимална локация (ML)",
      "radar.popup.optimalNear": "Близо до {town}",

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
    root.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
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
