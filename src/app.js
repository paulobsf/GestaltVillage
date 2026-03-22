import { DEFAULT_PROMPT, MODEL_CONFIG } from "./config.js";
import { AGENT_COLORS, SPEED_MAP, browserHasWebGPU } from "./constants.js";
import { createContext, createElements, createWorkers } from "./dom.js";
import { createWorldRenderer } from "./render/world.js";
import { createAppState } from "./state.js";
import { createLogApi } from "./ui/log.js";
import { createPanelsApi } from "./ui/panels.js";
import { approximateTokens, clamp, pairKey, slugLabel } from "./utils.js";

const elements = createElements();
const ctx = createContext(elements);
const workers = createWorkers();
const appState = createAppState(MODEL_CONFIG);
const DEBUG_MODE = new URLSearchParams(window.location.search).get("debug") === "1"
  || window.localStorage.getItem("gestalt-village-debug") === "1";

function showCompatibilityIssue(message) {
  elements.compatibilityNote.textContent = message;
  elements.compatibilityNote.classList.remove("hidden");
}

function clearCompatibilityIssue() {
  elements.compatibilityNote.textContent = "";
  elements.compatibilityNote.classList.add("hidden");
}

function formatLoadProgressPercent(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function setLoadProgress(percent = null) {
  appState.loadProgressPercent = typeof percent === "number" && Number.isFinite(percent)
    ? clamp(percent, 0, 100)
    : null;

  const progress = appState.loadProgressPercent ?? 0;
  elements.progressBar.style.width = `${progress}%`;
  if (elements.progressMeterFill) {
    elements.progressMeterFill.style.width = `${progress}%`;
  }
  elements.progressMeter.textContent = appState.loadProgressPercent === null
    ? "Awaiting model load."
    : progress >= 100
      ? "Model ready. Opening the village workspace."
      : `Downloading model shards\u2026 ${formatLoadProgressPercent(progress)}%`;
}

function unlockApp() {
  if (appState.appUnlocked) {
    return;
  }

  appState.appUnlocked = true;
  elements.loadScreen.classList.add("hidden");
  elements.appScreen.classList.remove("hidden");
}

function syncControls() {
  const model = appState.models.reasoning;
  const modelReady = model.ready;
  const modelLoading = Boolean(appState.modelLoadPromise) && !modelReady && !model.error;

  elements.loadModelButton.disabled = !browserHasWebGPU || modelLoading || modelReady;
  const buttonState = model.error ? "error" : modelReady ? "ready" : modelLoading ? "loading" : "idle";
  elements.loadModelButton.dataset.state = buttonState;
  elements.loadModelLabel.textContent = modelReady
    ? "Model Ready"
    : modelLoading
      ? "Loading\u2026"
      : model.error
        ? "Retry Load"
        : "Load Model";

  elements.generateButton.disabled = !modelReady || modelLoading;
  elements.pauseButton.disabled = !appState.world;
  elements.playButton.disabled = !appState.world;
  elements.fastButton.disabled = !appState.world;
  elements.screenshotButton.disabled = !appState.world;
  elements.officeSendButton.disabled = !modelReady || !appState.selectedAgentId || appState.directChatInFlight;
}

function syncDebugVisibility() {
  elements.agentDebugPanel?.classList.toggle("hidden", !DEBUG_MODE);
  elements.telemetryDebugPanel?.classList.toggle("hidden", !DEBUG_MODE);
}

function setPromptExpanded(expanded) {
  appState.promptExpanded = expanded;
  const hasWorld = Boolean(appState.world);
  elements.promptPanel.classList.toggle("prompt-panel-collapsed", hasWorld && !expanded);
  elements.togglePromptButton.classList.toggle("hidden", !hasWorld);
  elements.scenarioSummary.classList.toggle("hidden", !hasWorld || expanded);

  if (hasWorld && !expanded) {
    const summary = elements.scenarioInput.value.trim();
    elements.scenarioSummary.textContent = summary.length > 220 ? `${summary.slice(0, 217)}...` : summary;
    elements.togglePromptButton.textContent = "Edit Setup";
  } else {
    elements.togglePromptButton.textContent = "Collapse";
  }
}

function prunePairCooldowns() {
  for (const [key, expiryTick] of appState.pairCooldowns.entries()) {
    if (expiryTick <= appState.tick) {
      appState.pairCooldowns.delete(key);
    }
  }
}

function isPairCoolingDown(leftId, rightId) {
  return (appState.pairCooldowns.get(pairKey(leftId, rightId)) || 0) > appState.tick;
}

function setPairCooldown(leftId, rightId, duration = 6) {
  appState.pairCooldowns.set(pairKey(leftId, rightId), appState.tick + duration);
}

function getAgent(id) {
  const value = String(id || "").trim();
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  return appState.agents.find((agent) => {
    const agentName = String(agent.name || "").trim().toLowerCase();
    return agent.id === value || agent.name === value || agentName === value.toLowerCase() || agent.id === normalized;
  });
}

function selectedAgent() {
  return getAgent(appState.selectedAgentId);
}

function assignRoomTargets({ snap = false } = {}) {
  const lockedParticipants = new Set(appState.activeConversation?.participants || []);

  appState.rooms.forEach((room) => {
    appState.agents
      .filter((agent) => agent.currentRoom === room.id && !lockedParticipants.has(agent.id))
      .sort((left, right) => left.id.localeCompare(right.id))
      .forEach((agent, index) => {
        const anchor = roomAnchor(room, index);
        agent.targetX = anchor.x;
        agent.targetY = anchor.y;

        if (snap) {
          agent.x = anchor.x;
          agent.y = anchor.y;
        }
      });
  });
}

function conversationParticipants(conversation) {
  return conversation.participants.map((id) => getAgent(id)).filter(Boolean);
}

const { syncLogMode, addLogEntry } = createLogApi({ appState, elements });

const {
  pushTelemetry,
  recordCounter,
  recordError,
  renderTelemetry,
  renderInspector
} = createPanelsApi({
  appState,
  elements,
  getAgent,
  selectedAgent,
  conversationParticipants,
  slugLabel,
  syncControls
});

const {
  roomCenter,
  syncCanvasResolution,
  roomAnchor,
  conversationAnchors,
  renderWorld,
  captureScreenshot,
  agentAtPosition
} = createWorldRenderer({
  appState,
  elements,
  ctx,
  selectedAgent,
  clamp
});

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  navigator.serviceWorker.register("./sw.js").catch(() => {
    elements.modelDetails.textContent = "Offline shell cache unavailable in this browser.";
  });
}

