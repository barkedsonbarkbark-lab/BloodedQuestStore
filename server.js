const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
let firebaseAdmin = null;

try {
  firebaseAdmin = require("firebase-admin");
} catch {
  firebaseAdmin = null;
}

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
loadEnvFile(path.join(ROOT, ".env"));
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const LISTINGS_FILE = path.join(DATA_DIR, "listings.json");
const ACCOUNTS_FILE = path.join(DATA_DIR, "accounts.json");
const SESSIONS_FILE = path.join(DATA_DIR, "sessions.json");
const FIRESTORE_PREFIX = cleanCollectionPrefix(process.env.FIRESTORE_PREFIX || "bqs");
const MAX_UPLOAD_BYTES = 350 * 1024 * 1024;
const SESSION_DAYS = 14;
const RELEASE_STATUSES = ["Public", "Coming Soon", "Private"];
const LEGACY_RELEASE_STATUSES = {
  Unlisted: "Private",
  Draft: "Private"
};
let firestoreDb = null;

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml; charset=utf-8",
  ".webp": "image/webp",
  ".ico": "image/x-icon"
};

ensureStorage();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/games") {
      const listings = await readListings();
      return sendJson(res, 200, {
        published: storefrontListings(listings.filter(isStorefrontVisible))
      });
    }

    if (req.method === "GET" && url.pathname === "/api/session") {
      return sendJson(res, 200, { account: await getSessionAccount(req) });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/register") {
      return handleRegister(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      return handleLogin(req, res);
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      await clearSession(req);
      res.setHeader("Set-Cookie", cookieHeader("bqs_session", "", { maxAge: 0 }));
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET" && url.pathname === "/api/studio") {
      const account = await requireAccount(req, res);
      if (!account) return;
      return sendJson(res, 200, {
        account,
        listings: publicListings((await readListings()).filter(listing => listing.ownerId === account.id))
      });
    }

    if (req.method === "POST" && url.pathname === "/api/publish") {
      return handlePublish(req, res);
    }

    const gameMatch = url.pathname.match(/^\/api\/games\/([^/]+)$/);
    if (gameMatch && req.method === "PATCH") {
      return handleUpdateGame(req, res, gameMatch[1]);
    }

    const apkMatch = url.pathname.match(/^\/api\/games\/([^/]+)\/apk$/);
    if (apkMatch && req.method === "POST") {
      return handleReplaceApk(req, res, apkMatch[1]);
    }

    if (apkMatch && req.method === "DELETE") {
      return handleDeleteApk(req, res, apkMatch[1]);
    }

    if (url.pathname.startsWith("/api/")) {
      return sendJson(res, 404, { error: `API route not found: ${url.pathname}` });
    }

    if (req.method === "GET" && url.pathname.startsWith("/uploads/")) {
      return serveUpload(url.pathname, res);
    }

    if (req.method === "GET") {
      return servePublic(url.pathname, res);
    }

    sendJson(res, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message || "Something went wrong on the server." });
  }
});

server.listen(PORT, () => {
  console.log(`Blooded Quest Store running at http://localhost:${PORT}`);
});

function ensureStorage() {
  initializeFirebase();
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!firestoreDb) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    for (const file of [LISTINGS_FILE, ACCOUNTS_FILE, SESSIONS_FILE]) {
      if (!fs.existsSync(file)) fs.writeFileSync(file, "[]\n");
    }
  }
}

function initializeFirebase() {
  if (!firebaseAdmin) return;

  try {
    if (!firebaseAdmin.apps.length) {
      const credential = getFirebaseCredential();
      if (credential) firebaseAdmin.initializeApp({ credential });
      else firebaseAdmin.initializeApp();
    }
    firestoreDb = firebaseAdmin.firestore();
    console.log(`Using Firebase Firestore collections with prefix "${FIRESTORE_PREFIX}".`);
  } catch (error) {
    firestoreDb = null;
    console.warn(`Firestore disabled, using local JSON files instead: ${error.message}`);
  }
}

function getFirebaseCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
    const json = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_BASE64, "base64").toString("utf8");
    return firebaseAdmin.credential.cert(JSON.parse(json));
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return firebaseAdmin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    return firebaseAdmin.credential.applicationDefault();
  }

  return null;
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

