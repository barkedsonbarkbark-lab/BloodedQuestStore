const state = {
  account: null,
  published: [],
  studioListings: [],
  query: "",
  genre: "all",
  studioTab: "overview",
  authTab: "login"
};

const elements = {
  searchInput: document.querySelector("#searchInput"),
  genreFilter: document.querySelector("#genreFilter"),
  spotlight: document.querySelector("#spotlight"),
  gameGrid: document.querySelector("#gameGrid"),
  statGames: document.querySelector("#statGames"),
  authShell: document.querySelector("#authShell"),
  authStatus: document.querySelector("#authStatus"),
  authTitle: document.querySelector("#authTitle"),
  authDescription: document.querySelector("#authDescription"),
  loginForm: document.querySelector("#loginForm"),
  registerForm: document.querySelector("#registerForm"),
  signedInCard: document.querySelector("#signedInCard"),
  accountAvatar: document.querySelector("#accountAvatar"),
  accountName: document.querySelector("#accountName"),
  accountHandle: document.querySelector("#accountHandle"),
  logoutButton: document.querySelector("#logoutButton"),
  publishForm: document.querySelector("#publishForm"),
  apkInput: document.querySelector("#apkInput"),
  fileName: document.querySelector("#fileName"),
  formStatus: document.querySelector("#formStatus"),
  creatorGames: document.querySelector("#creatorGames"),
  studioSummary: document.querySelector("#studioSummary"),
  overviewTitle: document.querySelector("#overviewTitle"),
  metricPublished: document.querySelector("#metricPublished"),
  metricApks: document.querySelector("#metricApks"),
  metricSize: document.querySelector("#metricSize"),
  themeToggle: document.querySelector("#themeToggle")
};

init();

async function init() {
  restoreTheme();
  bindEvents();
  await loadApp();
}

function bindEvents() {
  elements.searchInput.addEventListener("input", event => {
    state.query = event.target.value.toLowerCase();
    renderStore();
  });

  elements.genreFilter.addEventListener("change", event => {
    state.genre = event.target.value;
    renderStore();
  });

  elements.loginForm.addEventListener("submit", event => submitAuth(event, "login"));
  elements.registerForm.addEventListener("submit", event => submitAuth(event, "register"));
  elements.logoutButton.addEventListener("click", logout);
  elements.publishForm.addEventListener("submit", publishGame);

  elements.apkInput.addEventListener("change", () => {
    elements.fileName.textContent = elements.apkInput.files[0]?.name || "Drop APK here or choose file";
  });

  document.querySelectorAll("[data-auth-tab]").forEach(button => {
    button.addEventListener("click", () => {
      state.authTab = button.dataset.authTab;
      renderAuth();
    });
  });

  document.querySelectorAll("[data-studio-tab]").forEach(button => {
    button.addEventListener("click", () => {
      state.studioTab = button.dataset.studioTab;
      renderStudioTabs();
    });
  });

  elements.creatorGames.addEventListener("submit", event => {
    event.preventDefault();
    const form = event.target;
    const gameId = form.dataset.gameId;
    if (form.classList.contains("edit-game-form")) updateGame(gameId, form);
    if (form.classList.contains("replace-apk-form")) replaceApk(gameId, form);
  });

  elements.creatorGames.addEventListener("click", event => {
    const button = event.target.closest("[data-delete-apk]");
    if (button) deleteApk(button.dataset.deleteApk);
  });

  elements.creatorGames.addEventListener("change", event => {
    if (!event.target.matches(".replacement-apk")) return;
    const label = event.target.closest(".dropzone").querySelector("strong");
    label.textContent = event.target.files[0]?.name || "Choose replacement APK";
  });

  elements.themeToggle.addEventListener("click", () => {
    document.documentElement.classList.toggle("dark");
    localStorage.setItem("bqs-theme", document.documentElement.classList.contains("dark") ? "dark" : "light");
  });
}

function restoreTheme() {
  if (localStorage.getItem("bqs-theme") === "dark") {
    document.documentElement.classList.add("dark");
  }
}

async function loadApp() {
  try {
    await refreshData();
    render();
  } catch (error) {
    renderOfflineError(error.message);
  }
}

async function refreshData() {
  const [session, games] = await Promise.all([
    apiRequest("/api/session"),
    apiRequest("/api/games")
  ]);
  state.account = session.account;
  state.published = games.published || [];
  await loadStudio();
}

