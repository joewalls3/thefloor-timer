const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");

const state = {
  teamAName: "TEAM A",
  teamBName: "TEAM B",
  initialMs: 5 * 60 * 1000,
  remainingA: 5 * 60 * 1000,
  remainingB: 5 * 60 * 1000,
  activeTeam: null,
  running: false,
  expiredTeam: null,
  updatedAt: Date.now()
};

const clients = new Set();

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function normalizeState() {
  if (!state.running || !state.activeTeam) return;

  const now = Date.now();
  const elapsed = now - state.updatedAt;
  state.updatedAt = now;

  if (state.activeTeam === "A") {
    state.remainingA = Math.max(0, state.remainingA - elapsed);
    if (state.remainingA === 0) expire("A");
  } else {
    state.remainingB = Math.max(0, state.remainingB - elapsed);
    if (state.remainingB === 0) expire("B");
  }
}

function expire(team) {
  state.running = false;
  state.expiredTeam = team;
  state.activeTeam = team;
  state.updatedAt = Date.now();
}

function snapshot() {
  normalizeState();
  return { ...state, serverTime: Date.now() };
}

function broadcast() {
  const payload = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const client of clients) client.write(payload);
}

function switchFromPressedTeam(pressedTeam) {
  normalizeState();
  if (state.expiredTeam) return;

  const nextTeam = pressedTeam === "A" ? "B" : "A";

  if (!state.running) {
    state.activeTeam = nextTeam;
    state.running = true;
  } else if (state.activeTeam === pressedTeam) {
    state.activeTeam = nextTeam;
  }

  state.updatedAt = Date.now();
}

function resetTimer() {
  state.remainingA = state.initialMs;
  state.remainingB = state.initialMs;
  state.activeTeam = null;
  state.running = false;
  state.expiredTeam = null;
  state.updatedAt = Date.now();
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); }
      catch { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (error, data) => {
    if (error) return sendJson(res, 404, { error: "Not found" });
    res.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": data.length,
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

function getLocalAddresses() {
  const addresses = [];
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) addresses.push(entry.address);
    }
  }
  return addresses;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && url.pathname === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Access-Control-Allow-Origin": "*"
    });
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    sendJson(res, 200, snapshot());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/action") {
    try {
      const body = await parseBody(req);
      const action = body.action;
      normalizeState();

      if (action === "pressA") switchFromPressedTeam("A");
      else if (action === "pressB") switchFromPressedTeam("B");
      else if (action === "pause") state.running = false;
      else if (action === "start") {
        if (!state.expiredTeam) {
          if (!state.activeTeam) state.activeTeam = "A";
          state.running = true;
        }
      } else if (action === "toggle") {
        if (!state.expiredTeam) {
          if (!state.activeTeam) state.activeTeam = "A";
          state.running = !state.running;
        }
      } else if (action === "reset") resetTimer();
      else if (action === "adjustTime") {
        const team = body.team === "B" ? "B" : "A";
        const deltaMs = Math.trunc(Number(body.deltaMs) || 0);

        if (!Number.isFinite(deltaMs) || Math.abs(deltaMs) > 60 * 60 * 1000) {
          sendJson(res, 400, { error: "Invalid time adjustment" });
          return;
        }

        const key = team === "A" ? "remainingA" : "remainingB";
        state[key] = Math.max(0, state[key] + deltaMs);

        if (state[key] === 0) expire(team);
        else if (state.expiredTeam === team) {
          state.expiredTeam = null;
          state.running = false;
        }
      } else {
        sendJson(res, 400, { error: "Unknown action" });
        return;
      }

      state.updatedAt = Date.now();
      broadcast();
      sendJson(res, 200, snapshot());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings") {
    try {
      const body = await parseBody(req);
      const minutes = Math.max(0, Math.min(999, Number(body.minutes) || 0));
      const seconds = Math.max(0, Math.min(59, Number(body.seconds) || 0));
      const totalMs = (minutes * 60 + seconds) * 1000;

      if (totalMs <= 0) {
        sendJson(res, 400, { error: "Time must be greater than zero" });
        return;
      }

      state.teamAName = String(body.teamAName || "TEAM A").trim().slice(0, 30) || "TEAM A";
      state.teamBName = String(body.teamBName || "TEAM B").trim().slice(0, 30) || "TEAM B";
      state.initialMs = totalMs;
      resetTimer();
      broadcast();
      sendJson(res, 200, snapshot());
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
    return;
  }

  const routes = {
    "/": ["controller.html", "text/html; charset=utf-8"],
    "/controller": ["controller.html", "text/html; charset=utf-8"],
    "/team-a": ["team.html", "text/html; charset=utf-8"],
    "/team-b": ["team.html", "text/html; charset=utf-8"],
    "/styles.css": ["styles.css", "text/css; charset=utf-8"],
    "/shared.js": ["shared.js", "application/javascript; charset=utf-8"]
  };

  if (routes[url.pathname]) {
    const [fileName, contentType] = routes[url.pathname];
    serveFile(res, path.join(PUBLIC_DIR, fileName), contentType);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
});

setInterval(() => {
  const before = state.expiredTeam;
  normalizeState();
  if (state.expiredTeam !== before || state.running) broadcast();
}, 250);

server.listen(PORT, "0.0.0.0", () => {
  console.log("");
  console.log("Two-Team Network Timer is running.");
  console.log(`Controller: http://localhost:${PORT}`);
  console.log(`Team A:     http://localhost:${PORT}/team-a`);
  console.log(`Team B:     http://localhost:${PORT}/team-b`);
  for (const address of getLocalAddresses()) {
    console.log("");
    console.log("Other devices on your network can use:");
    console.log(`Controller: http://${address}:${PORT}`);
    console.log(`Team A:     http://${address}:${PORT}/team-a`);
    console.log(`Team B:     http://${address}:${PORT}/team-b`);
  }
  console.log("");
  console.log("Keep this window open while using the timer.");
});
