#!/usr/bin/env node

const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const ROOT = __dirname;
const PUBLIC_ROOT = path.join(ROOT, "public");
const THREE_ROOT = path.join(ROOT, "node_modules", "three");
const PATH_FILE = path.join(ROOT, "path.json");
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SPEED = 5.0;
const TICK_MS = 16;
const BROADCAST_MS = 50;

const pathDefinition = JSON.parse(fs.readFileSync(PATH_FILE, "utf8"));
const pathPoints = pathDefinition.points.map((point) => ({
  index: Number(point.index),
  name: String(point.name),
  x: Number(point.x),
  y: Number(point.y),
  z: Number(point.z),
}));

if (pathPoints.length < 2) {
  throw new Error("path.json must define at least two points.");
}

const initialPoint = pathPoints[0];
const state = {
  position: pointToObject(initialPoint),
  target: null,
  speed: 0,
  moving: false,
  commandId: null,
  lastCompletedCommandId: null,
  currentPathIndex: 0,
  targetPathIndex: null,
  lastUpdate: Date.now(),
  lastBroadcast: 0,
};

const websocketClients = new Set();
const port = readNumberArgument("--port", Number(process.env.PORT || 8080));
const host = readStringArgument("--host", process.env.HOST || "0.0.0.0");

function pointToObject(point) {
  return { x: point.x, y: point.y, z: point.z };
}

function readNumberArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) {
    return fallback;
  }
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

function readStringArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0 || index + 1 >= process.argv.length) {
    return fallback;
  }
  return process.argv[index + 1];
}

function jsonResponse(response, statusCode, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  response.end(body);
}

function textResponse(response, statusCode, body, contentType = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": contentType,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

async function readFileWithExplicitOffsets(filePath) {
  const file = await fs.promises.open(filePath, "r");
  try {
    const stats = await file.stat();
    const body = Buffer.allocUnsafe(stats.size);
    let offset = 0;

    while (offset < body.length) {
      const length = Math.min(64 * 1024, body.length - offset);
      const { bytesRead } = await file.read(body, offset, length, offset);
      if (bytesRead === 0) {
        throw new Error(`Unexpected end of file while reading ${filePath}.`);
      }
      offset += bytesRead;
    }
    return body;
  } finally {
    await file.close();
  }
}

function sendFile(response, filePath, cacheControl) {
  // Explicit offsets avoid repeated 512 KiB blocks seen with Node 18 on some WSL DrvFS mounts.
  readFileWithExplicitOffsets(filePath)
    .then((body) => {
      response.writeHead(200, {
        "Content-Type": contentType(filePath),
        "Content-Length": body.length,
        "Cache-Control": cacheControl,
      });
      response.end(body);
    })
    .catch(() => {
      textResponse(response, 404, "Not found.");
    });
}

function publicCacheControl(requestPath) {
  const extension = path.extname(requestPath).toLowerCase();
  if (requestPath === "/" || extension === ".js" || extension === ".css") {
    return "no-store";
  }
  return "public, max-age=300";
}

function getPublicFilePath(requestPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    return null;
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const filePath = path.resolve(PUBLIC_ROOT, relativePath);
  const publicRootWithSeparator = `${path.resolve(PUBLIC_ROOT)}${path.sep}`;
  if (filePath !== path.resolve(PUBLIC_ROOT) && !filePath.startsWith(publicRootWithSeparator)) {
    return null;
  }
  return filePath;
}

function contentType(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  const types = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
  };
  return types[extension] || "application/octet-stream";
}

function getVendorFilePath(requestPath) {
  const vendorFiles = {
    "/vendor/three.module.js": path.join(THREE_ROOT, "build", "three.module.js"),
    "/vendor/OrbitControls.js": path.join(
      THREE_ROOT,
      "examples",
      "jsm",
      "controls",
      "OrbitControls.js",
    ),
  };
  return vendorFiles[requestPath] || null;
}

