const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const UPLOAD_DIR = path.join(ROOT, "uploads");
const LISTINGS_FILE = path.join(DATA_DIR, "listings.json");
const MAX_UPLOAD_BYTES = 350 * 1024 * 1024;

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

const featuredListings = [
  {
    id: "starfall-arena",
    title: "Starfall Arena",
    studio: "Nova Relay",
    genre: "Action",
    price: "Free",
    rating: "4.8",
    size: "812 MB",
    comfort: "Moderate",
    colorA: "#7c3aed",
    colorB: "#06b6d4",
    summary: "Zero-gravity duels across orbital ruins with fast matchmaking."
  },
  {
    id: "iron-trails",
    title: "Iron Trails",
    studio: "Anvil Room",
    genre: "Adventure",
    price: "$14.99",
    rating: "4.6",
    size: "1.4 GB",
    comfort: "Comfortable",
    colorA: "#ea580c",
    colorB: "#84cc16",
    summary: "Explore abandoned rail cities and rebuild machines by hand."
  },
  {
    id: "pulse-lab",
    title: "Pulse Lab",
    studio: "Beat Foundry",
    genre: "Music",
    price: "$9.99",
    rating: "4.9",
    size: "524 MB",
    comfort: "Intense",
    colorA: "#db2777",
    colorB: "#facc15",
    summary: "A kinetic rhythm sandbox with custom beat chambers."
  },
  {
    id: "quiet-orbit",
    title: "Quiet Orbit",
    studio: "Soft Horizon",
    genre: "Puzzle",
    price: "$7.99",
    rating: "4.7",
    size: "388 MB",
    comfort: "Comfortable",
    colorA: "#0f766e",
    colorB: "#38bdf8",
    summary: "A calm orbital logic puzzler built for seated VR play."
  }
];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/games") {
      return sendJson(res, 200, {
        featured: featuredListings,
        published: readListings()
      });
    }

    if (req.method === "POST" && url.pathname === "/api/publish") {
      return handlePublish(req, res);
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
    sendJson(res, 500, { error: "Something went wrong on the server." });
  }
});

server.listen(PORT, () => {
  console.log(`Blooded Quest Store running at http://localhost:${PORT}`);
});

function ensureStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(LISTINGS_FILE)) {
    fs.writeFileSync(LISTINGS_FILE, "[]\n");
  }
}

function readListings() {
  try {
    return JSON.parse(fs.readFileSync(LISTINGS_FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeListings(listings) {
  fs.writeFileSync(LISTINGS_FILE, `${JSON.stringify(listings, null, 2)}\n`);
}

async function handlePublish(req, res) {
  const contentType = req.headers["content-type"] || "";
  if (!contentType.includes("multipart/form-data")) {
    return sendJson(res, 400, { error: "Publish requests must use multipart/form-data." });
  }

  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    return sendJson(res, 400, { error: "Missing upload boundary." });
  }

  const body = await readRequestBody(req, MAX_UPLOAD_BYTES);
  const { fields, files } = parseMultipart(body, boundaryMatch[1] || boundaryMatch[2]);
  const apk = files.apk;

  if (!apk || !apk.filename) {
    return sendJson(res, 400, { error: "An APK file is required." });
  }

  if (path.extname(apk.filename).toLowerCase() !== ".apk") {
    return sendJson(res, 400, { error: "Only .apk files can be published." });
  }

  const title = cleanText(fields.title, 80);
  const studio = cleanText(fields.studio, 80);
  const genre = cleanText(fields.genre, 40);
  const summary = cleanText(fields.summary, 220);
  const comfort = cleanText(fields.comfort, 40) || "Comfortable";
  const price = cleanText(fields.price, 20) || "Free";

  if (!title || !studio || !genre || !summary) {
    return sendJson(res, 400, { error: "Title, studio, genre, and summary are required." });
  }

  const id = crypto.randomUUID();
  const storedName = `${id}.apk`;
  fs.writeFileSync(path.join(UPLOAD_DIR, storedName), apk.data);

  const listing = {
    id,
    title,
    studio,
    genre,
    summary,
    comfort,
    price,
    rating: "New",
    size: formatBytes(apk.data.length),
    apkName: path.basename(apk.filename),
    apkUrl: `/uploads/${storedName}`,
    publishedAt: new Date().toISOString(),
    colorA: pickColor(title, 0),
    colorB: pickColor(title, 1)
  };

  const listings = readListings();
  listings.unshift(listing);
  writeListings(listings);

  sendJson(res, 201, { listing });
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
        if (name && filename !== null) {
          files[name] = { filename, data };
        } else if (name) {
          fields[name] = data.toString("utf8").trim();
        }
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

function servePublic(urlPath, res) {
  const requestPath = urlPath === "/" ? "/index.html" : urlPath;
  const safePath = path.normalize(decodeURIComponent(requestPath)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, "Forbidden");
  }

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

function sendJson(res, status, payload) {
  sendBuffer(res, status, Buffer.from(JSON.stringify(payload)), "application/json; charset=utf-8");
}

function sendText(res, status, text) {
  sendBuffer(res, status, Buffer.from(text), "text/plain; charset=utf-8");
}

function sendBuffer(res, status, data, contentType) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Content-Length": data.length,
    "X-Content-Type-Options": "nosniff"
  });
  res.end(data);
}

function cleanText(value, maxLength) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
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