function instrumentNetwork() {
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (...args) => {
    appState.networkRequests += 1;
    renderStatus();
    return nativeFetch(...args);
  };
}

function createWorkerRequest(name, type, payload) {
  return new Promise((resolve, reject) => {
    const requestId = `${name}-${++appState.rpcSequence}`;
    appState.pending.set(requestId, {
      resolve,
      reject,
      startedAt: performance.now()
    });
    workers[name].postMessage({ type, requestId, payload });
  });
}

function settleWorkerRequest(message) {
  if (!message.requestId) {
    return false;
  }

  const pending = appState.pending.get(message.requestId);
  if (!pending) {
    return false;
  }

  appState.pending.delete(message.requestId);
  const latencyMs = Math.round(performance.now() - pending.startedAt);
  if (message.type === "workerError") {
    pending.reject(new Error(message.error || "Worker request failed."));
  } else {
    pending.resolve({ ...message, latencyMs });
  }
  return true;
}

function updateWorkerStatus(name, payload) {
  const status = appState.models[name];
  if (!status) {
    return;
  }

  const changed = status.stage !== (payload.stage || status.stage) || status.message !== (payload.message || status.message);

  status.stage = payload.stage || status.stage;
  status.message = payload.message || status.message;
  status.device = payload.device || status.device;

  if (payload.stage === "initiate") {
    appState.downloadProgress.clear();
    status.ready = false;
    status.error = false;
    setLoadProgress(0);
  }

  if (payload.file && typeof payload.loaded === "number" && typeof payload.total === "number" && payload.total > 0) {
    appState.downloadProgress.set(payload.file, { loaded: payload.loaded, total: payload.total });
    const totals = Array.from(appState.downloadProgress.values()).reduce((sum, entry) => ({
      loaded: sum.loaded + entry.loaded,
      total: sum.total + entry.total
    }), { loaded: 0, total: 0 });
    status.progress = totals.total > 0 ? clamp(Math.round((totals.loaded / totals.total) * 100), 0, 100) : status.progress;
  } else if (typeof payload.progress === "number") {
    status.progress = clamp(Math.round(payload.progress), 0, 100);
  }

  if (payload.stage === "ready") {
    status.ready = true;
    status.error = false;
    status.progress = 100;
    clearCompatibilityIssue();
    setLoadProgress(100);
  }

  if (payload.stage === "error") {
    status.ready = false;
    status.error = true;
    status.progress = 100;
    setLoadProgress(null);
  }

  if (payload.file) {
    const key = `${name}:${payload.file}`;
    if (!appState.countedDownloads.has(key)) {
      appState.countedDownloads.add(key);
      appState.networkRequests += 1;
    }
  }

  if (changed) {
    if (status.stage === "error") {
      pushTelemetry("error", `${status.label} error`, status.message);
    } else if (status.stage === "ready") {
      pushTelemetry("info", `${status.label} ready`, `${status.shortLabel} running on ${status.device}.`);
    }
  }

  if (!status.ready && !status.error) {
    setLoadProgress(status.progress);
  }

  renderModelStatus();
  renderStatus();
  syncControls();
}

