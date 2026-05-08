const state = {
  featured: [],
  published: [],
  accounts: [],
  activeAccountId: localStorage.getItem("bqs-active-account") || "",
  query: "",
  genre: "all"
};

const gameGrid = document.querySelector("#gameGrid");
const publishedGrid = document.querySelector("#publishedGrid");
const spotlight = document.querySelector("#spotlight");
const searchInput = document.querySelector("#searchInput");
const genreFilter = document.querySelector("#genreFilter");
const publishForm = document.querySelector("#publishForm");
const publishOwner = document.querySelector("#publishOwner");
const apkInput = document.querySelector("#apkInput");
const fileName = document.querySelector("#fileName");
const formStatus = document.querySelector("#formStatus");
const themeToggle = document.querySelector("#themeToggle");
const accountForm = document.querySelector("#accountForm");
const accountStatus = document.querySelector("#accountStatus");
const activeAccount = document.querySelector("#activeAccount");
const creatorGames = document.querySelector("#creatorGames");

init();

async function init() {
  restoreTheme();
  bindEvents();
  await loadData();
}

function bindEvents() {
  searchInput.addEventListener("input", event => {
    state.query = event.target.value.toLowerCase();
    renderStore();
  });

  genreFilter.addEventListener("change", event => {
    state.genre = event.target.value;
    renderStore();
  });

  apkInput.addEventListener("change", () => {
    const file = apkInput.files[0];
    fileName.textContent = file ? file.name : "Drop APK here or choose file";
  });

  publishForm.addEventListener("submit", publishGame);
  accountForm.addEventListener("submit", createAccount);

  activeAccount.addEventListener("change", event => {
    state.activeAccountId = event.target.value;
    localStorage.setItem("bqs-active-account", state.activeAccountId);
    renderAccounts();
    renderDashboard();
  });

  publishOwner.addEventListener("change", event => {
    state.activeAccountId = event.target.value;
    localStorage.setItem("bqs-active-account", state.activeAccountId);
    renderAccounts();
    renderDashboard();
  });

  creatorGames.addEventListener("submit", event => {
    event.preventDefault();
    const form = event.target;
    const gameId = form.dataset.gameId;
    if (form.classList.contains("edit-game-form")) {
      updateGame(gameId, form);
    }
    if (form.classList.contains("replace-apk-form")) {
      replaceApk(gameId, form);
    }
  });

  creatorGames.addEventListener("click", event => {
    const button = event.target.closest("[data-delete-apk]");
    if (button) {
      deleteApk(button.dataset.deleteApk);
    }
  });

  creatorGames.addEventListener("change", event => {
    if (!event.target.matches(".replacement-apk")) return;
    const label = event.target.closest(".dropzone").querySelector("strong");
    label.textContent = event.target.files[0] ? event.target.files[0].name : "Choose replacement APK";
  });

  themeToggle.addEventListener("click", () => {
    document.documentElement.classList.toggle("dark");
    localStorage.setItem("bqs-theme", document.documentElement.classList.contains("dark") ? "dark" : "light");
  });
}

function restoreTheme() {
  if (localStorage.getItem("bqs-theme") === "dark") {
    document.documentElement.classList.add("dark");
  }
}

async function loadData() {
  const [gamesResponse, accountsResponse] = await Promise.all([
    fetch("/api/games"),
    fetch("/api/accounts")
  ]);
  const games = await gamesResponse.json();
  const accountData = await accountsResponse.json();

  state.featured = games.featured || [];
  state.published = games.published || [];
  state.accounts = accountData.accounts || [];

  if (!state.accounts.some(account => account.id === state.activeAccountId)) {
    state.activeAccountId = state.accounts[0]?.id || "";
    if (state.activeAccountId) {
      localStorage.setItem("bqs-active-account", state.activeAccountId);
    }
  }

  render();
}

async function createAccount(event) {
  event.preventDefault();
  setStatus(accountStatus, "Creating account...");

  const formData = new FormData(accountForm);
  const payload = {
    displayName: formData.get("displayName"),
    handle: formData.get("handle")
  };

  try {
    const response = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || "Could not create account.");

    state.accounts.unshift(result.account);
    state.activeAccountId = result.account.id;
    localStorage.setItem("bqs-active-account", state.activeAccountId);
    accountForm.reset();
    setStatus(accountStatus, "Account created.", "success");
    render();
  } catch (error) {
    setStatus(accountStatus, error.message, "error");
  }
}

async function publishGame(event) {
  event.preventDefault();
  setStatus(formStatus, "");

  const file = apkInput.files[0];
  if (!state.activeAccountId) {
    setStatus(formStatus, "Create a creator account before publishing.", "error");
    return;
  }

  if (!file || !file.name.toLowerCase().endsWith(".apk")) {
    setStatus(formStatus, "Choose an .apk file before publishing.", "error");
    return;
  }

  const formData = new FormData(publishForm);
  formData.set("ownerId", state.activeAccountId);
  setStatus(formStatus, "Uploading APK and creating listing...");

  try {
    const response = await fetch("/api/publish", {
      method: "POST",
      body: formData
    });
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || "Publish failed.");

    state.published.unshift(result.listing);
    publishForm.reset();
    renderAccounts();
    fileName.textContent = "Drop APK here or choose file";
    setStatus(formStatus, "Published. Your APK listing is live locally.", "success");
    render();
    document.querySelector("#dashboard").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setStatus(formStatus, error.message, "error");
  }
}

