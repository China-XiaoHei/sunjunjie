import * as THREE from "three";
import { OrbitControls } from "/vendor/OrbitControls.js";

window.__A1_APP_READY__ = true;

const sceneRoot = document.querySelector("#scene-root");
const positionValue = document.querySelector("#position-value");
const speedValue = document.querySelector("#speed-value");
const waypointValue = document.querySelector("#waypoint-value");
const motionValue = document.querySelector("#motion-value");
const commandValue = document.querySelector("#command-value");
const connectionDot = document.querySelector("#connection-dot");
const connectionLabel = document.querySelector("#connection-label");
const pathList = document.querySelector("#path-list");
const eventLog = document.querySelector("#event-log");
const pathCount = document.querySelector("#path-count");
const speedInput = document.querySelector("#speed-input");
const nextButton = document.querySelector("#next-button");
const routeButton = document.querySelector("#route-button");
const resetButton = document.querySelector("#reset-button");
const stopButton = document.querySelector("#stop-button");
const clearLogButton = document.querySelector("#clear-log-button");

const scene = new THREE.Scene();
scene.background = new THREE.Color("#0b1111");
scene.fog = new THREE.Fog("#0b1111", 2.5, 6.5);

const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 20);
camera.position.set(1.55, 1.35, 1.95);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
sceneRoot.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0.28, 0.16, 0.23);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.8;
controls.maxDistance = 4.5;

scene.add(new THREE.HemisphereLight("#d9fff7", "#1a2424", 1.8));
const keyLight = new THREE.DirectionalLight("#fff4dc", 3.6);
keyLight.position.set(1.4, 2.8, 1.8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(1024, 1024);
scene.add(keyLight);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2.5, 2.5),
  new THREE.MeshStandardMaterial({
    color: "#121d1c",
    roughness: 0.86,
    metalness: 0.08,
  }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.set(0.3, -0.015, 0.25);
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(2.2, 22, "#2d7770", "#203a38");
grid.position.set(0.3, 0.002, 0.25);
grid.material.transparent = true;
grid.material.opacity = 0.35;
scene.add(grid);

const axes = new THREE.AxesHelper(0.42);
axes.position.set(-0.18, 0.008, -0.18);
scene.add(axes);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(0.095, 0.095, 0.095),
  new THREE.MeshStandardMaterial({
    color: "#ff765f",
    roughness: 0.35,
    metalness: 0.2,
    emissive: "#38130e",
    emissiveIntensity: 0.7,
  }),
);
cube.castShadow = true;
cube.receiveShadow = true;
scene.add(cube);

const cubeHalo = new THREE.Mesh(
  new THREE.SphereGeometry(0.11, 24, 16),
  new THREE.MeshBasicMaterial({
    color: "#ff765f",
    transparent: true,
    opacity: 0.08,
    depthWrite: false,
  }),
);
scene.add(cubeHalo);

const targetMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.045, 24, 16),
  new THREE.MeshBasicMaterial({
    color: "#ffb454",
    transparent: true,
    opacity: 0.95,
  }),
);
targetMarker.visible = false;
scene.add(targetMarker);

const targetRing = new THREE.Mesh(
  new THREE.RingGeometry(0.075, 0.09, 32),
  new THREE.MeshBasicMaterial({
    color: "#ffb454",
    transparent: true,
    opacity: 0.8,
    side: THREE.DoubleSide,
  }),
);
targetRing.rotation.x = -Math.PI / 2;
targetRing.visible = false;
scene.add(targetRing);

const pathMaterial = new THREE.LineBasicMaterial({
  color: "#42d6bd",
  transparent: true,
  opacity: 0.8,
});
const pathLine = new THREE.Line(new THREE.BufferGeometry(), pathMaterial);
scene.add(pathLine);

const trailMaterial = new THREE.LineBasicMaterial({
  color: "#ff765f",
  transparent: true,
  opacity: 0.5,
});
const trailLine = new THREE.Line(new THREE.BufferGeometry(), trailMaterial);
scene.add(trailLine);

let pathDefinition = null;
let latestState = null;
let trailPoints = [];
let routeRunning = false;
let routeToken = 0;
let lastStateTimestamp = 0;
let pollingMode = false;
let pollingTimer = null;
let pollingInFlight = false;

function formatNumber(value, digits = 3) {
  return Number(value).toFixed(digits);
}

function positionText(position) {
  return `${formatNumber(position.x)}, ${formatNumber(position.y)}, ${formatNumber(position.z)}`;
}