function handleWorkerMessage(name, message) {
  if (message.type === "workerTrace") {
    if (!DEBUG_MODE) {
      return;
    }
    appState.telemetry.promptTraces.unshift({
      id: ++appState.telemetrySequence,
      tick: appState.tick,
      kind: message.payload?.kind || name,
      prompt: message.payload?.prompt || "",
      response: message.payload?.response || "",
      parsed: message.payload?.parsed || "",
      error: message.payload?.error || "",
      accepted: Boolean(message.payload?.accepted)
    });
    appState.telemetry.promptTraces = appState.telemetry.promptTraces.slice(0, 8);
    renderTelemetry();
    return;
  }

  if (message.type === "workerStatus") {
    updateWorkerStatus(name, message.payload || {});
    return;
  }

  settleWorkerRequest(message);
}

Object.entries(workers).forEach(([name, worker]) => {
  worker.addEventListener("message", (event) => handleWorkerMessage(name, event.data));
  worker.addEventListener("error", (event) => {
    recordError(`${name} worker error`, event);
    updateWorkerStatus(name, {
      stage: "error",
      message: event.message || `The ${name} worker failed.`
    });
  });
});

function renderModelStatus() {
  const state = appState.models.reasoning;
  elements.bootModelName.textContent = state.shortLabel || state.label || "Local model";
  elements.bootModelDevice.textContent = String(state.device || "webgpu").toUpperCase();
  elements.modelStatus.textContent = state.ready
    ? `${state.shortLabel} ready`
    : state.error
      ? `${state.shortLabel} error`
      : `${state.shortLabel} ${state.progress}%`;
  elements.modelDetails.textContent = state.error
    ? `${state.label}: error - ${state.message} (${state.approxSize})`
    : `${state.label}: ${state.model} from Hugging Face CDN - ${state.message} (${state.approxSize})`;

  if (state.ready) {
    elements.localStatus.textContent = "Running locally with CDN models";
  } else if (state.error) {
    elements.localStatus.textContent = "Local model error";
  } else {
    elements.localStatus.textContent = "Loading local models";
  }

  syncControls();
}

async function ensureModelLoaded() {
  if (appState.models.reasoning.ready) {
    return;
  }

  if (!browserHasWebGPU) {
    throw new Error("WebGPU is unavailable in this browser.");
  }

  if (!appState.modelLoadPromise) {
    clearCompatibilityIssue();
    appState.downloadProgress.clear();
    setLoadProgress(0);
    renderModelStatus();
    appState.modelLoadPromise = createWorkerRequest("reasoning", "warmup", {})
      .catch((error) => {
        showCompatibilityIssue(error.message || "Model loading failed.");
        throw error;
      })
      .finally(() => {
        appState.modelLoadPromise = null;
        syncControls();
      });
  }

  await appState.modelLoadPromise;
}

function createAgentFromDefinition(definition, index) {
  const room = appState.roomLookup[definition.starting_room];
  const start = roomCenter(room);
  return {
    ...definition,
    color: AGENT_COLORS[index % AGENT_COLORS.length],
    currentRoom: definition.starting_room,
    x: start.x,
    y: start.y,
    targetX: start.x,
    targetY: start.y,
    thought: `${definition.name} is orienting to the room.`,
    lastDecisionLatencyMs: null,
    lastAction: { type: "wait" },
    lastActionSummary: "waiting for first tick",
    speech: "",
    speechLatencyMs: null,
    speechUntil: 0,
    memories: [],
    conversationCooldown: 0
  };
}

function pushRecentEvent(text) {
  appState.recentEvents.unshift(text);
  appState.recentEvents = appState.recentEvents.slice(0, 8);
}

