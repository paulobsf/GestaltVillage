import { TILE, WORLD_WIDTH, WORLD_HEIGHT } from "../constants.js";

export function createWorldRenderer({
  appState,
  elements,
  ctx,
  selectedAgent,
  clamp
}) {
  const RETRO_FONT = '"Courier New", "Lucida Console", monospace';

  /* ── helpers ───────────────────────────────────────── */

  function roomCenter(room) {
    return {
      x: (room.x + room.w / 2) * TILE,
      y: (room.y + room.h / 2) * TILE
    };
  }

  function syncCanvasResolution() {
    const bounds = elements.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dpr = window.devicePixelRatio || 1;
    const bw = Math.round(bounds.width * dpr);
    const bh = Math.round(bounds.height * dpr);
    if (elements.canvas.width !== bw || elements.canvas.height !== bh) {
      elements.canvas.width = bw;
      elements.canvas.height = bh;
    }
    ctx.setTransform(bw / WORLD_WIDTH, 0, 0, bh / WORLD_HEIGHT, 0, 0);
  }

  function roomAnchor(room, slotIndex) {
    const columns = room.w >= 4 ? 2 : 1;
    const rows = Math.max(1, Math.ceil((slotIndex + 1) / columns));
    const col = slotIndex % columns;
    const row = Math.floor(slotIndex / columns);
    const left = (room.x * TILE) + 88;
    const top = (room.y * TILE) + 118;
    const usableWidth = Math.max(0, room.w * TILE - 176);
    const usableHeight = Math.max(0, room.h * TILE - 160);
    const xStep = columns > 1 ? usableWidth / (columns - 1) : 0;
    const yStep = rows > 1 ? usableHeight / (rows - 1) : 0;

    return {
      x: left + col * xStep,
      y: top + row * yStep
    };
  }

  function conversationAnchors(room) {
    const c = roomCenter(room);
    return [
      { x: c.x - 36, y: c.y + 8 },
      { x: c.x + 36, y: c.y + 8 }
    ];
  }

  function roomAgentLayout(agent) {
    const agentsInRoom = appState.agents
      .filter((other) => other.currentRoom === agent.currentRoom)
      .sort((left, right) => left.id.localeCompare(right.id));
    const index = agentsInRoom.findIndex((other) => other.id === agent.id);
    return {
      index,
      count: agentsInRoom.length,
      offsetX: (index - (agentsInRoom.length - 1) / 2) * 34
    };
  }

  /** Pixel-snapped rect for crisp 8-bit look */
  function pixRect(x, y, w, h) {
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  }

  function pixStrokeRect(x, y, w, h) {
    ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
  }

  function roundRect(x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.lineTo(x + w - rad, y);
    ctx.arcTo(x + w, y, x + w, y + rad, rad);
    ctx.lineTo(x + w, y + h - rad);
    ctx.arcTo(x + w, y + h, x + w - rad, y + h, rad);
    ctx.lineTo(x + rad, y + h);
    ctx.arcTo(x, y + h, x, y + h - rad, rad);
    ctx.lineTo(x, y + rad);
    ctx.arcTo(x, y, x + rad, y, rad);
    ctx.closePath();
  }

  function roomPalette(room) {
    const key = `${room.id} ${room.name}`.toLowerCase();
    if (/meeting/.test(key)) {
      return { floor: "#d8c39a", detail: "#b78e48", wall: "#6b4a29" };
    }
    if (/kitchen/.test(key)) {
      return { floor: "#c8d7b1", detail: "#5d8a62", wall: "#4d5c2e" };
    }
    if (/ops|control|back_room/.test(key)) {
      return { floor: "#99a7af", detail: "#4f7485", wall: "#2f4750" };
    }
    if (/quiet|study|side_room/.test(key)) {
      return { floor: "#d7c1a1", detail: "#8e6f49", wall: "#644121" };
    }
    return { floor: "#d9c7a3", detail: "#cc7b45", wall: "#7b5c39" };
  }

  function roomPopulation(roomId) {
    return appState.agents.filter((agent) => agent.currentRoom === roomId).length;
  }

  function drawBackdrop() {
    ctx.fillStyle = "#6a4c2d";
    pixRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    ctx.fillStyle = "#b98b46";
    pixRect(20, 20, WORLD_WIDTH - 40, WORLD_HEIGHT - 40);

    ctx.fillStyle = "#cfaa63";
    pixRect(36, 36, WORLD_WIDTH - 72, WORLD_HEIGHT - 72);

    ctx.fillStyle = "rgba(84, 56, 22, 0.12)";
    for (let y = 36; y < WORLD_HEIGHT - 36; y += 16) {
      pixRect(36, y, WORLD_WIDTH - 72, 2);
    }
    for (let x = 36; x < WORLD_WIDTH - 36; x += 16) {
      pixRect(x, 36, 2, WORLD_HEIGHT - 72);
    }
  }

  function drawConnectors() {
    const rooms = appState.rooms;
    if (rooms.length < 2) return;

    ctx.fillStyle = "#d9b56e";
    for (let index = 0; index < rooms.length - 1; index += 1) {
      const current = roomCenter(rooms[index]);
      const next = roomCenter(rooms[index + 1]);
      const minX = Math.min(current.x, next.x);
      const minY = Math.min(current.y, next.y);
      const width = Math.abs(next.x - current.x) || 8;
      const height = Math.abs(next.y - current.y) || 8;
      pixRect(minX, current.y - 6, width, 12);
      pixRect(next.x - 6, minY, 12, height);
    }

    ctx.fillStyle = "rgba(95, 64, 33, 0.18)";
    for (let index = 0; index < rooms.length - 1; index += 1) {
      const current = roomCenter(rooms[index]);
      const next = roomCenter(rooms[index + 1]);
      const minX = Math.min(current.x, next.x);
      const minY = Math.min(current.y, next.y);
      const width = Math.abs(next.x - current.x) || 8;
      const height = Math.abs(next.y - current.y) || 8;
      for (let x = minX + 8; x < minX + width; x += 18) {
        pixRect(x, current.y - 2, 8, 4);
      }
      for (let y = minY + 8; y < minY + height; y += 18) {
        pixRect(next.x - 2, y, 4, 8);
      }
    }
  }

  /* ── Rooms ─────────────────────────────────────────── */

  function drawRoom(room) {
    const px = room.x * TILE;
    const py = room.y * TILE;
    const pw = room.w * TILE;
    const ph = room.h * TILE;
    const pad = 4;
    const ix = px + pad;
    const iy = py + pad;
    const iw = pw - pad * 2;
    const ih = ph - pad * 2;
    const palette = roomPalette(room);
    const population = roomPopulation(room.id);

    ctx.fillStyle = "rgba(46, 24, 8, 0.14)";
    pixRect(ix + 10, iy + ih - 2, iw - 10, 12);

    roundRect(ix, iy, iw, ih, 10);
    ctx.fillStyle = palette.floor;
    ctx.fill();

    ctx.fillStyle = "rgba(255, 249, 234, 0.18)";
    pixRect(ix + 4, iy + 4, iw - 8, 12);

    ctx.fillStyle = "rgba(58, 38, 18, 0.08)";
    for (let row = iy + 38; row < iy + ih - 8; row += 28) {
      for (let col = ix + 14; col < ix + iw - 8; col += 28) {
        pixRect(col, row, 8, 8);
      }
    }

    ctx.strokeStyle = palette.wall;
    ctx.lineWidth = 4;
    roundRect(ix, iy, iw, ih, 10);
    ctx.stroke();

    ctx.fillStyle = palette.detail;
    pixRect(ix + 8, iy + 8, iw - 16, 22);

    ctx.fillStyle = "#2e1f12";
    ctx.font = `bold 14px ${RETRO_FONT}`;
    ctx.textAlign = "left";
    ctx.fillText(room.name, ix + 16, iy + 26);

    ctx.textAlign = "center";
    ctx.fillStyle = "#fff4cf";
    pixRect(ix + iw - 40, iy + 8, 24, 22);
    ctx.fillStyle = "#2e1f12";
    ctx.font = `bold 13px ${RETRO_FONT}`;
    ctx.fillText(String(population), ix + iw - 28, iy + 24);

    ctx.fillStyle = palette.wall;
    pixRect(ix + iw / 2 - 20, iy + ih - 10, 40, 6);
    pixRect(ix + iw / 2 - 12, iy + ih - 16, 24, 6);

    ctx.textAlign = "left";

    drawFurniture(room, ix, iy, iw, ih);
  }

  /* ── Furniture – pixel-art style, fitted to rooms ──── */

  function drawFurniture(room, ix, iy, iw, ih) {
    const key = `${room.id} ${room.name}`.toLowerCase();

    /* reduce opacity so agents pop, but keep the 8-bit shapes visible */
    ctx.globalAlpha = 0.35;

    if (/studio|commons/.test(key)) {
      /* two desks + two seats */
      ctx.fillStyle = "#a88858";
      pixRect(ix + 16, iy + ih * 0.58, 80, 32);
      pixRect(ix + iw - 96, iy + ih * 0.58, 80, 32);
      ctx.fillStyle = "#7a98b0";
      pixRect(ix + 28, iy + ih - 52, 48, 20);
      pixRect(ix + iw - 76, iy + ih - 52, 48, 20);
      ctx.globalAlpha = 1;
      return;
    }

    if (/meeting/.test(key)) {
      /* long table + chairs on sides + whiteboard */
      ctx.fillStyle = "#a88850";
      pixRect(ix + 40, iy + ih * 0.48, iw - 80, 56);
      ctx.fillStyle = "#607888";
      pixRect(ix + 16, iy + ih * 0.54, 16, 36);
      pixRect(ix + iw - 32, iy + ih * 0.54, 16, 36);
      ctx.fillStyle = "#507868";
      pixRect(ix + iw / 2 - 20, iy + ih * 0.28, 40, 12);
      ctx.globalAlpha = 1;
      return;
    }

    if (/kitchen/.test(key)) {
      /* counter top + stools + mugs */
      ctx.fillStyle = "#aa8c5c";
      pixRect(ix + 16, iy + ih * 0.48, iw - 32, 24);
      ctx.fillStyle = "#507858";
      pixRect(ix + 24, iy + ih - 56, 28, 28);
      pixRect(ix + iw - 52, iy + ih - 56, 28, 28);
      ctx.fillStyle = "#a86038";
      pixRect(ix + 44, iy + ih * 0.34, 8, 8);
      pixRect(ix + iw - 52, iy + ih * 0.34, 8, 8);
      ctx.globalAlpha = 1;
      return;
    }

    if (/ops|control|back_room/.test(key)) {
      /* server racks (fitted to actual room size) + console */
      const rackW = Math.min(40, (iw - 60) / 3);
      const rackH = Math.min(ih - 64, 80);
      ctx.fillStyle = "#4a5860";
      pixRect(ix + 12, iy + ih - rackH - 12, rackW, rackH);
      pixRect(ix + iw - rackW - 12, iy + ih - rackH - 12, rackW, rackH);
      /* console bar */
      ctx.fillStyle = "#182838";
      const consW = Math.max(32, iw - rackW * 2 - 48);
      pixRect(ix + (iw - consW) / 2, iy + ih - 40, consW, 24);
      /* blinking lights */
      ctx.fillStyle = "#409898";
      pixRect(ix + 20, iy + ih - rackH + 8, 16, 8);
      pixRect(ix + iw - rackW, iy + ih - rackH + 28, 16, 8);
      ctx.globalAlpha = 1;
      return;
    }

    if (/quiet|study|side_room/.test(key)) {
      /* bookshelf + reading desk + lamp */
      ctx.fillStyle = "#8a5828";
      pixRect(ix + 24, iy + ih - 56, 80, 32);
      ctx.fillStyle = "#507048";
      pixRect(ix + iw - 52, iy + ih * 0.48, 24, 48);
      ctx.fillStyle = "#a89058";
      pixRect(ix + 40, iy + ih * 0.48, 40, 16);
      ctx.globalAlpha = 1;
      return;
    }

    /* fallback */
    ctx.fillStyle = "#a88858";
    pixRect(ix + 32, iy + ih * 0.58, iw - 64, 36);
    ctx.fillStyle = "#507048";
    pixRect(ix + iw - 52, iy + ih - 56, 24, 44);
    ctx.globalAlpha = 1;
  }

  /* ── Text wrapping ─────────────────────────────────── */

  function wrapText(text, maxWidth, font) {
    ctx.font = font;
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(next).width <= maxWidth || !cur) {
        cur = next;
      } else {
        lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 10);
  }

  /* ── Speech bubble ─────────────────────────────────── */

  function drawSpeechBubble(agent) {
    if (!agent.speech || agent.speechUntil <= performance.now()) return;

    const ax = agent.x;
    const ay = agent.y - 54;
    const layout = roomAgentLayout(agent);
    const font = `bold 12px ${RETRO_FONT}`;
    const padX = 8;
    const padY = 8;
    const maxW = 212;
    const lineH = 16;
    const lines = wrapText(agent.speech, maxW, font);

    ctx.font = font;
    const textW = Math.max(...lines.map((line) => ctx.measureText(line).width));
    const w = Math.min(maxW + padX * 2, textW + padX * 2 + 4);
    const h = lines.length * lineH + padY * 2;
    const bx = clamp(ax - w / 2 + layout.offsetX, 12, WORLD_WIDTH - w - 12);
    const by = clamp(ay - h - 12, 18, WORLD_HEIGHT - h - 18);
    const tailX = clamp(ax, bx + 14, bx + w - 14);

    ctx.fillStyle = "#fff5d8";
    pixRect(bx, by, w, h);
    ctx.strokeStyle = "#5f4021";
    ctx.lineWidth = 2;
    pixStrokeRect(bx, by, w, h);

    ctx.fillStyle = "#5f4021";
    pixRect(tailX - 4, by + h, 8, 6);
    pixRect(tailX - 2, by + h + 6, 4, 6);

    ctx.fillStyle = "#d65135";
    pixRect(bx + 6, by + 6, w - 12, 4);

    ctx.fillStyle = "#2e1f12";
    ctx.font = font;
    lines.forEach((line, i) => {
      ctx.fillText(line, bx + padX, by + padY + 12 + i * lineH);
    });
  }

  /* ── Thought bubble ────────────────────────────────── */

  function drawThoughtBubble(agent) {
    const ax = agent.x;
    const ay = agent.y - 56;
    const layout = roomAgentLayout(agent);
    const font = `italic 12px ${RETRO_FONT}`;
    const padX = 8;
    const padY = 8;
    const maxW = 220;
    const lineH = 16;
    const lines = wrapText(agent.thought, maxW, font);

    ctx.font = font;
    const textW = Math.max(...lines.map((line) => ctx.measureText(line).width));
    const w = Math.min(maxW + padX * 2, textW + padX * 2 + 4);
    const h = lines.length * lineH + padY * 2;
    const bx = clamp(ax - w / 2 + layout.offsetX, 12, WORLD_WIDTH - w - 12);
    const by = clamp(ay - h - 24, 18, WORLD_HEIGHT - h - 18);

    ctx.fillStyle = "rgba(246, 230, 191, 0.96)";
    pixRect(bx, by, w, h);
    ctx.strokeStyle = "#5f4021";
    ctx.lineWidth = 2;
    pixStrokeRect(bx, by, w, h);

    const startX = clamp(ax, bx + 16, bx + w - 16);
    const startY = by + h;
    const endX = ax;
    const endY = ay;
    ctx.fillStyle = "rgba(248, 240, 224, 0.95)";
    ctx.strokeStyle = "#b89878";
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 3; i++) {
      const t = (i + 1) / 4;
      const dotX = startX + (endX - startX) * t;
      const dotY = startY + (endY - startY) * t;
      const r = 5.5 - i * 1.5;
      ctx.beginPath();
      ctx.arc(dotX, dotY, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    /* text */
    ctx.fillStyle = "#3d2b1a";
    ctx.font = font;
    lines.forEach((line, i) => {
      ctx.fillText(line, bx + padX, by + padY + 12 + i * lineH);
    });
  }

  /* ── Agent sprites – 8-bit pixel-art style ─────────── */

  function drawAgent(agent) {
    const isSelected = appState.selectedAgentId === agent.id;

    /* lerp position */
    if (!appState.activeConversation || !appState.activeConversation.participants.includes(agent.id)) {
      agent.x += (agent.targetX - agent.x) * 0.1;
      agent.y += (agent.targetY - agent.y) * 0.1;
    }

    const cx = Math.round(agent.x);
    const cy = Math.round(agent.y);
    const col = agent.color;

    /* --- selection: soft pulsing disc under agent --- */
    if (isSelected) {
      const pulse = 0.85 + Math.sin(performance.now() / 400) * 0.15;
      ctx.save();
      ctx.globalAlpha = 0.28 * pulse;
      ctx.fillStyle = "#f0d060";
      ctx.beginPath();
      ctx.ellipse(cx, cy + 2, 24 * pulse, 12 * pulse, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      /* crisp ring */
      ctx.strokeStyle = "#e0c040";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy + 2, 22, 10, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "#fff4bf";
      pixRect(cx - 4, cy - 38, 8, 8);
      pixRect(cx - 2, cy - 46, 4, 8);
      ctx.restore();
    }

    /* --- shadow on ground --- */
    ctx.fillStyle = "rgba(46, 31, 18, 0.18)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + 16, 12, 4, 0, 0, Math.PI * 2);
    ctx.fill();

    /* --- body (pixel rectangle) --- */
    const bw = 18;
    const bh = 22;
    const bx = cx - bw / 2;
    const by = cy - 4;

    ctx.fillStyle = col;
    pixRect(bx, by, bw, bh);

    /* body highlight left strip */
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    pixRect(bx, by, 4, bh);

    /* body dark right strip */
    ctx.fillStyle = "rgba(0,0,0,0.10)";
    pixRect(bx + bw - 4, by, 4, bh);

    /* --- head (pixel square with rounded feel) --- */
    const hw = 20;
    const hh = 18;
    const hx = cx - hw / 2;
    const hy = by - hh + 4;

    ctx.fillStyle = col;
    pixRect(hx, hy, hw, hh);

    /* head highlight */
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    pixRect(hx, hy, 4, hh);

    /* --- face --- */
    /* eyes - 2x2 pixel white */
    ctx.fillStyle = "#ffffff";
    pixRect(cx - 5, hy + 7, 4, 4);
    pixRect(cx + 2, hy + 7, 4, 4);

    /* pupils - 2x2 pixel dark */
    ctx.fillStyle = "#1a0e06";
    pixRect(cx - 4, hy + 8, 2, 2);
    pixRect(cx + 3, hy + 8, 2, 2);

    /* mouth */
    const isSpeaking = agent.speech && agent.speechUntil > performance.now();
    if (isSpeaking) {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      pixRect(cx - 2, hy + 13, 5, 3);
    } else {
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      pixRect(cx - 2, hy + 14, 5, 2);
    }

    /* --- name label --- */
    ctx.font = `bold 11px ${RETRO_FONT}`;
    const labelWidth = Math.ceil(ctx.measureText(agent.name).width) + 12;
    const labelX = cx - Math.round(labelWidth / 2);
    const labelY = cy + bh + 6;
    ctx.fillStyle = "rgba(245, 239, 224, 0.92)";
    pixRect(labelX, labelY - 10, labelWidth, 14);
    ctx.strokeStyle = "rgba(46, 31, 18, 0.28)";
    ctx.lineWidth = 1;
    pixStrokeRect(labelX, labelY - 10, labelWidth, 14);

    ctx.fillStyle = "#2e1f12";
    ctx.textAlign = "center";
    ctx.fillText(agent.name, cx, cy + bh + 7);
    ctx.textAlign = "left";
  }

  function drawConversationLink() {
    const conversation = appState.activeConversation;
    if (!conversation) return;

    const participants = conversation.participants
      .map((id) => appState.agents.find((agent) => agent.id === id))
      .filter(Boolean);

    if (participants.length < 2) return;

    const [left, right] = participants;
    const pulse = Math.floor(performance.now() / 180) % 2;
    const minX = Math.min(left.x, right.x);
    const width = Math.abs(right.x - left.x);
    const y = Math.round((left.y + right.y) / 2) - 22;

    ctx.fillStyle = "#fff0a6";
    pixRect(minX, y, width, 6);
    ctx.fillStyle = pulse ? "#d84f31" : "#2f9674";
    for (let x = minX + (pulse ? 0 : 8); x < minX + width; x += 16) {
      pixRect(x, y, 8, 6);
    }
  }

  function drawWorldFrame() {
    ctx.strokeStyle = "rgba(61, 38, 12, 0.42)";
    ctx.lineWidth = 8;
    pixStrokeRect(4, 4, WORLD_WIDTH - 8, WORLD_HEIGHT - 8);
    ctx.strokeStyle = "rgba(255, 244, 208, 0.55)";
    ctx.lineWidth = 2;
    pixStrokeRect(12, 12, WORLD_WIDTH - 24, WORLD_HEIGHT - 24);
  }

  /* ── Main render ───────────────────────────────────── */

  function renderWorld() {
    syncCanvasResolution();
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    drawBackdrop();
    drawConnectors();

    appState.rooms.forEach(drawRoom);
    drawConversationLink();

    const speaking = appState.agents.filter((agent) => agent.speech && agent.speechUntil > performance.now());
    const notSpeaking = appState.agents.filter((agent) => !speaking.includes(agent));

    notSpeaking.forEach(drawAgent);
    speaking.forEach(drawAgent);
    speaking.forEach(drawSpeechBubble);

    const focused = selectedAgent();
    if (focused) {
      drawThoughtBubble(focused);
    }

    drawWorldFrame();
  }

  function captureScreenshot() {
    const link = document.createElement("a");
    link.download = `gestalt-village-tick-${appState.tick}.png`;
    link.href = elements.canvas.toDataURL("image/png");
    link.click();
  }

  function agentAtPosition(offsetX, offsetY) {
    const bounds = elements.canvas.getBoundingClientRect();
    const sx = WORLD_WIDTH / bounds.width;
    const sy = WORLD_HEIGHT / bounds.height;
    const x = offsetX * sx;
    const y = offsetY * sy;
    return appState.agents.find(a => Math.abs(a.x - x) < 16 && Math.abs(a.y - y) < 24) || null;
  }

  return {
    roomCenter,
    syncCanvasResolution,
    roomAnchor,
    conversationAnchors,
    renderWorld,
    captureScreenshot,
    agentAtPosition
  };
}
