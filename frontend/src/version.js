// Deploy-stamp badge. Fetches frontend/version.json (written by scripts/deploy.sh
// alongside index.html, same-origin) and renders the live commit in the corner
// badge — short SHA + subject, linking to the GitHub commit. Localized label via
// window.I18n; re-renders on locale change. Missing/blank stamp → "version unknown".
(function () {
  "use strict";

  const el = document.getElementById("version-badge");
  if (!el) return;

  let stamp = null;

  function render() {
    const t = (window.t || ((k) => k));
    if (!stamp || !stamp.sha) {
      el.textContent = t("version.unknown");
      el.removeAttribute("href");
      el.classList.remove("hidden");
      el.classList.add("flex");
      return;
    }
    el.textContent = `${t("version.deployed")} · ${stamp.shortSha || stamp.sha.slice(0, 7)}`;
    if (stamp.subject) el.title = `${stamp.subject}\n${stamp.deployedAt || ""}`.trim();
    if (stamp.repoUrl) {
      const base = stamp.repoUrl.replace(/\.git$/, "");
      el.href = `${base}/commit/${stamp.sha}`;
    } else {
      el.removeAttribute("href");
    }
    el.classList.remove("hidden");
    el.classList.add("flex");
  }

  fetch(window.TPM ? window.TPM.VERSION_URL : "./version.json", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => { stamp = data; render(); })
    .catch(() => { stamp = null; render(); });

  if (window.I18n && window.I18n.onChange) window.I18n.onChange(render);
})();
