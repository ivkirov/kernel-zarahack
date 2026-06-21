// ============================================================================
//  auth.js — accounts, roles, paid tiers and usage limits for the Reclaim frontend
// ----------------------------------------------------------------------------
//  Loads after i18n.js + config.js, before app.js. Owns:
//    • JWT storage + bootstrap (GET /me)
//    • Auth.apiFetch — fetch with the bearer header + central 401/paywall handling
//    • the login / register overlay, the paywall modal, the admin user panel
//  app.js consumes window.Auth (user, apiFetch, onReady) to drive role-aware UI.
// ============================================================================
(function () {
  "use strict";

  const { AUTH_BASE_URL, ADMIN_BASE_URL } = window.TPM;
  const TOKEN_KEY = "tpm_token";

  let token = null;
  try { token = localStorage.getItem(TOKEN_KEY); } catch { /* private mode */ }
  let user = null;
  const readyCbs = new Set();
  const activatedCbs = new Set();

  // Paywall codes that a self-serve "payment" can't resolve (a role mismatch,
  // not a missing purchase) — these hide the Pay button.
  const NON_PAYABLE = new Set(["ACCESS_PERSONAL"]);

  const $ = (id) => document.getElementById(id);
  const show = (el, v) => el && el.classList.toggle("hidden", !v);
  const T = (k, p) => (window.t ? window.t(k, p) : k);
  // HTML-escape untrusted values (account email / display name) before they go
  // into innerHTML. Without this, a user-chosen display name like
  // "<img src=x onerror=…>" would run as script in the ADMIN's session when they
  // open the user panel — i.e. anonymous-signup → admin takeover.
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function authHeader() { return token ? { Authorization: "Bearer " + token } : {}; }
  function mkErr(code, msg, paywall) { const e = new Error(msg || code); e.code = code; e.paywall = !!paywall; return e; }

  // ---- the one fetch wrapper everything authenticated goes through ----
  async function apiFetch(url, opts = {}) {
    const headers = Object.assign({}, opts.headers || {}, authHeader());
    const res = await fetch(url, Object.assign({}, opts, { headers }));
    if (res.status === 401) { hardLogout(); throw mkErr("UNAUTHENTICATED", T("auth.expired")); }
    if (res.status === 402 || res.status === 403) {
      let body = {};
      try { body = await res.clone().json(); } catch { /* non-json */ }
      showPaywall(body.code, body.message);
      throw mkErr(body.code || "BLOCKED", body.message, true);
    }
    return res;
  }

  // ---- session ----
  function setSession(tok, usr) {
    token = tok; user = usr;
    try { if (tok) localStorage.setItem(TOKEN_KEY, tok); } catch { /* ignore */ }
  }
  function clearSession() {
    token = null; user = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  }

  async function bootstrap() {
    if (!token) { showWelcome(); return; }
    try {
      const res = await fetch(AUTH_BASE_URL + "/me", { headers: authHeader() });
      if (!res.ok) throw new Error("me failed");
      user = await res.json();
      onAuthed();
    } catch {
      clearSession();
      showWelcome();
    }
  }

  function onAuthed() {
    hideAuth();
    hideWelcome();
    renderAccountBar();
    readyCbs.forEach((cb) => { try { cb(user); } catch (e) { console.error(e); } });
  }

  async function refreshMe() {
    try {
      const res = await fetch(AUTH_BASE_URL + "/me", { headers: authHeader() });
      if (res.ok) { user = await res.json(); renderAccountBar(); }
    } catch { /* ignore */ }
    return user;
  }

  // ---- auth overlay (login / register) ----
  let authMode = "login";

  // The public welcome/hero sits in front of the mode-picker until the visitor
  // chooses to sign in or sign up; the auth form is one click behind a CTA.
  function showWelcome() { show($("welcome"), true); hideAuth(); }
  function hideWelcome() { show($("welcome"), false); }

  function showAuth(mode) { hideWelcome(); show($("authOverlay"), true); switchAuthMode(mode || "login"); }
  function hideAuth() { show($("authOverlay"), false); }

  function switchAuthMode(m) {
    authMode = m;
    show($("authRegisterFields"), m === "register");
    $("authSubmit").textContent = T(m === "register" ? "auth.signUp" : "auth.signIn");
    $("authTitle").textContent = T(m === "register" ? "auth.createTitle" : "auth.welcomeTitle");
    $("authToggleText").textContent = T(m === "register" ? "auth.haveAccount" : "auth.noAccount");
    $("authToggleBtn").textContent = T(m === "register" ? "auth.signIn" : "auth.signUp");
    setAuthError("");
  }

  function setAuthError(msg) {
    const el = $("authError");
    el.textContent = msg || "";
    show(el, !!msg);
  }

  async function submitAuth(e) {
    e.preventDefault();
    setAuthError("");
    const email = $("authEmail").value.trim();
    const password = $("authPassword").value;
    const btn = $("authSubmit");
    btn.disabled = true;
    try {
      let res, body;
      if (authMode === "register") {
        body = { email, password, displayName: $("authName").value.trim(), persona: $("authPersona").value };
        res = await fetch(AUTH_BASE_URL + "/register", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
      } else {
        res = await fetch(AUTH_BASE_URL + "/login", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setAuthError(data.message || T("auth.failed")); return; }
      setSession(data.token, data.user);
      onAuthed();
    } catch (err) {
      setAuthError(T("auth.network"));
    } finally {
      btn.disabled = false;
    }
  }

  function hardLogout() {
    clearSession();
    renderAccountBar();
    showWelcome();
  }
  function logout() { hardLogout(); }

  // ---- account card (inside the landing screen) ----
  function renderAccountBar() {
    if (!$("acctEmail")) return;
    const set = (id, txt) => { const el = $(id); if (el) el.textContent = txt; };
    if (!user) { set("acctEmail", ""); set("acctName", ""); return; }

    const name = user.displayName || user.email.split("@")[0];
    set("acctName", name);
    set("acctEmail", user.email);
    const av = $("acctAvatar");
    if (av) av.textContent = (name[0] || "·").toUpperCase();
    set("acctRole", T("role." + user.role));

    const isFree = user.role === "FREE_USER";
    const isAdmin = user.role === "ADMIN";
    const pending = !isFree && !isAdmin && !user.accessGranted;

    // Plan label
    set("acctPlan", isFree ? T("plan.free") : pending ? T("plan.pending") : T("plan.active"));

    // Free-tier usage meter
    const usageEl = $("acctUsage"), bar = $("acctUsageBar"), fill = $("acctUsageFill");
    if (isFree && typeof user.freeGuessesRemaining === "number") {
      const lim = user.freeGuessLimit || 3, rem = Math.max(0, user.freeGuessesRemaining);
      if (usageEl) usageEl.textContent = `${rem}/${lim} ${T("acct.checksLeft")}`;
      if (bar) bar.classList.remove("hidden");
      if (fill) fill.style.width = `${Math.round((rem / lim) * 100)}%`;
    } else {
      if (usageEl) usageEl.textContent = "";
      if (bar) bar.classList.add("hidden");
    }

    show($("acctUpgradeBtn"), isFree || pending);
    show($("adminUsersBtn"), isAdmin);
  }

  // ---- paywall modal ----
  function showPaywall(code, serverMsg) {
    const titleKey = "paywall.title." + (code || "DEFAULT");
    const bodyKey = "paywall.body." + (code || "DEFAULT");
    $("paywallTitle").textContent = T(titleKey) === titleKey ? T("paywall.title.DEFAULT") : T(titleKey);
    const body = T(bodyKey);
    $("paywallBody").textContent = body === bodyKey ? (serverMsg || T("paywall.body.DEFAULT")) : body;
    // Pay button only when a purchase would actually unlock the feature.
    const payable = !!user && user.role !== "ADMIN" && !NON_PAYABLE.has(code);
    const payBtn = $("paywallPay");
    if (payBtn) { payBtn.disabled = false; payBtn.textContent = T("paywall.pay"); }
    show(payBtn, payable);
    show($("paywallTestNote"), payable);
    show($("paywallModal"), true);
  }
  function hidePaywall() { show($("paywallModal"), false); }

  // The "payment" — activates this account's paid access, then unlocks in place.
  async function payAndUnlock() {
    const btn = $("paywallPay");
    if (btn) { btn.disabled = true; btn.textContent = T("paywall.processing"); }
    try {
      const res = await apiFetch(AUTH_BASE_URL + "/activate", { method: "POST" });
      const data = await res.json();
      setSession(data.token, data.user);
      renderAccountBar();
      hidePaywall();
      activatedCbs.forEach((cb) => { try { cb(user); } catch (e) { console.error(e); } });
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = T("paywall.payFailed"); }
    }
  }

  // ---- admin settings ----
  // Switch between the "Users" and "Radar" categories of the admin panel.
  function selectAdminTab(name) {
    document.querySelectorAll("[data-admin-tab]").forEach((btn) => {
      const active = btn.dataset.adminTab === name;
      btn.classList.toggle("text-slate-100", active);
      btn.classList.toggle("border-accent", active);
      btn.classList.toggle("text-faint", !active);
      btn.classList.toggle("border-transparent", !active);
    });
    show($("adminTab-users"), name === "users");
    show($("adminTab-radar"), name === "radar");
  }

  async function openAdmin() {
    show($("adminModal"), true);
    selectAdminTab("users");
    refreshScrapeStatus();
    const body = $("adminTableBody");
    body.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-muted">${T("admin.loading")}</td></tr>`;
    try {
      const res = await apiFetch(ADMIN_BASE_URL + "/users");
      const users = await res.json();
      renderAdminTable(users);
    } catch (err) {
      if (!err.paywall) body.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-rose-400">${T("admin.failed")}</td></tr>`;
    }
  }
  function closeAdmin() {
    show($("adminModal"), false);
    if (scrapePollTimer) { clearInterval(scrapePollTimer); scrapePollTimer = null; }
  }

  // ADMIN is intentionally omitted — there is exactly one (seeded) admin account.
  const ROLES = ["FREE_USER", "PAID_USER", "REPORTER", "MUNICIPALITY"];

  function renderAdminTable(list) {
    const body = $("adminTableBody");
    body.innerHTML = "";
    list.forEach((u) => {
      const tr = document.createElement("tr");
      tr.className = "border-t border-edge/70";
      // The single admin account is immutable from the panel.
      if (u.role === "ADMIN") {
        tr.innerHTML =
          `<td class="py-2 pr-3">
             <div class="text-sm text-slate-100">${esc(u.displayName)}</div>
             <div class="text-xs text-muted">${esc(u.email)}</div>
           </td>
           <td class="py-2 pr-3 text-xs text-accent font-semibold">${T("role.ADMIN")}</td>
           <td class="py-2 pr-3 text-center text-emerald-400">✓</td>
           <td class="py-2 text-right text-[11px] text-faint">${T("admin.locked")}</td>`;
        body.appendChild(tr);
        return;
      }
      const opts = ROLES.map((r) =>
        `<option value="${r}" ${u.role === r ? "selected" : ""}>${T("role." + r)}</option>`).join("");
      tr.innerHTML =
        `<td class="py-2 pr-3">
           <div class="text-sm text-slate-100">${esc(u.displayName)}</div>
           <div class="text-xs text-muted">${esc(u.email)}</div>
         </td>
         <td class="py-2 pr-3">
           <select data-role class="bg-panel2 border border-edge rounded-md px-2 py-1 text-xs text-slate-100">${opts}</select>
         </td>
         <td class="py-2 pr-3 text-center">
           <input data-grant type="checkbox" ${u.accessGranted ? "checked" : ""} class="accent-accent w-4 h-4"/>
         </td>
         <td class="py-2 text-right">
           <button data-save class="rounded-md bg-accent/15 text-accent text-xs font-semibold px-3 py-1 hover:bg-accent/25 transition">${T("admin.save")}</button>
         </td>`;
      const sel = tr.querySelector("[data-role]");
      const grant = tr.querySelector("[data-grant]");
      tr.querySelector("[data-save]").addEventListener("click", async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true; btn.textContent = T("admin.saving");
        try {
          const res = await apiFetch(`${ADMIN_BASE_URL}/users/${u.id}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: sel.value, accessGranted: grant.checked }),
          });
          const updated = await res.json();
          u.role = updated.role; u.accessGranted = updated.accessGranted;
          btn.textContent = T("admin.saved");
          // If the admin edited their own account, refresh the local session view.
          if (user && updated.id === user.id) refreshMe();
          setTimeout(() => { btn.textContent = T("admin.save"); btn.disabled = false; }, 1200);
        } catch (err) {
          btn.textContent = T("admin.save"); btn.disabled = false;
        }
      });
      body.appendChild(tr);
    });
    if (!list.length) body.innerHTML = `<tr><td colspan="4" class="py-4 text-center text-muted">${T("admin.empty")}</td></tr>`;
  }

  // ---- radar scraper control ----
  let scrapePollTimer = null;

  // Reflect a scrape Status DTO ({state, startedAt, finishedAt, message}) in the panel.
  function renderScrapeStatus(s) {
    const el = $("radarScrapeStatus");
    const btn = $("forceScrapeBtn");
    if (!el || !btn) return;
    const state = (s && s.state) || "IDLE";
    const running = state === "RUNNING";
    btn.disabled = running;
    btn.textContent = running ? T("admin.radar.scraping") : T("admin.radar.force");
    if (state === "RUNNING") {
      el.className = "text-xs text-amber-400 mt-1";
      el.textContent = T("admin.radar.running");
    } else if (state === "SUCCESS") {
      el.className = "text-xs text-emerald-400 mt-1";
      const when = s.finishedAt ? new Date(s.finishedAt).toLocaleString() : "";
      el.textContent = T("admin.radar.success", { when });
    } else if (state === "FAILED") {
      el.className = "text-xs text-rose-400 mt-1";
      el.textContent = T("admin.radar.failed", { msg: s.message || "" });
    } else {
      el.className = "text-xs text-muted mt-1";
      el.textContent = T("admin.radar.idle");
    }
    // Keep polling while a run is in flight; stop once it settles.
    if (running && !scrapePollTimer) {
      scrapePollTimer = setInterval(refreshScrapeStatus, 3000);
    } else if (!running && scrapePollTimer) {
      clearInterval(scrapePollTimer); scrapePollTimer = null;
    }
  }

  async function refreshScrapeStatus() {
    try {
      const res = await apiFetch(ADMIN_BASE_URL + "/radar/scrape");
      renderScrapeStatus(await res.json());
    } catch { /* leave the current text on transient errors */ }
  }

  async function forceScrape() {
    const btn = $("forceScrapeBtn");
    if (btn) { btn.disabled = true; btn.textContent = T("admin.radar.scraping"); }
    try {
      const res = await apiFetch(ADMIN_BASE_URL + "/radar/scrape", { method: "POST" });
      renderScrapeStatus(await res.json());
    } catch (err) {
      if (!err.paywall) renderScrapeStatus({ state: "FAILED", message: T("admin.radar.triggerFailed") });
    }
  }

  // ---- public API ----
  window.Auth = {
    get user() { return user; },
    get token() { return token; },
    apiFetch,
    onReady(cb) { readyCbs.add(cb); if (user) { try { cb(user); } catch (e) { console.error(e); } } },
    onActivated(cb) { activatedCbs.add(cb); },
    logout, showPaywall, refreshMe, openAdmin,
  };

  // ---- wire DOM + boot ----
  function init() {
    $("authForm").addEventListener("submit", submitAuth);
    $("authToggleBtn").addEventListener("click", () => switchAuthMode(authMode === "login" ? "register" : "login"));
    // Welcome/hero → auth overlay, and back again.
    const startBtn = $("welcomeStart");
    if (startBtn) startBtn.addEventListener("click", () => showAuth("register"));
    ["welcomeSignIn", "welcomeSignIn2"].forEach((id) => {
      const el = $(id);
      if (el) el.addEventListener("click", () => showAuth("login"));
    });
    const backBtn = $("authBack");
    if (backBtn) backBtn.addEventListener("click", showWelcome);
    $("paywallClose").addEventListener("click", hidePaywall);
    $("paywallOk").addEventListener("click", hidePaywall);
    $("paywallPay").addEventListener("click", payAndUnlock);
    $("logoutBtn").addEventListener("click", logout);
    $("adminUsersBtn").addEventListener("click", openAdmin);
    const up = $("acctUpgradeBtn");
    if (up) up.addEventListener("click", () => showPaywall("UPGRADE"));
    $("adminClose").addEventListener("click", closeAdmin);
    document.querySelectorAll("[data-admin-tab]").forEach((btn) =>
      btn.addEventListener("click", () => selectAdminTab(btn.dataset.adminTab)));
    const scrapeBtn = $("forceScrapeBtn");
    if (scrapeBtn) scrapeBtn.addEventListener("click", forceScrape);
    // Re-localize auth/admin labels on a live locale switch.
    if (window.I18n) window.I18n.onChange(() => { switchAuthMode(authMode); renderAccountBar(); });
    bootstrap();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