async function updateGame(gameId, form) {
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());
  const status = form.querySelector(".form-status");
  setStatus(status, "Saving changes...");

  try {
    const response = await fetch(`/api/games/${gameId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || "Could not save listing.");

    replaceListing(result.listing);
    form.closest(".creator-game").querySelector(".creator-game-head h3").textContent = result.listing.title;
    setStatus(status, "Listing updated.", "success");
    renderStore();
    renderLibrary();
  } catch (error) {
    setStatus(status, error.message, "error");
  }
}

async function replaceApk(gameId, form) {
  const input = form.querySelector(".replacement-apk");
  const status = form.querySelector(".form-status");
  const file = input.files[0];

  if (!file || !file.name.toLowerCase().endsWith(".apk")) {
    setStatus(status, "Choose a replacement .apk file.", "error");
    return;
  }

  const formData = new FormData();
  formData.append("apk", file);
  setStatus(status, "Replacing APK...");

  try {
    const response = await fetch(`/api/games/${gameId}/apk`, {
      method: "POST",
      body: formData
    });
    const result = await response.json();

    if (!response.ok) throw new Error(result.error || "Could not replace APK.");

    replaceListing(result.listing);
    setStatus(status, "APK replaced.", "success");
    render();
  } catch (error) {
    setStatus(status, error.message, "error");
  }
}

async function deleteApk(gameId) {
  if (!window.confirm("Delete the stored APK for this listing?")) return;
  const response = await fetch(`/api/games/${gameId}/apk`, { method: "DELETE" });
  const result = await response.json();

  if (response.ok) {
    replaceListing(result.listing);
    render();
  } else {
    window.alert(result.error || "Could not delete APK.");
  }
}

function replaceListing(listing) {
  const index = state.published.findIndex(game => game.id === listing.id);
  if (index !== -1) {
    state.published[index] = listing;
  }
}

function render() {
  renderAccounts();
  renderStore();
  renderDashboard();
  renderLibrary();
}

function renderAccounts() {
  const options = state.accounts.length
    ? state.accounts.map(account => `<option value="${account.id}" ${account.id === state.activeAccountId ? "selected" : ""}>${escapeHtml(account.displayName)} (@${escapeHtml(account.handle)})</option>`).join("")
    : `<option value="">Create an account first</option>`;

  activeAccount.innerHTML = options;
  publishOwner.innerHTML = options;
  publishOwner.value = state.activeAccountId;
}

function renderStore() {
  const games = [...state.published, ...state.featured];
  const filtered = games.filter(game => {
    const matchesQuery = [game.title, game.studio, game.genre, game.summary]
      .join(" ")
      .toLowerCase()
      .includes(state.query);
    const matchesGenre = state.genre === "all" || game.genre === state.genre;
    return matchesQuery && matchesGenre;
  });

  renderSpotlight(games[0] || state.featured[0]);
  gameGrid.innerHTML = filtered.map(renderCard).join("") || `<div class="empty-state">No games match that search.</div>`;
}

function renderDashboard() {
  if (!state.activeAccountId) {
    creatorGames.innerHTML = `<div class="empty-state">Create a creator account to manage game listings.</div>`;
    return;
  }

  const games = state.published.filter(game => game.ownerId === state.activeAccountId);
  creatorGames.innerHTML = games.map(renderDashboardGame).join("") || `<div class="empty-state">This account has no games yet.</div>`;
}

function renderLibrary() {
  publishedGrid.innerHTML = state.published.map(renderCard).join("") || `<div class="empty-state">No local APKs published yet.</div>`;
}

function renderSpotlight(game) {
  if (!game) return;
  spotlight.style.setProperty("--art-a", game.colorA);
  spotlight.style.setProperty("--art-b", game.colorB);
  spotlight.innerHTML = `
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
        ${game.apkUrl ? `<a class="primary-button" href="${game.apkUrl}" download>Download APK</a>` : `<a class="primary-button" href="#publish">Upload APK</a>`}
        <span class="secondary-button">${escapeHtml(game.price)}</span>
      </div>
    </div>
  `;
}

function renderCard(game) {
  const download = game.apkUrl
    ? `<a class="secondary-button" href="${game.apkUrl}" download>APK</a>`
    : `<span class="secondary-button">No APK</span>`;

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
          <p class="eyebrow">${escapeHtml(game.apkName || "No APK uploaded")}</p>
          <h3>${escapeHtml(game.title)}</h3>
        </div>
        <span class="chip">${escapeHtml(game.size)}</span>
      </div>

      <form class="edit-game-form" data-game-id="${game.id}">
        <div class="form-row">
          <label>
            Game title
            <input name="title" required maxlength="80" value="${attr(game.title)}">
          </label>
          <label>
            Studio
            <input name="studio" required maxlength="80" value="${attr(game.studio)}">
          </label>
        </div>
        <div class="form-row">
          <label>
            Genre
            <select name="genre" required>${genreOptions(game.genre)}</select>
          </label>
          <label>
            Price
            <input name="price" maxlength="20" value="${attr(game.price)}">
          </label>
        </div>
        <label>
          Comfort
          <select name="comfort">${comfortOptions(game.comfort)}</select>
        </label>
        <label>
          Short description
          <textarea name="summary" required maxlength="220">${escapeHtml(game.summary)}</textarea>
        </label>
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

function setStatus(element, message, type) {
  element.textContent = message;
  element.className = `form-status ${type || ""}`.trim();
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