function logEvent(message, color = "teal") {
  const entry = document.createElement("div");
  entry.className = "event-entry";
  entry.dataset.color = color;
  entry.textContent = `${new Date().toLocaleTimeString()}  ${message}`;
  eventLog.prepend(entry);
  while (eventLog.children.length > 7) {
    eventLog.lastElementChild.remove();
  }
}

function setConnection(connected, label) {
  connectionDot.classList.toggle("connected", connected);
  connectionDot.classList.toggle("error", !connected && label === "已断开");
  connectionLabel.textContent = label;
}

function resize() {
  const width = sceneRoot.clientWidth;
  const height = sceneRoot.clientHeight;
  if (width <= 0 || height <= 0) {
    return;
  }
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

function setPosition(position) {
  const vector = new THREE.Vector3(position.x, position.y, position.z);
  cube.position.copy(vector);
  cubeHalo.position.copy(vector);
}

function setTarget(target) {
  if (!target) {
    targetMarker.visible = false;
    targetRing.visible = false;
    return;
  }
  const vector = new THREE.Vector3(target.x, target.y, target.z);
  targetMarker.position.copy(vector);
  targetRing.position.copy(vector);
  targetMarker.visible = true;
  targetRing.visible = true;
}

function renderPath() {
  if (!pathDefinition) {
    return;
  }
  const points = pathDefinition.points.map(
    (point) => new THREE.Vector3(point.x, point.y, point.z),
  );
  pathLine.geometry.dispose();
  pathLine.geometry = new THREE.BufferGeometry().setFromPoints(points);

  pathList.replaceChildren();
  pathCount.textContent = `${pathDefinition.points.length} 个点`;
  for (const point of pathDefinition.points) {
    const item = document.createElement("li");
    item.className = "path-item";
    item.dataset.index = String(point.index);
    item.innerHTML = `
      <span class="path-index">${point.name}</span>
      <span class="path-coordinates">${positionText(point)}</span>
      <span class="path-state"></span>
    `;
    pathList.appendChild(item);
  }
}

function updatePathList(state) {
  for (const item of pathList.querySelectorAll(".path-item")) {
    const index = Number(item.dataset.index);
    item.classList.toggle("current", index === state.currentPathIndex);
    item.classList.toggle("target", index === state.targetPathIndex);
    const label = item.querySelector(".path-state");
    if (index === state.targetPathIndex && state.moving) {
      label.textContent = "目标";
    } else if (index === state.currentPathIndex) {
      label.textContent = "当前位置";
    } else {
      label.textContent = "";
    }
  }
}

function appendTrail(position) {
  const point = new THREE.Vector3(position.x, position.y, position.z);
  const lastPoint = trailPoints[trailPoints.length - 1];
  if (!lastPoint || lastPoint.distanceTo(point) > 0.006) {
    trailPoints.push(point);
    if (trailPoints.length > 360) {
      trailPoints.shift();
    }
    trailLine.geometry.dispose();
    trailLine.geometry = new THREE.BufferGeometry().setFromPoints(trailPoints);
  }
}

function applyState(state, announce = false) {
  latestState = state;
  setPosition(state.position);
  setTarget(state.target);
  appendTrail(state.position);
  positionValue.textContent = positionText(state.position);
  speedValue.textContent = formatNumber(state.speed);
  waypointValue.textContent = `P${state.currentPathIndex}`;
  motionValue.textContent = state.moving ? "运动中" : "静止";
  commandValue.textContent = state.commandId || "无指令";
  updatePathList(state);

  if (announce && state.lastCompletedCommandId) {
    logEvent(`已完成 ${state.lastCompletedCommandId}`);
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

async function sendCommand(pathIndex, commandId = `ui-${Date.now()}`) {
  const speed = Number(speedInput.value);
  if (!Number.isFinite(speed) || speed <= 0 || speed > 5) {
    logEvent("速度必须大于 0 且不超过 5 米/秒。", "error");
    return false;
  }
  try {
    const result = await fetchJson("/api/control", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "move",
        pathIndex,
        speed,
        commandId,
      }),
    });
    applyState(result.state);
    logEvent(`已发送 ${commandId} -> P${pathIndex}`);
    return true;
  } catch (error) {
    logEvent(`指令失败：${error.message}`, "error");
    return false;
  }
}

async function resetSimulation() {
  routeRunning = false;
  routeToken += 1;
  try {
    const result = await fetchJson("/api/reset", { method: "POST" });
    trailPoints = [];
    trailLine.geometry.dispose();
    trailLine.geometry = new THREE.BufferGeometry();
    applyState(result.state);
    logEvent("仿真已重置。");
  } catch (error) {
    logEvent(`重置失败：${error.message}`, "error");
  }
}