function setupWorld(result) {
  const { world } = result;
  appState.world = world;
  appState.tick = 0;
  appState.tokens = result.tokenEstimate || approximateTokens(elements.scenarioInput.value);
  appState.rooms = world.rooms;
  appState.roomLookup = Object.fromEntries(world.rooms.map((room) => [room.id, room]));
  appState.agents = world.agents.map((agent, index) => createAgentFromDefinition(agent, index));
  appState.selectedAgentId = null;
  appState.activeConversation = null;
  appState.tickInFlight = false;
  appState.lastTickAt = performance.now();
  appState.promptExpanded = false;
  appState.pairCooldowns.clear();
  appState.directChatInFlight = false;
  appState.recentEvents = [];
  appState.logMode = "latest";
  appState.telemetry.counts.world = 0;
  appState.telemetry.counts.reflection = 0;
  appState.telemetry.counts.conversation = 0;
  appState.telemetry.counts.memory = 0;
  appState.telemetry.counts.errors = 0;
  appState.telemetry.lastLatency.world = null;
  appState.telemetry.lastLatency.reflection = null;
  appState.telemetry.lastLatency.conversation = null;
  appState.telemetry.lastLatency.memory = null;
  appState.telemetry.repeatedConversationCount = 0;
  appState.telemetry.blockedConversationCount = 0;
  appState.telemetry.recentConversationSignatures = [];
  appState.telemetry.promptTraces = [];
  appState.telemetry.liveBubble = {
    speaker: "No active speech",
    text: "The full current speech line appears here."
  };
  appState.telemetry.events = [];
  assignRoomTargets({ snap: true });
  pushRecentEvent(`World generated: ${world.setting}`);
  elements.worldCaption.textContent = `${world.setting} - ${world.agents.length} agents across ${world.rooms.length} rooms.`;
  elements.conversationLog.innerHTML = "";
  recordCounter("world");
  appState.telemetry.lastLatency.world = result.latencyMs || null;
  pushTelemetry("info", "World generated", "World build used the prompt parser; sim behavior is deterministic and the model generates dialogue and office chat.");
  elements.officeInput.value = "";
  setPromptExpanded(false);
  renderInspector();
  renderTelemetry();
  renderStatus();
  syncControls();
  syncLogMode();
}

async function generateWorldFromPrompt() {
  const prompt = elements.scenarioInput.value.trim() || DEFAULT_PROMPT;
  await ensureModelLoaded();
  elements.scenarioInput.value = prompt;
  elements.generateButton.disabled = true;
  elements.generateButton.textContent = "Generating...";

  try {
    const response = await createWorkerRequest("reasoning", "generateWorld", { prompt });
    setupWorld({ ...response.payload, latencyMs: response.latencyMs });
  } catch (error) {
    recordError("World generation failed", error);
    elements.worldCaption.textContent = error.message;
    throw error;
  } finally {
    elements.generateButton.disabled = false;
    elements.generateButton.textContent = "Generate world";
  }
}

function renderStatus() {
  elements.tickCount.textContent = String(appState.tick);
  elements.tokenCount.textContent = String(appState.tokens);
  elements.networkStatus.textContent = `${appState.networkRequests} network requests`;
  const modelState = appState.models.reasoning;
  if (elements.modelChipName && modelState) {
    elements.modelChipName.textContent = modelState.shortLabel || modelState.label || "Local model";
    elements.modelChipDetail.textContent = modelState.approxSize || "";
  }
  if (elements.convoStatusText) {
    if (appState.activeConversation) {
      elements.convoStatusText.textContent = `${appState.activeConversation.turns.length} turns — ${appState.activeConversation.topic}`;
      elements.convoStatusCard.classList.add("live");
    } else {
      elements.convoStatusText.textContent = "Waiting for agents to meet";
      elements.convoStatusCard.classList.remove("live");
    }
  }
}

function updateRelationships(agent, deltaMap) {
  Object.entries(deltaMap).forEach(([otherId, delta]) => {
    if (!agent.relationships[otherId]) {
      agent.relationships[otherId] = { trust: 5, rapport: 5, notes: "New read forming." };
    }
    agent.relationships[otherId].trust = clamp(agent.relationships[otherId].trust + (delta.trust || 0), 1, 10);
    agent.relationships[otherId].rapport = clamp(agent.relationships[otherId].rapport + (delta.rapport || 0), 1, 10);
    agent.relationships[otherId].notes = delta.notes || agent.relationships[otherId].notes;
  });
}

function conversationSignature(turns) {
  return turns.map((turn) => `${turn.speakerName}:${turn.text}`).join(" | ");
}

function inferUtteranceSentiment(text) {
  return /risk|problem|tension|worry|hard|wrong|late|broken|promise|fragile|pressure/i.test(text)
    ? "tense"
    : "curious";
}