function publicState() {
  return {
    position: { ...state.position },
    target: state.target ? { ...state.target } : null,
    speed: state.speed,
    moving: state.moving,
    commandId: state.commandId,
    lastCompletedCommandId: state.lastCompletedCommandId,
    currentPathIndex: state.currentPathIndex,
    targetPathIndex: state.targetPathIndex,
    timestamp: new Date().toISOString(),
  };
}

function responsePayload() {
  return {
    type: "state",
    state: publicState(),
    path: pathDefinition,
  };
}

function websocketFrame(text) {
  const payload = Buffer.from(text, "utf8");
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function sendWebSocketPayload(socket, payload) {
  if (!socket.destroyed) {
    socket.write(websocketFrame(JSON.stringify(payload)));
  }
}

function broadcastState(force = false) {
  const now = Date.now();
  if (!force && now - state.lastBroadcast < BROADCAST_MS) {
    return;
  }
  state.lastBroadcast = now;
  const payload = responsePayload();
  for (const socket of websocketClients) {
    try {
      sendWebSocketPayload(socket, payload);
    } catch {
      websocketClients.delete(socket);
      socket.destroy();
    }
  }
}

function parseBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let size = 0;
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      size += Buffer.byteLength(chunk, "utf8");
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      body += chunk;
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function numberField(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`${name} must be a finite number.`);
  }
  return number;
}

function targetFromBody(body) {
  if (!body.target || typeof body.target !== "object") {
    throw new Error("target must be an object.");
  }
  return {
    x: numberField(body.target.x, "target.x"),
    y: numberField(body.target.y, "target.y"),
    z: numberField(body.target.z, "target.z"),
  };
}

function pointsMatch(left, right) {
  return (
    Math.abs(left.x - right.x) < 1e-9
    && Math.abs(left.y - right.y) < 1e-9
    && Math.abs(left.z - right.z) < 1e-9
  );
}

function commandFromBody(body) {
  const speed = numberField(body.speed, "speed");
  if (speed <= 0 || speed > MAX_SPEED) {
    throw new Error(`speed must be greater than 0 and no more than ${MAX_SPEED}.`);
  }

  let target;
  let targetPathIndex = null;
  if (body.pathIndex !== undefined && body.pathIndex !== null) {
    const pathIndex = Number(body.pathIndex);
    if (!Number.isInteger(pathIndex) || pathIndex < 0 || pathIndex >= pathPoints.length) {
      throw new Error("pathIndex does not identify a path point.");
    }
    const pathPoint = pathPoints[pathIndex];
    target = body.target ? targetFromBody(body) : pointToObject(pathPoint);
    if (!pointsMatch(target, pathPoint)) {
      throw new Error("target does not match the coordinates of pathIndex.");
    }
    targetPathIndex = pathIndex;
  } else {
    target = targetFromBody(body);
  }

  return {
    target,
    speed,
    targetPathIndex,
    commandId: body.commandId ? String(body.commandId) : `http-${Date.now()}`,
  };
}

function applyCommand(command) {
  state.target = command.target;
  state.speed = command.speed;
  state.commandId = command.commandId;
  state.targetPathIndex = command.targetPathIndex;
  state.moving = true;
  state.lastUpdate = Date.now();
  broadcastState(true);
}

function resetState() {
  state.position = pointToObject(initialPoint);
  state.target = null;
  state.speed = 0;
  state.moving = false;
  state.commandId = null;
  state.lastCompletedCommandId = null;
  state.currentPathIndex = 0;
  state.targetPathIndex = null;
  state.lastUpdate = Date.now();
  broadcastState(true);
}

