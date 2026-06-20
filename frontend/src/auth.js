// ============================================================================
//  auth.js — accounts, roles, paid tiers and usage limits for the TPM frontend
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

  const $ = (id) => document.getElementById(id);
  const show = (el, v) => el && el.classList.toggle("hidden", !v);
  const T = (k, p) => (window.t ? window.t(k, p) : k);

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
    if (!token) { showAuth(); return; }
    try {
      const res = await fetch(AUTH_BASE_URL + "/me", { headers: authHeader() });
      if (!res.ok) throw new Error("me failed");
      user = await res.json();
      onAuthed();
    } catch {
      clearSession();
      showAuth();
    }
  }

  function onAuthed() {
    hideAuth();
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

  function showAuth() { show($("authOverlay"), true); switchAuthMode("login"); }
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
    showAuth();
  }
  function logout() { hardLogout(); }

  // ---- account bar (inside the landing screen) ----
  function renderAccountBar() {
    if (!$("acctEmail")) return;
    $("acctEmail").textContent = user ? user.email : "";
    const roleEl = $("acctRole");
    if (roleEl) {
      roleEl.textContent = user ? T("role." + user.role) + (user.active ? "" : " · " + T("role.pending")) : "";
    }
    show($("adminUsersBtn"), !!user && user.role === "ADMIN");
  }

  // ---- paywall modal ----
  function showPaywall(code, serverMsg) {
    const titleKey = "paywall.title." + (code || "DEFAULT");
    const bodyKey = "paywall.body." + (code || "DEFAULT");
    $("paywallTitle").textContent = T(titleKey) === titleKey ? T("paywall.title.DEFAULT") : T(titleKey);
    const body = T(bodyKey);
    $("paywallBody").textContent = body === bodyKey ? (serverMsg || T("paywall.body.DEFAULT")) : body;
    show($("paywallModal"), true);
  }
  function hidePaywall() { show($("paywallModal"), false); }

  // ---- admin user management ----
  async function openAdmin() {
    show($("adminModal"), true);
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
  function closeAdmin() { show($("adminModal"), false); }

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
             <div class="text-sm text-slate-100">${u.displayName || ""}</div>
             <div class="text-xs text-muted">${u.email}</div>
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
           <div class="text-sm text-slate-100">${u.displayName || ""}</div>
           <div class="text-xs text-muted">${u.email}</div>
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

  // ---- public API ----
  window.Auth = {
    get user() { return user; },
    get token() { return token; },
    apiFetch,
    onReady(cb) { readyCbs.add(cb); if (user) { try { cb(user); } catch (e) { console.error(e); } } },
    logout, showPaywall, refreshMe, openAdmin,
  };

  // ---- wire DOM + boot ----
  function init() {
    $("authForm").addEventListener("submit", submitAuth);
    $("authToggleBtn").addEventListener("click", () => switchAuthMode(authMode === "login" ? "register" : "login"));
    $("paywallClose").addEventListener("click", hidePaywall);
    $("paywallOk").addEventListener("click", hidePaywall);
    $("logoutBtn").addEventListener("click", logout);
    $("adminUsersBtn").addEventListener("click", openAdmin);
    $("adminClose").addEventListener("click", closeAdmin);
    // Re-localize auth/admin labels on a live locale switch.
    if (window.I18n) window.I18n.onChange(() => { switchAuthMode(authMode); renderAccountBar(); });
    bootstrap();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