function relationshipShiftForUtterance(text, otherName) {
  const tense = inferUtteranceSentiment(text) === "tense";
  return {
    trust: tense ? -1 : 1,
    rapport: tense ? 0 : 1,
    notes: tense
      ? `The exchange with ${otherName} felt sharp but revealing.`
      : `The exchange with ${otherName} felt productive.`
  };
}

function rememberConversationTurn(turn) {
  const participants = appState.activeConversation ? conversationParticipants(appState.activeConversation) : [];
  const speaker = getAgent(turn.speakerId);
  const listener = participants.find((agent) => agent.id !== turn.speakerId);

  participants.forEach((agent) => {
    if (!listener || !speaker) {
      return;
    }

    const other = agent.id === speaker.id ? listener : speaker;
    const summary = agent.id === speaker.id
      ? `I told ${other.name}: "${turn.text}"`
      : `${other.name} told me: "${turn.text}"`;

    agent.memories.unshift({
      timestamp: appState.tick,
      type: "utterance",
      summary,
      sentiment: inferUtteranceSentiment(turn.text),
      importance: clamp(4 + Math.round(turn.text.length / 60), 4, 8),
      latencyMs: null,
      relationship_delta: {
        [other.id]: relationshipShiftForUtterance(turn.text, other.name)
      }
    });
    agent.memories = agent.memories.slice(0, 10);
    updateRelationships(agent, {
      [other.id]: relationshipShiftForUtterance(turn.text, other.name)
    });
  });

  pushRecentEvent(`${speaker?.name || "Someone"} said: ${turn.text}`);
  recordCounter("memory");
  appState.telemetry.lastLatency.memory = 0;
  renderInspector();
  renderTelemetry();
}

function conversationBounds(initiator, responder) {
  const tension = Math.min(
    initiator.relationships?.[responder.id]?.trust || 5,
    responder.relationships?.[initiator.id]?.trust || 5
  );

  return {
    minTurns: tension <= 3 ? 3 : 2,
    maxTurns: tension <= 3 ? 8 : tension <= 5 ? 6 : 5
  };
}

function conversationAgentPayload(agent) {
  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    goal: agent.goal,
    secret: agent.secret,
    personality: agent.personality,
    currentRoom: agent.currentRoom,
    relationships: agent.relationships,
    memories: agent.memories.slice(0, 6)
  };
}

function buildWorkerState() {
  prunePairCooldowns();
  return {
    tick: appState.tick,
    rooms: appState.rooms,
    roomLookup: appState.roomLookup,
    pairCooldowns: Object.fromEntries(appState.pairCooldowns),
    recentEvents: appState.recentEvents.slice(0, 4),
    agents: appState.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      goal: agent.goal,
      secret: agent.secret,
      personality: agent.personality,
      currentRoom: agent.currentRoom,
      relationships: agent.relationships,
      memories: agent.memories.slice(0, 6)
    }))
  };
}

async function reflectAgent(agent) {
  const response = await createWorkerRequest("reasoning", "reflect", {
    agent: conversationAgentPayload(agent),
    state: buildWorkerState()
  });

  appState.tokens += response.payload.tokenEstimate || 0;
  return {
    ...response.payload,
    latencyMs: response.latencyMs
  };
}

function describeAction(action) {
  if (!action || !action.type) {
    return "wait";
  }
  if (action.type === "move_to") {
    return `move to ${slugLabel(action.roomId)}`;
  }
  if (action.type === "talk_to") {
    return `talk to ${slugLabel(action.targetId)} about ${action.topic}`;
  }
  return action.type;
}

function nextRoomId(currentRoomId) {
  const roomIds = appState.rooms.map((room) => room.id);
  const currentIndex = roomIds.indexOf(currentRoomId);
  return roomIds[(currentIndex + 1) % roomIds.length];
}

async function rememberEvent(simulationEvent, affectedAgentIds) {
  try {
    for (const agentId of affectedAgentIds) {
      const agent = getAgent(agentId);
      if (!agent) continue;

      const response = await createWorkerRequest("reasoning", "compressMemory", {
        simulationEvent,
        perspectiveAgent: { id: agent.id, name: agent.name },
        roomName: appState.roomLookup[agent.currentRoom]?.name || "the room",
        tick: appState.tick,
        knownAgents: appState.agents.map(({ id, name }) => ({ id, name }))
      });

      const memory = {
        ...response.payload.memory,
        latencyMs: response.latencyMs
      };

      recordCounter("memory");
      appState.telemetry.lastLatency.memory = response.latencyMs;
      appState.tokens += response.payload.tokenEstimate || 0;
      agent.memories.unshift(memory);
      agent.memories = sortAndTrimMemories(agent.memories);
      updateRelationships(agent, memory.relationship_delta || {});
    }
  } catch (error) {
    recordError("Memory compression failed", error);
  } finally {
    renderTelemetry();
    renderInspector();
    renderStatus();
  }
}