function updateSimulation() {
  const now = Date.now();
  const deltaSeconds = Math.min((now - state.lastUpdate) / 1000, 0.1);
  state.lastUpdate = now;

  if (state.moving && state.target) {
    const dx = state.target.x - state.position.x;
    const dy = state.target.y - state.position.y;
    const dz = state.target.z - state.position.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const step = state.speed * deltaSeconds;

    if (distance <= step || distance < 1e-9) {
      state.position = { ...state.target };
      state.moving = false;
      state.speed = 0;
      state.lastCompletedCommandId = state.commandId;
      if (state.targetPathIndex !== null) {
        state.currentPathIndex = state.targetPathIndex;
      }
      broadcastState(true);
    } else {
      state.position.x += (dx / distance) * step;
      state.position.y += (dy / distance) * step;
      state.position.z += (dz / distance) * step;
      broadcastState();
    }
  }
}

function handleHttp(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  const pathname = requestUrl.pathname;

  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    });
    response.end();
    return;
  }

  if (request.method === "GET" && pathname === "/api/health") {
    jsonResponse(response, 200, {
      ok: true,
      service: "robot-threejs-external-control",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (request.method === "GET" && pathname === "/api/path") {
    jsonResponse(response, 200, pathDefinition);
    return;
  }

  if (request.method === "GET" && pathname === "/api/state") {
    jsonResponse(response, 200, responsePayload());
    return;
  }

  if (request.method === "POST" && pathname === "/api/control") {
    parseBody(request)
      .then((body) => {
        const command = commandFromBody(body);
        applyCommand(command);
        jsonResponse(response, 202, {
          accepted: true,
          command,
          state: publicState(),
        });
      })
      .catch((error) => {
        jsonResponse(response, 400, { accepted: false, error: error.message });
      });
    return;
  }

  if (request.method === "POST" && pathname === "/api/reset") {
    resetState();
    jsonResponse(response, 200, { reset: true, state: publicState() });
    return;
  }

  if (request.method !== "GET") {
    jsonResponse(response, 405, { error: "Method not allowed." });
    return;
  }

  const vendorFilePath = getVendorFilePath(pathname);
  if (vendorFilePath) {
    fs.stat(vendorFilePath, (error, stats) => {
      if (error || !stats.isFile()) {
        textResponse(response, 404, "Three.js dependency is not installed. Run npm install.");
        return;
      }
      sendFile(response, vendorFilePath, "no-store");
    });
    return;
  }

  const filePath = getPublicFilePath(pathname);
  if (!filePath) {
    textResponse(response, 403, "Forbidden.");
    return;
  }
  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      textResponse(response, 404, "Not found.");
      return;
    }
    sendFile(
      response,
      filePath,
      publicCacheControl(pathname),
    );
  });
}

function handleWebSocketUpgrade(request, socket) {
  const requestUrl = new URL(request.url, `http://${request.headers.host || "localhost"}`);
  if (requestUrl.pathname !== "/ws" || !request.headers["sec-websocket-key"]) {
    socket.destroy();
    return;
  }

  const acceptKey = crypto
    .createHash("sha1")
    .update(`${request.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey}`,
      "\r\n",
    ].join("\r\n"),
  );
  socket.setNoDelay(true);
  websocketClients.add(socket);
  socket.on("data", (data) => {
    // The browser does not need to send application frames. Handle close and ping.
    const opcode = data[0] & 0x0f;
    if (opcode === 0x8) {
      socket.end();
    } else if (opcode === 0x9) {
      socket.write(Buffer.from([0x8a, 0x00]));
    }
  });
  socket.on("close", () => websocketClients.delete(socket));
  socket.on("error", () => websocketClients.delete(socket));
  sendWebSocketPayload(socket, responsePayload());
}

const server = http.createServer(handleHttp);
server.on("upgrade", handleWebSocketUpgrade);
server.listen(port, host, () => {
  console.log(`A1 server listening on http://${host}:${port}`);
  console.log(`WebSocket endpoint: ws://${host}:${port}/ws`);
  console.log(`Path points: ${pathPoints.map((point) => point.name).join(" -> ")}`);
});

setInterval(updateSimulation, TICK_MS);

function shutdown(signal) {
  console.log(`\nReceived ${signal}, stopping server.`);
  for (const socket of websocketClients) {
    socket.destroy();
  }
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