async function loadStudio() {
  if (!state.account) {
    state.studioListings = [];
    return;
  }
  const studio = await apiRequest("/api/studio");
  state.account = studio.account;
  state.studioListings = studio.listings || [];
}

async function submitAuth(event, mode) {
  event.preventDefault();
  const form = mode === "login" ? elements.loginForm : elements.registerForm;
  const payload = Object.fromEntries(new FormData(form).entries());
  setStatus(elements.authStatus, mode === "login" ? "Logging in..." : "Creating account...");

  try {
    const result = await apiRequest(`/api/auth/${mode === "login" ? "login" : "register"}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    state.account = result.account;
    form.reset();
    await loadStudio();
    setStatus(elements.authStatus, "Signed in.", "success");
    render();
  } catch (error) {
    setStatus(elements.authStatus, error.message, "error");
  }
}

async function logout() {
  await apiRequest("/api/auth/logout", { method: "POST" });
  state.account = null;
  state.studioListings = [];
  render();
}

async function publishGame(event) {
  event.preventDefault();
  if (!state.account) {
    setStatus(elements.formStatus, "Log in before publishing.", "error");
    location.hash = "#account";
    return;
  }

  const file = elements.apkInput.files[0];
  if (!file || !file.name.toLowerCase().endsWith(".apk")) {
    setStatus(elements.formStatus, "Choose an .apk file before publishing.", "error");
    return;
  }

  setStatus(elements.formStatus, "Uploading APK and creating listing...");
  try {
    await apiRequest("/api/publish", {
      method: "POST",
      body: new FormData(elements.publishForm)
    });
    elements.publishForm.reset();
    elements.fileName.textContent = "Drop APK here or choose file";
    await refreshData();
    state.studioTab = "content";
    render();
    setStatus(elements.formStatus, "Published and saved. Your listing is in Studio.", "success");
  } catch (error) {
    setStatus(elements.formStatus, error.message, "error");
  }
}

async function updateGame(gameId, form) {
  const status = form.querySelector(".form-status");
  setStatus(status, "Saving...");

  try {
    const result = await apiRequest(`/api/games/${gameId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.fromEntries(new FormData(form).entries()))
    });
    replaceListing(result.listing);
    setStatus(status, "Saved.", "success");
    renderStore();
    renderStudioMetrics();
  } catch (error) {
    setStatus(status, error.message, "error");
  }
}

async function replaceApk(gameId, form) {
  const status = form.querySelector(".form-status");
  const file = form.querySelector(".replacement-apk").files[0];

  if (!file || !file.name.toLowerCase().endsWith(".apk")) {
    setStatus(status, "Choose a replacement .apk file.", "error");
    return;
  }

  const body = new FormData();
  body.append("apk", file);
  setStatus(status, "Replacing APK...");

  try {
    const result = await apiRequest(`/api/games/${gameId}/apk`, { method: "POST", body });
    replaceListing(result.listing);
    setStatus(status, "APK replaced.", "success");
    render();
  } catch (error) {
    setStatus(status, error.message, "error");
  }
}

async function deleteApk(gameId) {
  if (!window.confirm("Delete the stored APK for this listing?")) return;
  try {
    const result = await apiRequest(`/api/games/${gameId}/apk`, { method: "DELETE" });
    replaceListing(result.listing);
    render();
  } catch (error) {
    window.alert(error.message);
  }
}

function replaceListing(listing) {
  const studioIndex = state.studioListings.findIndex(game => game.id === listing.id);
  if (studioIndex !== -1) state.studioListings[studioIndex] = listing;

  const publicIndex = state.published.findIndex(game => game.id === listing.id);
  if (publicIndex !== -1) state.published[publicIndex] = listing;
}

function render() {
  renderAuth();
  renderStore();
  renderStudio();
  renderStudioTabs();
}

function renderAuth() {
  document.querySelectorAll("[data-auth-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.authTab === state.authTab);
  });

  elements.loginForm.classList.toggle("active", !state.account && state.authTab === "login");
  elements.registerForm.classList.toggle("active", !state.account && state.authTab === "register");
  elements.signedInCard.hidden = !state.account;
  elements.logoutButton.hidden = !state.account;

  if (state.account) {
    elements.authTitle.textContent = "You are signed in";
    elements.authDescription.textContent = "Your Studio tools are unlocked. Upload APKs, edit listings, and manage release files.";
    elements.accountName.textContent = state.account.displayName;
    elements.accountHandle.textContent = `@${state.account.handle}`;
    elements.accountAvatar.textContent = initials(state.account.displayName);
  } else {
    elements.authTitle.textContent = "Log in or create your channel";
    elements.authDescription.textContent = "Use a creator handle and password before publishing. Passwords are salted and hashed on the Node server.";
  }
}