async function waitForWaypoint(pathIndex, token) {
  while (routeRunning && token === routeToken) {
    if (latestState && !latestState.moving && latestState.currentPathIndex === pathIndex) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return false;
}

async function runFullRoute() {
  if (!pathDefinition || routeRunning) {
    return;
  }
  routeRunning = true;
  const token = ++routeToken;
  logEvent("完整路径开始运行。");
  for (const point of pathDefinition.points.slice(1)) {
    if (!routeRunning || token !== routeToken) {
      break;
    }
    const accepted = await sendCommand(point.index, `ui-route-p${point.index}`);
    if (!accepted) {
      break;
    }
    await waitForWaypoint(point.index, token);
  }
  if (token === routeToken) {
    routeRunning = false;
    logEvent("完整路径运行完成。");
  }
}

function stopAtTarget() {
  routeRunning = false;
  routeToken += 1;
  logEvent("已停止后续路线指令，当前目标仍会继续执行。");
}

async function pollState() {
  if (!pollingMode || pollingInFlight) {
    return;
  }
  pollingInFlight = true;
  try {
    const payload = await fetchJson("/api/state");
    if (payload.type === "state") {
      const state = payload.state;
      const changedCommand = state.lastCompletedCommandId &&
        state.lastCompletedCommandId !== latestState?.lastCompletedCommandId;
      applyState(state, changedCommand);
    }
    setConnection(true, "已连接");
  } catch (error) {
    setConnection(false, "已断开");
  } finally {
    pollingInFlight = false;
    if (pollingMode) {
      pollingTimer = window.setTimeout(() => {
        pollingTimer = null;
        pollState();
      }, 250);
    }
  }
}

function startPolling(reason) {
  if (!pollingMode) {
    pollingMode = true;
    logEvent(reason);
  }
  if (!pollingTimer && !pollingInFlight) {
    pollState();
  }
}

function connectWebSocket() {
  if (pollingMode) {
    return;
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  let socket;
  try {
    socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  } catch (error) {
    startPolling("WebSocket 不可用，已切换 HTTP 状态轮询。");
    return;
  }
  const fallbackTimer = window.setTimeout(() => {
    if (socket.readyState === WebSocket.CONNECTING) {
      pollingMode = true;
      socket.close();
      startPolling("WebSocket 连接超时，已切换 HTTP 状态轮询。");
    }
  }, 3000);
  socket.addEventListener("open", () => {
    window.clearTimeout(fallbackTimer);
    setConnection(true, "已连接");
    logEvent("WebSocket 已连接。");
  });
  socket.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.type === "state") {
        const state = payload.state;
        const changedCommand = state.lastCompletedCommandId &&
          state.lastCompletedCommandId !== latestState?.lastCompletedCommandId;
        applyState(state, changedCommand);
      }
    } catch (error) {
      logEvent(`状态消息解析失败：${error.message}`, "error");
    }
  });
  socket.addEventListener("close", () => {
    window.clearTimeout(fallbackTimer);
    if (pollingMode) {
      return;
    }
    setConnection(false, "已断开");
    window.setTimeout(connectWebSocket, 1200);
  });
  socket.addEventListener("error", () => {
    if (!pollingMode) {
      setConnection(false, "已断开");
    }
  });
}

async function initialize() {
  try {
    const payload = await fetchJson("/api/state");
    pathDefinition = payload.path;
    renderPath();
    applyState(payload.state);
    lastStateTimestamp = Date.now();
    setConnection(false, "连接中");
    connectWebSocket();
  } catch (error) {
    setConnection(false, "已断开");
    logEvent(`页面初始化失败：${error.message}`, "error");
  }
}

nextButton.addEventListener("click", () => {
  const nextIndex = (latestState?.currentPathIndex ?? 0) + 1;
  if (!pathDefinition || nextIndex >= pathDefinition.points.length) {
    logEvent("当前已经是最后一个路径点。");
    return;
  }
  sendCommand(nextIndex);
});
routeButton.addEventListener("click", runFullRoute);
resetButton.addEventListener("click", resetSimulation);
stopButton.addEventListener("click", stopAtTarget);
clearLogButton.addEventListener("click", () => eventLog.replaceChildren());

window.addEventListener("resize", resize);
resize();
initialize();

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  cube.rotation.x += latestState?.moving ? 0.006 : 0.001;
  cube.rotation.y += latestState?.moving ? 0.009 : 0.0015;
  targetRing.rotation.z += 0.01;
  renderer.render(scene, camera);
}

animate();
