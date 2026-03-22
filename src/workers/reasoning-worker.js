import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.0.0-next.8";
import { MODEL_CONFIG, ROOM_LAYOUTS } from "../config.js";

const MODEL = MODEL_CONFIG.reasoning;
const FALLBACK_NAMES = ["Maya", "Jordan", "Priya", "Sam"];

env.allowLocalModels = false;
if ("useBrowserCache" in env) {
  env.useBrowserCache = true;
}

const runtime = {
  generatorPromise: null,
  device: MODEL.device
};

function postStatus(stage, extra = {}) {
  self.postMessage({
    type: "workerStatus",
    payload: {
      stage,
      model: MODEL.model,
      label: MODEL.label,
      shortLabel: MODEL.shortLabel,
      approxSize: MODEL.approxSize,
      device: runtime.device,
      ...extra
    }
  });
}

function postTrace(kind, payload = {}) {
  self.postMessage({
    type: "workerTrace",
    payload: {
      kind,
      ...payload
    }
  });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function titleCase(value) {
  return String(value || "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function approximateTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

function cleanLines(text) {
  return String(text || "")
    .replace(/```/g, "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function promptToTraceText(prompt) {
  if (typeof prompt === "string") {
    return prompt;
  }
  if (Array.isArray(prompt)) {
    return prompt.map((entry) => {
      if (typeof entry === "string") return entry;
      if (entry && typeof entry === "object") {
        const role = entry.role ? `${entry.role}: ` : "";
        return `${role}${entry.content || ""}`.trim();
      }
      return String(entry || "");
    }).join("\n\n");
  }
  return String(prompt || "");
}

function ensureWebGPU() {
  if (MODEL.device === "webgpu" && !("gpu" in navigator)) {
    throw new Error("WebGPU is unavailable in this worker.");
  }
}

async function getGenerator() {
  if (runtime.generatorPromise) {
    return runtime.generatorPromise;
  }

  ensureWebGPU();
  postStatus("initiate", {
    message: `Loading ${MODEL.shortLabel} from Hugging Face CDN`,
    progress: 0,
    file: MODEL.model
  });

  runtime.generatorPromise = pipeline("text-generation", MODEL.model, {
    device: MODEL.device,
    ...(MODEL.dtype ? { dtype: MODEL.dtype } : {}),
    progress_callback: (progress) => {
      postStatus(progress.status || "progress", {
        file: progress.file,
        loaded: progress.loaded,
        total: progress.total,
        progress: typeof progress.progress === "number" ? progress.progress : 0,
        message: progress.file ? `Loading ${progress.file}` : `Loading ${MODEL.shortLabel}`
      });
    }
  }).then((generator) => {
    postStatus("ready", { message: `${MODEL.shortLabel} ready`, progress: 100 });
    return generator;
  }).catch((error) => {
    runtime.generatorPromise = null;
    postStatus("error", { message: error.message || `Failed to load ${MODEL.shortLabel}.`, progress: 100 });
    throw error;
  });

  return runtime.generatorPromise;
}

function extractGeneratedText(output) {
  if (typeof output === "string") {
    return output;
  }
  if (Array.isArray(output) && output.length > 0) {
    const candidate = output[0].generated_text ?? output[0];
    if (typeof candidate === "string") {
      return candidate;
    }
    if (Array.isArray(candidate) && candidate.length > 0) {
      const last = candidate[candidate.length - 1];
      if (typeof last === "string") {
        return last;
      }
      if (last && typeof last.content === "string") {
        return last.content;
      }
    }
    if (candidate && typeof candidate.content === "string") {
      return candidate.content;
    }
  }
  return JSON.stringify(output);
}

async function generateText(messages, maxNewTokens, options = {}) {
  const generator = await getGenerator();
  const output = await generator(messages, {
    max_new_tokens: maxNewTokens,
    do_sample: options.doSample ?? false,
    temperature: options.temperature,
    top_p: options.topP,
    repetition_penalty: options.repetitionPenalty ?? 1.02,
    return_full_text: false
  });
  const text = extractGeneratedText(output);
  return {
    text,
    tokenEstimate: approximateTokens(JSON.stringify(messages)) + approximateTokens(text)
  };
}

function historyText(turns) {
  return (turns || []).map((turn) => `${turn.speakerName}: ${turn.text}`).join(" | ");
}

function pairKey(leftId, rightId) {
  return [leftId, rightId].sort().join(":");
}

function hasPairCooldown(leftId, rightId, state) {
  return Number(state.pairCooldowns?.[pairKey(leftId, rightId)] || 0) > state.tick;
}

function availableTalkTargets(agent, state) {
  return state.agents.filter((other) => {
    return other.id !== agent.id && other.currentRoom === agent.currentRoom && !hasPairCooldown(agent.id, other.id, state);
  });
}

function normalizeDecision(text) {
  const value = cleanLines(text).join(" ").toUpperCase();
  if (/\bCONTINUE\b/.test(value)) return "CONTINUE";
  if (/\bEND\b/.test(value)) return "END";
  return "";
}

function badDialogueLine(line) {
  return !line
    || line.length < 4
    || line.length > 220
    || /scene|draft|conversation itself|improve the room|upcoming updates|as an ai|^assistant$|^user$|^we need to|^let'?s |^keep within|^reply as |^respond as |^write only|^output only|^just your response|^your response|^first person|^no bullet|^no speaker|^maybe add|^that'?s one sentence|natural language|flow naturally|stage directions|spoken sentences|no labels|no markdown|private office prompt/i.test(line.toLowerCase());
}

function quotedDialogueCandidates(text) {
  return Array.from(String(text || "").matchAll(/"([^"]{4,220})"/g))
    .map((match) => match[1].trim())
    .filter(Boolean);
}

function dialogueCandidates(text) {
  return [...quotedDialogueCandidates(text), ...cleanLines(text)
    .flatMap((line) => line.split(/(?<=[.!?])\s+/))
    .map((line) => line
      .replace(/^[>*-]+\s*/, "")
      .replace(/^(speaker\s*[ab]|assistant|user|system|[A-Z][a-z]+)\s*:\s*/i, "")
      .replace(/^(we need to respond as|respond as|reply as|write only|output:|answer:|response:)\s*/i, "")
      .replace(/^['"`]+|['"`]+$/g, "")
      .trim())
    .filter(Boolean)];
}

function dedupeDialogueSentences(text) {
  const sentences = String(text || "")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const unique = [];
  const seen = new Set();

  sentences.forEach((sentence) => {
    const cleaned = sentence.trim();
    if (!cleaned) return;
    const key = cleaned.toLowerCase().replace(/[.!?]+$/g, "");
    if (seen.has(key)) return;
    seen.add(key);
    unique.push(cleaned);
  });

  return unique.join(" ").replace(/\s+/g, " ").trim();
}

function normalizeDialogueLine(text) {
  const candidates = dialogueCandidates(text);
  const cleanedCandidates = candidates.map(dedupeDialogueSentences).filter(Boolean);
  const usable = cleanedCandidates.filter((line, index) => !badDialogueLine(line) && cleanedCandidates.indexOf(line) === index);
  if (usable.length > 0) {
    return usable.slice(0, 2).join(" ").slice(0, 220).trim();
  }
  return cleanedCandidates[0] || "";
}

function historyTurnCount(history) {
  return String(history || "")
    .split("|")
    .map((turn) => turn.trim())
    .filter(Boolean)
    .length;
}

function fallbackConversationDecision(history) {
  const turns = historyTurnCount(history);
  return {
    shouldContinue: turns < 4,
    tokenEstimate: 0,
    source: "deterministic"
  };
}

function normalizeRelationshipDelta(input, knownAgents) {
  const result = {};
  const source = input && typeof input === "object" ? input : {};
  Object.entries(source).forEach(([key, value]) => {
    const agent = knownAgents.find((c) => c.id === slugify(key) || c.name.toLowerCase() === String(key).toLowerCase());
    if (!agent) return;
    result[agent.id] = {
      trust: clamp(Number(value?.trust ?? 0), -2, 2),
      rapport: clamp(Number(value?.rapport ?? 0), -2, 2),
      notes: String(value?.notes || "The interaction shifted the relationship slightly.")
    };
  });
  return result;
}

function inferMemorySentiment(simulationEvent) {
  if (simulationEvent.type !== "conversation") return "watchful";
  const text = simulationEvent.transcript.map((t) => t.text).join(" ");
  return /risk|problem|tension|worry|hard|wrong|late|broken/i.test(text) ? "tense" : "curious";
}

function inferMemoryImportance(simulationEvent) {
  return simulationEvent.type === "conversation"
    ? clamp(5 + simulationEvent.transcript.length, 1, 10)
    : 4;
}

function inferRelationshipDelta(simulationEvent, perspectiveAgent, knownAgents) {
  if (simulationEvent.type !== "conversation") return {};
  const otherId = simulationEvent.participants.find((p) => p !== perspectiveAgent.id);
  const other = knownAgents.find((a) => a.id === otherId);
  if (!other) return {};
  const tense = inferMemorySentiment(simulationEvent) === "tense";
  return normalizeRelationshipDelta({
    [other.id]: {
      trust: tense ? -1 : 1,
      rapport: tense ? 0 : 1,
      notes: tense ? `The exchange with ${other.name} felt sharp but revealing.` : `The exchange with ${other.name} felt productive.`
    }
  }, knownAgents);
}

function compressMemory(payload) {
  const summary = payload.simulationEvent.type === "conversation"
    ? `${payload.perspectiveAgent.name} discussed ${payload.simulationEvent.topic} in ${payload.roomName}.`
    : `${payload.perspectiveAgent.name} moved through ${payload.roomName} to read the room.`;

  return {
    memory: {
      timestamp: payload.tick,
      type: payload.simulationEvent.type,
      summary,
      sentiment: inferMemorySentiment(payload.simulationEvent),
      importance: inferMemoryImportance(payload.simulationEvent),
      relationship_delta: inferRelationshipDelta(payload.simulationEvent, payload.perspectiveAgent, payload.knownAgents)
    },
    tokenEstimate: 0,
    source: "deterministic"
  };
}

function decideAction(agent, state) {
  const peers = availableTalkTargets(agent, state);

  if (peers.length === 0) {
    const nextRoom = state.rooms.find((r) => r.id !== agent.currentRoom) || state.rooms[0];
    return { action: { type: "move_to", roomId: nextRoom.id }, tokenEstimate: 0 };
  }

  const target = peers[Math.floor(Math.random() * peers.length)];
  const topic = generateTopic(agent, target);
  return { action: { type: "talk_to", targetId: target.id, topic }, tokenEstimate: 0 };
}

function generateTopic(agent, target) {
  const goals = {
    "spot hidden risks": "risk awareness",
    "protect quality": "project quality",
    "keep momentum": "current sprint",
    "figure out": "team dynamics",
    "default": "the current situation"
  };
  const goal = agent.goal || "default";
  const key = Object.keys(goals).find((k) => goal.toLowerCase().includes(k)) || "default";
  return goals[key];
}

async function decideConversationTurn(state, speaker, listener, topic, history, turnIndex) {
  const options = [
    { doSample: false, repetitionPenalty: 1.04 },
    { doSample: true, temperature: 0.7, topP: 0.92, repetitionPenalty: 1.05 },
    { doSample: true, temperature: 0.85, topP: 0.95, repetitionPenalty: 1.08 }
  ];

  const prompts = [
    [
      "You are writing one in-world line of dialogue for a local social simulation.",
      `Room: ${speaker.currentRoom}`,
      `Topic: ${topic}`,
      `Speaker: ${speaker.name}, ${speaker.role}. Personality: ${speaker.personality}. Goal: ${speaker.goal}. Secret: ${speaker.secret}.`,
      `Listener: ${listener.name}, ${listener.role}.`,
      history ? `Dialogue so far:\n${history}` : "Dialogue so far: none.",
      `Turn: ${turnIndex + 1}`,
      `Next spoken line from ${speaker.name}:`,
      `${speaker.name}:`
    ].join("\n"),
    [
      `${speaker.name} is speaking to ${listener.name} in ${speaker.currentRoom} about ${topic}.`,
      `${speaker.name} is ${speaker.personality}.`,
      history ? `Earlier dialogue: ${history}` : "Earlier dialogue: none.",
      `${speaker.name}:`
    ].join("\n")
  ];

  let bestCandidate = "";
  let bestTokenEstimate = 0;
  let lastError = null;
  const attempts = [];
  for (const prompt of prompts) {
    for (const opts of options) {
      try {
        const result = await generateText(prompt, 80, opts);
        const line = normalizeDialogueLine(result.text);
        attempts.push({ raw: result.text, parsed: line });
        postTrace("conversation-turn", {
          prompt: promptToTraceText(prompt),
          response: result.text,
          parsed: line,
          accepted: !badDialogueLine(line)
        });
        if (line && (!bestCandidate || line.length > bestCandidate.length)) {
          bestCandidate = line;
          bestTokenEstimate = result.tokenEstimate;
        }
        if (!badDialogueLine(line)) {
          return { line, tokenEstimate: result.tokenEstimate, source: "model" };
        }
      } catch (error) {
        lastError = error;
        postTrace("conversation-turn", {
          prompt: promptToTraceText(prompt),
          error: error.message || String(error),
          accepted: false
        });
      }
    }
  }

  if (bestCandidate) {
    return {
      line: bestCandidate,
      tokenEstimate: bestTokenEstimate,
      source: "model-salvaged"
    };
  }

  const debugSummary = attempts.slice(-2)
    .map((attempt, index) => `attempt ${index + 1} raw=${JSON.stringify(attempt.raw)} parsed=${JSON.stringify(attempt.parsed)}`)
    .join(" | ");
  throw lastError || new Error(`Failed to generate dialogue for ${speaker.name}.${debugSummary ? ` ${debugSummary}` : ""}`);
}

async function decideConversationEnd(state, speaker, listener, topic, history) {
  const prompts = [
    [
      {
        role: "system",
        content: "Decide if a conversation naturally ends right now. Reply with exactly one word: CONTINUE or END."
      },
      {
        role: "user",
        content: `You are ${speaker.name}, ${speaker.role}. Goal: ${speaker.goal}. Talking with ${listener.name} about ${topic}.\nDialogue so far: ${history || "just started."}\nShould this conversation continue or end?`
      }
    ],
    [
      "Decide if a conversation naturally ends right now.",
      `You are ${speaker.name}, ${speaker.role}. Goal: ${speaker.goal}. Talking with ${listener.name} about ${topic}.`,
      `Dialogue so far: ${history || "just started."}`,
      "Reply with exactly one word: CONTINUE or END."
    ].join("\n")
  ];

  try {
    for (const prompt of prompts) {
      const result = await generateText(prompt, 8, { doSample: false, repetitionPenalty: 1.02 });
      const decision = normalizeDecision(result.text);
      postTrace("conversation-end", {
        prompt: promptToTraceText(prompt),
        response: result.text,
        parsed: decision,
        accepted: Boolean(decision)
      });
      if (!decision) {
        continue;
      }
      return {
        shouldContinue: decision === "CONTINUE",
        tokenEstimate: result.tokenEstimate,
        source: "model"
      };
    }

    return fallbackConversationDecision(history);
  } catch {
    return fallbackConversationDecision(history);
  }
}

async function directChat(agent, message, state) {
  const recentEvents = state.recentEvents.join(" | ") || "the atmosphere is tense";
  const recentMemories = (agent.memories || []).map((m) => m.summary).join(" | ") || "none";

  const prompts = [
    [
      "Private office conversation in a local social simulation.",
      `Character: ${agent.name}, ${agent.role}. Personality: ${agent.personality}. Goal: ${agent.goal}. Secret: ${agent.secret}.`,
      `Current room: ${agent.currentRoom}. Recent events: ${recentEvents}. Recent memories: ${recentMemories}.`,
      `User: ${message}`,
      `${agent.name}:`
    ].join("\n"),
    [
      `${agent.name} is in a private office answering the user.`,
      `${agent.name} is ${agent.personality}.`,
      `User: ${message}`,
      `${agent.name}:`
    ].join("\n")
  ];

  let lastError = null;
  for (const prompt of prompts) {
    try {
      const result = await generateText(prompt, 96, { doSample: false, repetitionPenalty: 1.06 });
      const reply = normalizeDialogueLine(result.text);
      postTrace("direct-chat", {
        prompt: promptToTraceText(prompt),
        response: result.text,
        parsed: reply,
        accepted: Boolean(reply)
      });
      if (!reply) {
        throw new Error("Direct conversation response was empty.");
      }

      return {
        reply,
        thought: `${message} is sitting with me. I need to decide how honest I want to be.`,
        tokenEstimate: result.tokenEstimate,
        source: "model"
      };
    } catch (error) {
      lastError = error;
      postTrace("direct-chat", {
        prompt: promptToTraceText(prompt),
        error: error.message || String(error),
        accepted: false
      });
    }
  }

  throw lastError || new Error("Direct conversation failed.");
}

async function warmup() {
  await getGenerator();
  return { ready: true, model: MODEL.model };
}

function inferSetting(prompt) {
  return String(prompt || "")
    .split(/[.!?]/)
    .map((part) => part.trim())
    .find(Boolean) || "Generated scenario";
}

function defaultRooms(prompt) {
  const lower = String(prompt || "").toLowerCase();
  if (/(startup|office|cto|sales|compliance|client|intern)/.test(lower)) {
    return [
      { id: "studio_floor", name: "Studio Floor", description: "Shared desks and constant chatter." },
      { id: "meeting_room", name: "Meeting Room", description: "A tight room for risky promises." },
      { id: "kitchen", name: "Kitchen", description: "Coffee, gossip, and quick check-ins." },
      { id: "ops_room", name: "Ops Room", description: "Screens, planning, and quiet stress." }
    ];
  }
  return [
    { id: "commons", name: "Commons", description: "A shared room where everyone crosses paths." },
    { id: "side_room", name: "Side Room", description: "A smaller room for private conversations." },
    { id: "kitchen", name: "Kitchen", description: "A place for informal talk and observation." },
    { id: "back_room", name: "Back Room", description: "A quieter room where context piles up." }
  ];
}

function inferGoal(role) {
  const lower = String(role || "").toLowerCase();
  if (/(cto|engineer|developer|tech)/.test(lower)) return "Protect quality and avoid preventable damage.";
  if (/(sales|manager|lead|director)/.test(lower)) return "Keep momentum without losing trust.";
  if (/(compliance|legal|finance|ops)/.test(lower)) return "Spot hidden risks before they spread.";
  return "Figure out what is really happening.";
}

function inferSecret(role) {
  const lower = String(role || "").toLowerCase();
  if (/(cto|engineer|developer|tech)/.test(lower)) return "Knows the plan is shakier than people think.";
  if (/(sales|manager|lead|director)/.test(lower)) return "Made a promise that may be too optimistic.";
  if (/(compliance|legal|finance|ops)/.test(lower)) return "Has noticed a pattern others are missing.";
  return "Is holding back an important impression.";
}

function defaultRole(index) {
  return ["CTO", "Sales Lead", "Compliance Lead", "Intern"][index] || "Resident";
}

function defaultPersonality(index) {
  return [
    "principled and quietly worried about technical debt",
    "charismatic and prone to overpromising",
    "meticulous and suspicious of shortcuts",
    "eager, observant, and talks to everyone"
  ][index] || "observant and under pressure";
}

function extractAgentsFromPrompt(prompt, rooms) {
  const clauses = String(prompt || "")
    .replace(/\n/g, " ")
    .split(/[.;]+/)
    .map((part) => part.trim())
    .filter(Boolean);

  const parsed = clauses.map((clause, index) => {
    const match = clause.match(/^([A-Z][a-z]+)\s+(?:is|runs|handles|leads|manages|owns|works as|serves as)\s+(.*)$/i);
    if (!match) return null;

    const name = titleCase(match[1]);
    const details = match[2].replace(/^the\s+/i, "").trim();
    const parts = details.split(/\s+-\s+|\s+—\s+/);
    const role = (parts[0] || defaultRole(index)).replace(/,.*$/, "").trim();
    const personality = parts.slice(1).join(" - ").trim() || defaultPersonality(index);

    return {
      id: slugify(name),
      name,
      role,
      personality,
      goal: inferGoal(role),
      secret: inferSecret(role),
      starting_room: rooms[index % rooms.length].id
    };
  }).filter(Boolean);

  while (parsed.length < 4) {
    const index = parsed.length;
    const name = FALLBACK_NAMES[index] || `Agent ${index + 1}`;
    const role = defaultRole(index);
    parsed.push({
      id: slugify(name),
      name,
      role,
      personality: defaultPersonality(index),
      goal: inferGoal(role),
      secret: inferSecret(role),
      starting_room: rooms[index % rooms.length].id
    });
  }

  return parsed.slice(0, 4);
}

function resolveRoomId(value, rooms, index = 0) {
  const roomId = slugify(value);
  const exact = rooms.find((room) => room.id === roomId);
  return exact ? exact.id : rooms[index % rooms.length].id;
}

function normalizeRooms(input) {
  return input.slice(0, ROOM_LAYOUTS.length).map((room, index) => ({
    id: slugify(room.id || room.name || `room_${index + 1}`),
    name: titleCase(room.name || room.id || `Room ${index + 1}`),
    description: String(room.description || "").trim() || "A room generated for the current scenario.",
    ...ROOM_LAYOUTS[index]
  }));
}

function relationshipValue(value, defaultNotes) {
  return {
    trust: clamp(Number(value?.trust ?? 5), 1, 10),
    rapport: clamp(Number(value?.rapport ?? 5), 1, 10),
    notes: String(value?.notes || defaultNotes || "No strong read yet.")
  };
}

function normalizeRelationships(currentAgent, agents) {
  const relationships = {};
  agents.forEach((other) => {
    if (other.id === currentAgent.id) return;
    relationships[other.id] = relationshipValue(null, `${currentAgent.name} is still reading ${other.name}.`);
  });
  return relationships;
}

function normalizeAgents(input, rooms) {
  const baseAgents = input.slice(0, 4).map((agent, index) => ({
    id: slugify(agent.id || agent.name || `agent_${index + 1}`),
    name: titleCase(agent.name || `Agent ${index + 1}`),
    role: String(agent.role || defaultRole(index)).trim(),
    personality: String(agent.personality || defaultPersonality(index)).trim(),
    goal: String(agent.goal || inferGoal(agent.role)).trim(),
    secret: String(agent.secret || inferSecret(agent.role)).trim(),
    starting_room: resolveRoomId(agent.starting_room, rooms, index)
  }));

  return baseAgents.map((agent) => ({
    ...agent,
    relationships: normalizeRelationships(agent, baseAgents)
  }));
}

function generateWorld(prompt) {
  const rooms = normalizeRooms(defaultRooms(prompt));
  const agents = normalizeAgents(extractAgentsFromPrompt(prompt, rooms), rooms);
  return {
    world: {
      setting: inferSetting(prompt),
      rooms,
      agents
    },
    tokenEstimate: 0,
    source: "parser"
  };
}

self.addEventListener("message", async (event) => {
  const { type, requestId, payload } = event.data;

  try {
    if (type === "warmup") {
      self.postMessage({ type: "warmedUp", requestId, payload: await warmup() });
      return;
    }

    if (type === "generateWorld") {
      self.postMessage({ type: "worldGenerated", requestId, payload: generateWorld(payload.prompt || "") });
      return;
    }

    if (type === "reflect") {
      const { action, tokenEstimate } = decideAction(payload.agent, payload.state);
      console.log("WORKER reflect action:", action, "tokens:", tokenEstimate);
      const target = payload.state.agents.find((a) => a.id === action.targetId);
      const roomName = payload.state.roomLookup[action.roomId]?.name || action.roomId;
      const recentMemory = payload.agent.memories?.[0]?.summary;
      const recentEvent = payload.state.recentEvents[0] || "the room feels quiet.";

      let thought;
      if (action.type === "talk_to" && target) {
        thought = `${target.name} is here. I want to raise ${action.topic} with them.`;
      } else if (action.type === "move_to") {
        thought = `Moving to ${roomName} to find more people.`;
      } else {
        thought = recentMemory
          ? `Still thinking about ${recentMemory.toLowerCase()}. ${recentEvent}`
          : "Waiting to see what develops.";
      }

      self.postMessage({
        type: "reflectionComplete",
        requestId,
        payload: {
          agentId: payload.agent.id,
          thought,
          action,
          tokenEstimate,
          source: "model"
        }
      });
      return;
    }

    if (type === "conversationTurn") {
      const history = historyText(payload.history);
      const turn = await decideConversationTurn(
        payload.state,
        payload.speaker,
        payload.listener,
        payload.topic,
        history,
        payload.turnIndex
      );

      const endDecision = await decideConversationEnd(
        payload.state,
        payload.speaker,
        payload.listener,
        payload.topic,
        history + ` | ${payload.speaker.name}: ${turn.line}`
      );

      self.postMessage({
        type: "conversationTurnComplete",
        requestId,
        payload: {
          turn: {
            speakerId: payload.speaker.id,
            speakerName: payload.speaker.name,
            text: turn.line
          },
          shouldContinue: endDecision.shouldContinue,
          tokenEstimate: turn.tokenEstimate + endDecision.tokenEstimate,
          source: "model"
        }
      });
      return;
    }

    if (type === "directChat") {
      self.postMessage({
        type: "directChatComplete",
        requestId,
        payload: await directChat(payload.agent, payload.message, payload.state)
      });
      return;
    }

    if (type === "compressMemory") {
      self.postMessage({
        type: "memoryCompressed",
        requestId,
        payload: compressMemory(payload)
      });
    }
  } catch (error) {
    self.postMessage({ type: "workerError", requestId, error: error.message || "Reasoning worker failed." });
  }
});