const RECENCY_WEIGHT = 0.02;

function sortAndTrimMemories(memories) {
  return [...memories]
    .sort((left, right) => (right.importance + right.timestamp * RECENCY_WEIGHT) - (left.importance + left.timestamp * RECENCY_WEIGHT))
    .slice(0, 8);
}

async function moveAgent(agent, roomId) {
  const room = appState.roomLookup[roomId];
  agent.currentRoom = roomId;
  assignRoomTargets();
  pushRecentEvent(`${agent.name} moved to ${room.name}.`);
  await rememberEvent({ type: "movement", agentId: agent.id, roomId }, [agent.id]);
}

function applySpeech(agent, text, latencyMs) {
  agent.speech = text;
  agent.speechLatencyMs = typeof latencyMs === "number" ? latencyMs : agent.speechLatencyMs;
  agent.speechUntil = performance.now() + clamp(4200 + text.length * 30, 4200, 12000);
  appState.telemetry.liveBubble = {
    speaker: agent.name,
    text
  };
  renderTelemetry();
}

async function startConversation(initiator, responder, topic) {
  if (!responder || initiator.currentRoom !== responder.currentRoom) {
    return;
  }

  const [initiatorAnchor, responderAnchor] = conversationAnchors(appState.roomLookup[initiator.currentRoom]);
  initiator.x = initiatorAnchor.x;
  initiator.y = initiatorAnchor.y;
  initiator.targetX = initiatorAnchor.x;
  initiator.targetY = initiatorAnchor.y;
  responder.x = responderAnchor.x;
  responder.y = responderAnchor.y;
  responder.targetX = responderAnchor.x;
  responder.targetY = responderAnchor.y;

  const bounds = conversationBounds(initiator, responder);
  appState.activeConversation = {
    topic,
    roomId: initiator.currentRoom,
    participants: [initiator.id, responder.id],
    turns: [],
    nextSpeakerId: initiator.id,
    minTurns: bounds.minTurns,
    maxTurns: bounds.maxTurns,
    awaitingTurn: false,
    totalLatencyMs: 0,
    nextAdvanceAt: performance.now() + 180
  };

  pushTelemetry(
    "info",
    `${initiator.name} -> ${responder.name}`,
    `conversation started about ${topic} in ${slugLabel(initiator.currentRoom)}.`
  );
}

function finishConversation(reason = "ended") {
  const conversation = appState.activeConversation;
  if (!conversation) {
    return;
  }

  const [initiator, responder] = conversationParticipants(conversation);
  const turns = conversation.turns;

  if (initiator) {
    initiator.conversationCooldown = 3;
  }
  if (responder) {
    responder.conversationCooldown = 3;
  }

  if (turns.length > 0 && initiator && responder) {
    const signature = conversationSignature(turns);
    const repeated = appState.telemetry.recentConversationSignatures.includes(signature);
    if (repeated) {
      appState.telemetry.repeatedConversationCount += 1;
    }
    appState.telemetry.recentConversationSignatures.unshift(signature);
    appState.telemetry.recentConversationSignatures = appState.telemetry.recentConversationSignatures.slice(0, 12);
    setPairCooldown(initiator.id, responder.id, repeated ? 10 : 7);
    recordCounter("conversation");
    appState.telemetry.lastLatency.conversation = Math.round(conversation.totalLatencyMs);
    addLogEntry(
      `${initiator.name} <> ${responder.name}`,
      conversation.topic,
      {
        tag: "conversation",
        latencyMs: Math.round(conversation.totalLatencyMs),
        repeated,
        lines: turns
      }
    );
    pushRecentEvent(`${initiator.name} and ${responder.name} discussed ${conversation.topic}.`);
    pushTelemetry(
      "info",
      `${initiator.name} <> ${responder.name} ${reason}`,
      `${turns.length} turns about ${conversation.topic} in ${Math.round(conversation.totalLatencyMs)} ms.`
    );
  } else if (initiator && responder) {
    setPairCooldown(initiator.id, responder.id, 5);
    pushTelemetry(
      "warning",
      `${initiator.name} <> ${responder.name} stalled`,
      `The conversation about ${conversation.topic} ended before any usable dialogue was produced.`
    );
  }

  appState.activeConversation = null;
  assignRoomTargets();
  renderTelemetry();
  renderStatus();
  renderInspector();
}