function renderStore() {
  const visiblePublished = state.published.filter(game => !game.visibility || game.visibility === "Public");
  const games = [...visiblePublished];
  const filtered = games.filter(game => {
    const matchesQuery = [game.title, game.studio, game.genre, game.summary].join(" ").toLowerCase().includes(state.query);
    const matchesGenre = state.genre === "all" || game.genre === state.genre;
    return matchesQuery && matchesGenre;
  });

  elements.statGames.textContent = String(games.length);
  renderSpotlight(games[0]);
  elements.gameGrid.innerHTML = filtered.map(renderCard).join("") || renderStoreEmptyState(games.length);
}

function renderStudio() {
  renderStudioMetrics();
  elements.creatorGames.innerHTML = state.account
    ? state.studioListings.map(renderDashboardGame).join("") || `<div class="empty-state">No games yet. Upload your first APK from the Upload tab.</div>`
    : `<div class="empty-state">Log in to manage your game catalog.</div>`;
}

function renderStudioMetrics() {
  const count = state.studioListings.length;
  const apkCount = state.studioListings.filter(game => game.hasApk).length;
  const totalMb = state.studioListings.reduce((sum, game) => sum + sizeToMb(game.size), 0);
  const name = state.account ? state.account.displayName : "Log in to view Studio";

  elements.overviewTitle.textContent = state.account ? `${name} Studio` : "Log in to view Studio";
  elements.metricPublished.textContent = String(count);
  elements.metricApks.textContent = String(apkCount);
  elements.metricSize.textContent = `${totalMb.toFixed(totalMb >= 10 ? 0 : 1)} MB`;
  elements.studioSummary.innerHTML = state.account
    ? `<span class="avatar">${initials(name)}</span><strong>${escapeHtml(name)}</strong><p>@${escapeHtml(state.account.handle)}</p>`
    : `<p>Sign in to upload APK builds and manage your listings.</p>`;
}

function renderStudioTabs() {
  document.querySelectorAll("[data-studio-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.studioTab === state.studioTab);
  });
  document.querySelectorAll(".studio-panel").forEach(panel => {
    panel.classList.remove("active");
  });
  document.querySelector(`#${state.studioTab}Panel`).classList.add("active");
}

function renderSpotlight(game) {
  if (!game) {
    elements.spotlight.removeAttribute("style");
    elements.spotlight.innerHTML = `
      <div class="spotlight-empty">
        <p class="eyebrow">No creator uploads yet</p>
        <h3>Be the first to publish an APK.</h3>
        <p>The store only shows real games uploaded by creator accounts. No sample games, no seeded catalog, no fake listings.</p>
        <a class="primary-button" href="#studio">Open Studio</a>
      </div>
    `;
    return;
  }
  elements.spotlight.style.setProperty("--art-a", game.colorA);
  elements.spotlight.style.setProperty("--art-b", game.colorB);
  elements.spotlight.innerHTML = `
    <div class="spotlight-art" aria-hidden="true"></div>
    <div class="spotlight-body">
      <div class="meta-row">
        <span class="chip">${escapeHtml(game.genre)}</span>
        <span class="chip">${escapeHtml(game.comfort)}</span>
        <span class="chip">${escapeHtml(game.size)}</span>
      </div>
      <h3>${escapeHtml(game.title)}</h3>
      <p>${escapeHtml(game.summary)}</p>
      <div class="hero-actions">
        ${game.apkUrl ? `<a class="primary-button" href="${game.apkUrl}" download>Download APK</a>` : `<a class="primary-button" href="#studio">Upload APK</a>`}
        <span class="secondary-button">${escapeHtml(game.price)}</span>
      </div>
    </div>
  `;
}

function renderStoreEmptyState(totalGames) {
  if (totalGames === 0) {
    return `<div class="empty-state">No creator games have been uploaded yet. Log in, open Studio, and publish the first APK.</div>`;
  }
  return `<div class="empty-state">No uploaded games match that search.</div>`;
}