function writeJsonFile(file, data) {
  fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`);
}

async function readListings() {
  return readCollection("listings", LISTINGS_FILE, "publishedAt");
}

async function writeListings(listings) {
  return writeCollection("listings", LISTINGS_FILE, listings);
}

async function readAccounts() {
  return readCollection("accounts", ACCOUNTS_FILE, "createdAt");
}

async function writeAccounts(accounts) {
  return writeCollection("accounts", ACCOUNTS_FILE, accounts);
}

async function readSessions() {
  const sessions = await readCollection("sessions", SESSIONS_FILE, "expiresAt");
  return sessions.filter(session => new Date(session.expiresAt).getTime() > Date.now());
}

async function writeSessions(sessions) {
  return writeCollection("sessions", SESSIONS_FILE, sessions, { deleteMissing: true });
}

async function readCollection(name, file, sortField) {
  if (!firestoreDb) return readJsonFile(file);

  const snapshot = await firestoreDb.collection(collectionName(name)).get();
  if (snapshot.empty && fs.existsSync(file)) {
    const localRecords = readJsonFile(file);
    if (localRecords.length) {
      await writeCollection(name, file, localRecords);
      return localRecords;
    }
  }

  return snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((a, b) => String(b[sortField] || "").localeCompare(String(a[sortField] || "")));
}

async function writeCollection(name, file, records, options = {}) {
  if (!firestoreDb) {
    writeJsonFile(file, records);
    return;
  }

  const collection = firestoreDb.collection(collectionName(name));
  const batch = firestoreDb.batch();

  if (options.deleteMissing) {
    const snapshot = await collection.get();
    const nextIds = new Set(records.map(record => record.id || record.tokenHash));
    for (const doc of snapshot.docs) {
      if (!nextIds.has(doc.id)) batch.delete(doc.ref);
    }
  }

  for (const record of records) {
    const id = record.id || record.tokenHash || crypto.randomUUID();
    batch.set(collection.doc(id), { ...record, id }, { merge: false });
  }

  await batch.commit();
}

function collectionName(name) {
  return `${FIRESTORE_PREFIX}_${name}`;
}

function cleanCollectionPrefix(value) {
  return String(value || "bqs").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 32) || "bqs";
}

async function handleRegister(req, res) {
  const payload = await readJsonBody(req, 64 * 1024);
  const displayName = cleanText(payload.displayName, 80);
  const handle = cleanHandle(payload.handle || displayName);
  const password = String(payload.password || "");

  if (!displayName || !handle) {
    return sendJson(res, 400, { error: "Creator name and handle are required." });
  }

  if (password.length < 8) {
    return sendJson(res, 400, { error: "Password must be at least 8 characters." });
  }

  const accounts = await readAccounts();
  const existingIndex = accounts.findIndex(account => account.handle.toLowerCase() === handle.toLowerCase());
  if (existingIndex !== -1 && accounts[existingIndex].passwordHash) {
    return sendJson(res, 409, { error: "That creator handle is already taken." });
  }

  const account = existingIndex === -1 ? {
    id: crypto.randomUUID(),
    displayName,
    handle,
    passwordHash: hashPassword(password),
    createdAt: new Date().toISOString()
  } : {
    ...accounts[existingIndex],
    displayName,
    passwordHash: hashPassword(password),
    updatedAt: new Date().toISOString()
  };

  if (existingIndex === -1) accounts.unshift(account);
  else accounts[existingIndex] = account;
  await writeAccounts(accounts);
  await createSession(res, account.id);
  sendJson(res, 201, { account: publicAccount(account) });
}

async function handleLogin(req, res) {
  const payload = await readJsonBody(req, 64 * 1024);
  const handle = cleanHandle(payload.handle);
  const password = String(payload.password || "");
  const account = (await readAccounts()).find(candidate => candidate.handle.toLowerCase() === handle.toLowerCase());

  if (!account || !account.passwordHash || !verifyPassword(password, account.passwordHash)) {
    return sendJson(res, 401, { error: "Invalid handle or password." });
  }

  await createSession(res, account.id);
  sendJson(res, 200, { account: publicAccount(account) });
}

async function handlePublish(req, res) {
  const account = await requireAccount(req, res);
  if (!account) return;

  const upload = await readMultipart(req);
  if (upload.error) return sendJson(res, 400, { error: upload.error });

  const { fields, files } = upload;
  const apk = files.apk;

  if (!apk || !apk.filename) {
    return sendJson(res, 400, { error: "An APK file is required." });
  }

  if (path.extname(apk.filename).toLowerCase() !== ".apk") {
    return sendJson(res, 400, { error: "Only .apk files can be published." });
  }

  const title = cleanText(fields.title, 80);
  const genre = cleanText(fields.genre, 40);
  const summary = cleanText(fields.summary, 260);
  const comfort = cleanText(fields.comfort, 40) || "Comfortable";
  const price = cleanText(fields.price, 20) || "Free";
  const visibility = normalizeReleaseStatus(fields.visibility);

  if (!title || !genre || !summary) {
    return sendJson(res, 400, { error: "Title, genre, and description are required." });
  }

  const id = crypto.randomUUID();
  const storedApk = await saveApk({
    listingId: id,
    originalName: apk.filename,
    data: apk.data
  });

  const listing = {
    id,
    title,
    studio: account.displayName,
    genre,
    summary,
    comfort,
    price,
    visibility,
    rating: "New",
    downloads: 0,
    size: formatBytes(apk.data.length),
    apkName: path.basename(apk.filename),
    apkUrl: storedApk.url,
    apkKey: storedApk.key,
    apkStorage: storedApk.storage,
    ownerId: account.id,
    publishedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    colorA: pickColor(title, 0),
    colorB: pickColor(title, 1)
  };

  const listings = await readListings();
  listings.unshift(listing);
  await writeListings(listings);
  await assertListingWasSaved(id);
  sendJson(res, 201, { listing: publicListing(listing) });
}

async function handleUpdateGame(req, res, id) {
  const account = await requireAccount(req, res);
  if (!account) return;

  const payload = await readJsonBody(req, 64 * 1024);
  const listings = await readListings();
  const index = listings.findIndex(listing => listing.id === id);

  if (index === -1) return sendJson(res, 404, { error: "Game listing not found." });
  if (listings[index].ownerId !== account.id) return sendJson(res, 403, { error: "You can only edit your own games." });

  const next = {
    ...listings[index],
    title: cleanText(payload.title, 80),
    genre: cleanText(payload.genre, 40),
    summary: cleanText(payload.summary, 260),
    comfort: cleanText(payload.comfort, 40) || "Comfortable",
    price: cleanText(payload.price, 20) || "Free",
    visibility: normalizeReleaseStatus(payload.visibility),
    updatedAt: new Date().toISOString()
  };

  if (!next.title || !next.genre || !next.summary) {
    return sendJson(res, 400, { error: "Title, genre, and description are required." });
  }

  next.colorA = pickColor(next.title, 0);
  next.colorB = pickColor(next.title, 1);
  listings[index] = next;
  await writeListings(listings);
  await assertListingWasSaved(id);
  sendJson(res, 200, { listing: publicListing(next) });
}

async function handleReplaceApk(req, res, id) {
  const account = await requireAccount(req, res);
  if (!account) return;

  const listings = await readListings();
  const index = listings.findIndex(listing => listing.id === id);
  if (index === -1) return sendJson(res, 404, { error: "Game listing not found." });
  if (listings[index].ownerId !== account.id) return sendJson(res, 403, { error: "You can only update your own APKs." });

  const upload = await readMultipart(req);
  if (upload.error) return sendJson(res, 400, { error: upload.error });

  const apk = upload.files.apk;
  if (!apk || !apk.filename) return sendJson(res, 400, { error: "Choose a replacement APK file." });
  if (path.extname(apk.filename).toLowerCase() !== ".apk") {
    return sendJson(res, 400, { error: "Only .apk files can be uploaded." });
  }

  await removeStoredApk(listings[index]);
  const storedApk = await saveApk({
    listingId: id,
    originalName: apk.filename,
    data: apk.data
  });

  listings[index] = {
    ...listings[index],
    size: formatBytes(apk.data.length),
    apkName: path.basename(apk.filename),
    apkUrl: storedApk.url,
    apkKey: storedApk.key,
    apkStorage: storedApk.storage,
    updatedAt: new Date().toISOString()
  };

  await writeListings(listings);
  await assertListingWasSaved(id);
  sendJson(res, 200, { listing: publicListing(listings[index]) });
}

async function handleDeleteApk(req, res, id) {
  const account = await requireAccount(req, res);
  if (!account) return;

  const listings = await readListings();
  const index = listings.findIndex(listing => listing.id === id);
  if (index === -1) return sendJson(res, 404, { error: "Game listing not found." });
  if (listings[index].ownerId !== account.id) return sendJson(res, 403, { error: "You can only delete your own APKs." });

  await removeStoredApk(listings[index]);
  listings[index] = {
    ...listings[index],
    size: "No APK",
    apkName: "",
    apkUrl: "",
    apkKey: "",
    apkStorage: "",
    updatedAt: new Date().toISOString()
  };

  await writeListings(listings);
  await assertListingWasSaved(id);
  sendJson(res, 200, { listing: publicListing(listings[index]) });
}

async function readMultipart(req) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    return { error: "Request must use multipart/form-data." };
  }

  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) return { error: "Missing upload boundary." };

  const body = await readRequestBody(req, MAX_UPLOAD_BYTES);
  return parseMultipart(body, boundaryMatch[1] || boundaryMatch[2]);
}

function readRequestBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    req.on("data", chunk => {
      total += chunk.length;
      if (total > limit) {
        reject(new Error("Upload is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJsonBody(req, limit) {
  const body = await readRequestBody(req, limit);
  if (!body.length) return {};
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    return {};
  }
}

function parseMultipart(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const fields = {};
  const files = {};
  let cursor = buffer.indexOf(delimiter);

  while (cursor !== -1) {
    let partStart = cursor + delimiter.length;
    if (buffer.slice(partStart, partStart + 2).toString() === "--") break;
    if (buffer.slice(partStart, partStart + 2).toString() === "\r\n") partStart += 2;

    const next = buffer.indexOf(delimiter, partStart);
    if (next === -1) break;

    let part = buffer.slice(partStart, next);
    if (part.slice(-2).toString() === "\r\n") part = part.slice(0, -2);

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const headers = part.slice(0, headerEnd).toString("utf8");
      const data = part.slice(headerEnd + 4);
      const disposition = headers.match(/content-disposition:\s*form-data;\s*([^\r\n]+)/i);

      if (disposition) {
        const name = getDispositionValue(disposition[1], "name");
        const filename = getDispositionValue(disposition[1], "filename");
        if (name && filename !== null) files[name] = { filename, data };
        else if (name) fields[name] = data.toString("utf8").trim();
      }
    }

    cursor = next;
  }

  return { fields, files };
}

function getDispositionValue(disposition, key) {
  const match = disposition.match(new RegExp(`${key}="([^"]*)"`, "i"));
  return match ? match[1] : null;
}