async function advanceConversationStep() {
  const conversation = appState.activeConversation;
  if (!conversation || conversation.awaitingTurn) {
    return;
  }

  conversation.awaitingTurn = true;

  try {
    const speaker = getAgent(conversation.nextSpeakerId);
    const listener = conversationParticipants(conversation).find((agent) => agent.id !== conversation.nextSpeakerId);
    if (!speaker || !listener) {
      finishConversation("aborted");
      return;
    }

    if (conversation.turns.length >= conversation.maxTurns) {
      finishConversation("wrapped");
      return;
    }

    const response = await createWorkerRequest("reasoning", "conversationTurn", {
      state: buildWorkerState(),
      speaker: conversationAgentPayload(speaker),
      listener: conversationAgentPayload(listener),
      topic: conversation.topic,
      history: conversation.turns,
      turnIndex: conversation.turns.length
    });

    appState.tokens += response.payload.tokenEstimate || 0;
    conversation.totalLatencyMs += response.latencyMs;
    const turn = response.payload.turn;
    conversation.turns.push(turn);
    applySpeech(speaker, turn.text, response.latencyMs);
    speaker.thought = `I just said what I needed to say about ${conversation.topic}.`;
    listener.thought = `${speaker.name}'s last line changes how this feels.`;
    rememberConversationTurn(turn);
    conversation.nextSpeakerId = listener.id;
    conversation.nextAdvanceAt = performance.now() + clamp(1200 + turn.text.length * 18, 1200, 2600);
    renderStatus();

    if (conversation.turns.length >= conversation.minTurns && !response.payload.shouldContinue) {
      finishConversation("ended naturally");
      return;
    }
  } catch (error) {
    pushTelemetry(
      "warning",
      "Conversation turn failed",
      error.message || "The current utterance could not be generated."
    );
    finishConversation("aborted");
  } finally {
    if (appState.activeConversation === conversation) {
      conversation.awaitingTurn = false;
    }
  }
}

async function runSimulationTick() {
  if (!appState.world || appState.activeConversation || appState.tickInFlight) {
    return;
  }

  appState.tickInFlight = true;

  try {
    appState.tick += 1;
    prunePairCooldowns();
    renderStatus();

    for (const agent of appState.agents) {
      if (agent.conversationCooldown > 0) {
        agent.conversationCooldown -= 1;
      }

      const result = await reflectAgent(agent);
      agent.thought = result.thought;
      agent.lastAction = result.action;
      agent.lastDecisionLatencyMs = result.latencyMs;
      agent.lastActionSummary = describeAction(result.action);
      recordCounter("reflection");
      appState.telemetry.lastLatency.reflection = result.latencyMs;

      if (result.action.type === "move_to") {
        await moveAgent(agent, result.action.roomId);
      } else if (result.action.type === "talk_to" && agent.conversationCooldown === 0) {
        const responder = getAgent(result.action.targetId);
        if (!responder) {
          pushTelemetry(
            "warning",
            "Conversation target missing",
            `${agent.name} tried to talk to ${result.action.targetId}, but no matching agent was found.`
          );
        }
        if (responder && isPairCoolingDown(agent.id, responder.id)) {
          appState.telemetry.blockedConversationCount += 1;
          pushTelemetry(
            "warning",
            "Repeat prevented",
            `${agent.name} almost reopened with ${responder.name}, but the pair cooldown forced a redirect.`
          );
          await moveAgent(agent, nextRoomId(agent.currentRoom));
        } else {
          if (responder && agent.currentRoom !== responder.currentRoom) {
            pushTelemetry(
              "warning",
              "Conversation room mismatch",
              `${agent.name} targeted ${responder.name}, but they were in ${slugLabel(agent.currentRoom)} and ${slugLabel(responder.currentRoom)}.`
            );
          }
          await startConversation(agent, responder, result.action.topic);
        }
        if (appState.activeConversation) {
          break;
        }
      }
    }

    assignRoomTargets();
    renderInspector();
  } catch (error) {
    setSpeed(0);
    recordError("Simulation paused", error);
    elements.worldCaption.textContent = error.message;
  } finally {
    appState.tickInFlight = false;
  }
}

function advanceConversation(now) {
  if (!appState.activeConversation || now < appState.activeConversation.nextAdvanceAt || appState.activeConversation.awaitingTurn) {
    return;
  }
  void advanceConversationStep();
}