function renderCard(game) {
  const download = game.apkUrl
    ? `<a class="secondary-button small" href="${game.apkUrl}" download>APK</a>`
    : `<span class="secondary-button small">No APK</span>`;

  return `
    <article class="game-card">
      <div class="card-art" style="--art-a:${game.colorA}; --art-b:${game.colorB}" aria-hidden="true"></div>
      <div class="game-card-body">
        <div class="meta-row">
          <span class="chip">${escapeHtml(game.genre)}</span>
          <span class="chip">${escapeHtml(game.rating)}</span>
        </div>
        <h3>${escapeHtml(game.title)}</h3>
        <p>${escapeHtml(game.summary)}</p>
        <div class="card-footer">
          <span>${escapeHtml(game.studio)}</span>
          ${download}
        </div>
      </div>
    </article>
  `;
}

function renderDashboardGame(game) {
  return `
    <article class="creator-game">
      <div class="creator-game-head">
        <div>
          <p class="eyebrow">${escapeHtml(game.visibility || "Public")} / ${escapeHtml(game.apkName || "No APK uploaded")}</p>
          <h3>${escapeHtml(game.title)}</h3>
        </div>
        <span class="chip">${escapeHtml(game.size)}</span>
      </div>
      <form class="edit-game-form" data-game-id="${game.id}">
        <div class="form-row">
          <label>Game title<input name="title" required maxlength="80" value="${attr(game.title)}"></label>
          <label>Price<input name="price" maxlength="20" value="${attr(game.price)}"></label>
        </div>
        <div class="form-row">
          <label>Genre<select name="genre" required>${genreOptions(game.genre)}</select></label>
          <label>Visibility<select name="visibility">${visibilityOptions(game.visibility)}</select></label>
        </div>
        <label>Comfort<select name="comfort">${comfortOptions(game.comfort)}</select></label>
        <label>Description<textarea name="summary" required maxlength="260">${escapeHtml(game.summary)}</textarea></label>
        <button class="primary-button submit-button" type="submit">Save listing</button>
        <p class="form-status" role="status"></p>
      </form>
      <form class="replace-apk-form apk-tools" data-game-id="${game.id}">
        <label class="dropzone compact-drop">
          <input class="replacement-apk" name="apk" type="file" accept=".apk,application/vnd.android.package-archive">
          <span class="drop-icon">APK</span>
          <strong>Choose replacement APK</strong>
          <small>Uploading a new APK deletes the old APK file.</small>
        </label>
        <div class="apk-actions">
          <button class="secondary-button" type="submit">Upload new APK</button>
          <button class="danger-button" type="button" data-delete-apk="${game.id}" ${game.apkUrl ? "" : "disabled"}>Delete old APK</button>
        </div>
        <p class="form-status" role="status"></p>
      </form>
    </article>
  `;
}

function genreOptions(current) {
  return ["Action", "Adventure", "Music", "Puzzle", "Sports", "Horror"]
    .map(genre => `<option ${genre === current ? "selected" : ""}>${genre}</option>`)
    .join("");
}

function comfortOptions(current) {
  return ["Comfortable", "Moderate", "Intense"]
    .map(comfort => `<option ${comfort === current ? "selected" : ""}>${comfort}</option>`)
    .join("");
}

function visibilityOptions(current) {
  return ["Public", "Unlisted", "Draft"]
    .map(visibility => `<option ${visibility === current ? "selected" : ""}>${visibility}</option>`)
    .join("");
}

async function apiRequest(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = {};

  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Server did not return JSON for ${url}. Start with "npm start" and open http://localhost:3000.`);
    }
  }

  if (!response.ok) throw new Error(data.error || `Request failed: ${response.status}`);
  return data;
}

function renderOfflineError(message) {
  const html = `<div class="empty-state">${escapeHtml(message)}</div>`;
  elements.gameGrid.innerHTML = html;
  elements.creatorGames.innerHTML = html;
  elements.spotlight.innerHTML = "";
  setStatus(elements.authStatus, message, "error");
}

function setStatus(element, message, type) {
  element.textContent = message;
  element.className = `form-status ${type || ""}`.trim();
}

function initials(value) {
  return String(value || "BQ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0].toUpperCase())
    .join("");
}

function sizeToMb(size) {
  const text = String(size || "");
  const number = Number.parseFloat(text);
  if (Number.isNaN(number)) return 0;
  if (text.includes("GB")) return number * 1024;
  if (text.includes("KB")) return number / 1024;
  return number;
}

function attr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