async function createSession(res, accountId) {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const sessions = await readSessions();
  sessions.push({ tokenHash: sha256(token), accountId, expiresAt });
  await writeSessions(sessions);
  res.setHeader("Set-Cookie", cookieHeader("bqs_session", token, { maxAge: SESSION_DAYS * 24 * 60 * 60 }));
}

async function clearSession(req) {
  const token = parseCookies(req).bqs_session;
  if (!token) return;
  await writeSessions((await readSessions()).filter(session => session.tokenHash !== sha256(token)));
}

async function getSessionAccount(req) {
  const token = parseCookies(req).bqs_session;
  if (!token) return null;
  const session = (await readSessions()).find(candidate => candidate.tokenHash === sha256(token));
  if (!session) return null;
  const account = (await readAccounts()).find(candidate => candidate.id === session.accountId);
  return account ? publicAccount(account) : null;
}

async function requireAccount(req, res) {
  const account = await getSessionAccount(req);
  if (!account) {
    sendJson(res, 401, { error: "Log in to continue." });
    return null;
  }
  return account;
}

function parseCookies(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map(cookie => cookie.trim())
    .filter(Boolean)
    .reduce((cookies, pair) => {
      const index = pair.indexOf("=");
      if (index === -1) return cookies;
      cookies[pair.slice(0, index)] = decodeURIComponent(pair.slice(index + 1));
      return cookies;
    }, {});
}

