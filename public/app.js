const state = {
  featured: [],
  published: [],
  query: "",
  genre: "all"
};

const gameGrid = document.querySelector("#gameGrid");
const publishedGrid = document.querySelector("#publishedGrid");
const spotlight = document.querySelector("#spotlight");
const searchInput = document.querySelector("#searchInput");
const genreFilter = document.querySelector("#genreFilter");
const publishForm = document.querySelector("#publishForm");
const apkInput = document.querySelector("#apkInput");
const fileName = document.querySelector("#fileName");
const formStatus = document.querySelector("#formStatus");
const themeToggle = document.querySelector("#themeToggle");

init();

async function init() {
  restoreTheme();
  bindEvents();
  await loadGames();
}

function bindEvents() {
  searchInput.addEventListener("input", event => {
    state.query = event.target.value.toLowerCase();
    render();
  });

  genreFilter.addEventListener("change", event => {
    state.genre = event.target.value;
    render();
  });

  apkInput.addEventListener("change", () => {
    const file = apkInput.files[0];
    fileName.textContent = file ? file.name : "Drop APK here or choose file";
  });

  publishForm.addEventListener("submit", publishGame);

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

async function loadGames() {
  const response = await fetch("/api/games");
  const data = await response.json();
  state.featured = data.featured || [];
  state.published = data.published || [];
  render();
}

async function publishGame(event) {
  event.preventDefault();
  formStatus.className = "form-status";

  const file = apkInput.files[0];
  if (!file || !file.name.toLowerCase().endsWith(".apk")) {
    setStatus("Choose an .apk file before publishing.", "error");
    return;
  }

  const formData = new FormData(publishForm);
  setStatus("Uploading APK and creating listing...");

  try {
    const response = await fetch("/api/publish", {
      method: "POST",
      body: formData
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || "Publish failed.");
    }

    state.published.unshift(result.listing);
    publishForm.reset();
    fileName.textContent = "Drop APK here or choose file";
    setStatus("Published. Your APK listing is live locally.", "success");
    render();
    document.querySelector("#library").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    setStatus(error.message, "error");
  }
}

function setStatus(message, type) {
  formStatus.textContent = message;
  formStatus.className = `form-status ${type || ""}`.trim();
}

function render() {
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
        ${game.apkUrl ? `<a class="primary-button" href="${game.apkUrl}" download>Download APK</a>` : `<a class="primary-button" href="#publish">Publish yours</a>`}
        <span class="secondary-button">${escapeHtml(game.price)}</span>
      </div>
    </div>
  `;
}

function renderCard(game) {
  const download = game.apkUrl
    ? `<a class="secondary-button" href="${game.apkUrl}" download>APK</a>`
    : `<span class="secondary-button">${escapeHtml(game.price)}</span>`;

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

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