function animationFrame(now) {
  if (appState.running && appState.speed > 0 && appState.world) {
    const cadence = SPEED_MAP[appState.speed];
    if (now - appState.lastTickAt >= cadence) {
      appState.lastTickAt = now;
      runSimulationTick();
    }
  }

  advanceConversation(now);
  renderWorld();
  window.requestAnimationFrame(animationFrame);
}

function setSpeed(speed) {
  appState.speed = speed;
  appState.running = speed > 0;
  [elements.pauseButton, elements.playButton, elements.fastButton].forEach((button) => {
    button.classList.toggle("active", Number(button.dataset.speed) === speed);
  });
}

async function handleLoadModel() {
  try {
    await ensureModelLoaded();
    unlockApp();
    await generateWorldFromPrompt();
  } catch (error) {
    showCompatibilityIssue(error.message || "Unable to load the simulation model.");
  }
}

async function talkToSelectedAgent() {
  const agent = selectedAgent();
  const message = elements.officeInput.value.trim();
  if (!agent || !message || appState.directChatInFlight) {
    return;
  }

  appState.directChatInFlight = true;
  syncControls();

  try {
    const response = await createWorkerRequest("reasoning", "directChat", {
      agent: conversationAgentPayload(agent),
      message,
      state: buildWorkerState()
    });

    const reply = response.payload.reply;
    agent.thought = response.payload.thought;
    appState.tokens += response.payload.tokenEstimate || 0;
    applySpeech(agent, reply, response.latencyMs);
    addLogEntry(
      `You <> ${agent.name}`,
      "private office",
      {
        tag: "office",
        latencyMs: response.latencyMs,
        lines: [
          { speakerName: "You", text: message },
          { speakerName: agent.name, text: reply }
        ]
      }
    );
    agent.memories.unshift({
      timestamp: appState.tick,
      type: "office",
      summary: `You called ${agent.name} into a private office conversation about ${message.toLowerCase()}.`,
      sentiment: "watchful",
      importance: 6,
      latencyMs: response.latencyMs,
      relationship_delta: {}
    });
    agent.memories = agent.memories.slice(0, 8);
    pushTelemetry("info", `You -> ${agent.name}`, `private office reply in ${response.latencyMs} ms.`);
    elements.officeInput.value = "";
    renderInspector();
    renderTelemetry();
    renderStatus();
  } catch (error) {
    pushTelemetry("warning", `${agent.name} could not respond`, error.message || "Direct conversation failed.");
    renderTelemetry();
  } finally {
    appState.directChatInFlight = false;
    syncControls();
  }
}

function bindEvents() {
  elements.loadModelButton.addEventListener("click", () => {
    void handleLoadModel();
  });
  elements.logLatestButton.addEventListener("click", () => {
    appState.logMode = "latest";
    syncLogMode();
  });
  elements.logFullButton.addEventListener("click", () => {
    appState.logMode = "full";
    syncLogMode();
  });
  elements.togglePromptButton.addEventListener("click", () => {
    setPromptExpanded(!appState.promptExpanded);
  });
  elements.generateButton.addEventListener("click", () => {
    void generateWorldFromPrompt().catch(() => {});
  });
  elements.pauseButton.addEventListener("click", () => setSpeed(0));
  elements.playButton.addEventListener("click", () => setSpeed(1));
  elements.fastButton.addEventListener("click", () => setSpeed(2));
  elements.screenshotButton.addEventListener("click", captureScreenshot);
  elements.officeSendButton.addEventListener("click", () => {
    void talkToSelectedAgent();
  });
  window.addEventListener("resize", syncCanvasResolution);
  elements.canvas.addEventListener("click", (event) => {
    const agent = agentAtPosition(event.offsetX, event.offsetY);
    if (!agent) {
      appState.selectedAgentId = null;
      renderInspector();
      return;
    }
    appState.selectedAgentId = agent.id;
    renderInspector();
  });
}

async function init() {
  elements.scenarioInput.value = DEFAULT_PROMPT;
  instrumentNetwork();
  registerServiceWorker();
  bindEvents();
  setLoadProgress(null);
  setPromptExpanded(true);
  syncDebugVisibility();
  renderStatus();
  renderModelStatus();
  renderTelemetry();
  syncControls();
  syncLogMode();
  syncCanvasResolution();
  window.requestAnimationFrame(animationFrame);

  if (!browserHasWebGPU) {
    showCompatibilityIssue("WebGPU was not detected in this browser.");
  }
}

init();