function cookieHeader(name, value, options = {}) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax"
  ];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join("; ");
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return `pbkdf2_sha256$120000$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const [scheme, iterations, salt, expected] = String(stored).split("$");
  if (scheme !== "pbkdf2_sha256" || !iterations || !salt || !expected) return false;
  const actual = crypto.pbkdf2Sync(password, salt, Number(iterations), 32, "sha256");
  const expectedBuffer = Buffer.from(expected, "hex");
  return expectedBuffer.length === actual.length && crypto.timingSafeEqual(actual, expectedBuffer);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function publicAccount(account) {
  return {
    id: account.id,
    displayName: account.displayName,
    handle: account.handle,
    createdAt: account.createdAt
  };
}

function publicListings(listings) {
  return listings.map(publicListing);
}

function storefrontListings(listings) {
  return listings.map(storefrontListing);
}

function storefrontListing(listing) {
  const output = publicListing(listing);
  if (output.isDownloadable) return output;
  return {
    ...output,
    apkUrl: "",
    apkKey: "",
    apkStorage: "",
    hasApk: false,
    isDownloadable: false
  };
}

function publicListing(listing) {
  const visibility = normalizeReleaseStatus(listing.visibility);
  return {
    ...listing,
    visibility,
    hasApk: Boolean(listing.apkUrl),
    isDownloadable: isDownloadableListing({ ...listing, visibility })
  };
}

function normalizeReleaseStatus(value) {
  const cleaned = cleanText(value, 24);
  const legacy = LEGACY_RELEASE_STATUSES[cleaned];
  if (legacy) return legacy;
  return RELEASE_STATUSES.includes(cleaned) ? cleaned : "Public";
}

function isStorefrontVisible(listing) {
  return ["Public", "Coming Soon"].includes(normalizeReleaseStatus(listing.visibility));
}

function isDownloadableListing(listing) {
  return normalizeReleaseStatus(listing.visibility) === "Public" && Boolean(listing.apkUrl);
}

async function assertListingWasSaved(id) {
  const saved = (await readListings()).some(listing => listing.id === id);
  if (!saved) {
    throw new Error("The APK uploaded, but the game listing was not saved. Try again.");
  }
}

function servePublic(urlPath, res) {
  const requestPath = urlPath === "/" ? "/index.html" : urlPath;
  const safePath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) return sendText(res, 403, "Forbidden");

  fs.readFile(filePath, (error, data) => {
    if (error) {
      fs.readFile(path.join(PUBLIC_DIR, "index.html"), (fallbackError, fallback) => {
        if (fallbackError) return sendText(res, 404, "Not found");
        sendBuffer(res, 200, fallback, MIME_TYPES[".html"]);
      });
      return;
    }

    sendBuffer(res, 200, data, MIME_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream");
  });
}

function serveUpload(urlPath, res) {
  const fileName = path.basename(urlPath);
  const filePath = path.join(UPLOAD_DIR, fileName);
  if (!filePath.startsWith(UPLOAD_DIR)) return sendText(res, 403, "Forbidden");

  fs.readFile(filePath, (error, data) => {
    if (error) return sendText(res, 404, "Not found");
    sendBuffer(res, 200, data, "application/vnd.android.package-archive");
  });
}

async function saveApk({ listingId, originalName, data }) {
  const safeName = safeFileName(originalName || "game.apk");
  const localName = `${listingId}-${Date.now()}-${safeName}`;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, localName), data);
  return {
    storage: "local",
    key: localName,
    url: `/uploads/${localName}`
  };
}

async function removeStoredApk(listing) {
  if (!listing || !listing.apkUrl) return;

  const fileName = path.basename(listing.apkKey || listing.apkUrl);
  const filePath = path.join(UPLOAD_DIR, fileName);
  if (!filePath.startsWith(UPLOAD_DIR)) return;
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function sendJson(res, status, payload) {
  sendBuffer(res, status, Buffer.from(JSON.stringify(payload)), "application/json; charset=utf-8");
}

function sendText(res, status, text) {
  sendBuffer(res, status, Buffer.from(text), "text/plain; charset=utf-8");
}

function sendBuffer(res, status, data, contentType) {
  const cacheControl = contentType.startsWith("text/html") || contentType.startsWith("application/json")
    ? "no-store"
    : "public, max-age=3600";

  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": data.length,
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "same-origin"
  });
  res.end(data);
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function cleanHandle(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);
}

function safeFileName(value) {
  const ext = path.extname(value).toLowerCase() || ".apk";
  const base = path.basename(value, ext)
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "game";
  return `${base}${ext === ".apk" ? ext : ".apk"}`;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pickColor(text, offset) {
  const palettes = [
    ["#2563eb", "#22c55e"],
    ["#dc2626", "#f59e0b"],
    ["#0891b2", "#a855f7"],
    ["#16a34a", "#f97316"],
    ["#be123c", "#0ea5e9"],
    ["#4f46e5", "#14b8a6"]
  ];
  const index = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0) % palettes.length;
  return palettes[index][offset];
}
