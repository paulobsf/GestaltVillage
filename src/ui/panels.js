export function createPanelsApi({
  appState,
  elements,
  getAgent,
  selectedAgent,
  conversationParticipants,
  slugLabel,
  syncControls
}) {
  function setElementText(element, value) {
    if (element) {
      element.textContent = value;
    }
  }

  function agentStatusSummary(agent) {
    if (appState.activeConversation?.participants.includes(agent.id)) {
      return {
        title: "In conversation",
        detail: `${slugLabel(agent.currentRoom)} - ${appState.activeConversation.topic}`
      };
    }
    if (agent.speech && agent.speechUntil > performance.now()) {
      return {
        title: "Speaking",
        detail: `${slugLabel(agent.currentRoom)} - live line on screen`
      };
    }
    if (agent.lastActionSummary.startsWith("move to")) {
      return {
        title: "Repositioning",
        detail: `${slugLabel(agent.currentRoom)} - ${agent.lastActionSummary}`
      };
    }
    if (agent.lastActionSummary.startsWith("talk to")) {
      return {
        title: "Seeking contact",
        detail: `${slugLabel(agent.currentRoom)} - ${agent.lastActionSummary}`
      };
    }
    return {
      title: "Reading the room",
      detail: `${slugLabel(agent.currentRoom)} - ${agent.lastActionSummary}`
    };
  }

  function agentPressureSummary(agent) {
    const lowTrust = Object.entries(agent.relationships)
      .sort(([, left], [, right]) => left.trust - right.trust)[0];
    if (!lowTrust) {
      return "No active friction";
    }
    const other = getAgent(lowTrust[0]);
    return `${other?.name || lowTrust[0]} trust ${lowTrust[1].trust}/10`;
  }

  function pressureClass(agent) {
    const lowTrust = Math.min(...Object.values(agent.relationships).map((relationship) => relationship.trust), 10);
    if (lowTrust <= 3) return "trust-low";
    if (lowTrust <= 5) return "trust-mid";
    return "";
  }

  function relationshipRiskClass(relationship) {
    if (relationship.trust <= 3) return "relationship-high-risk";
    if (relationship.trust <= 5) return "relationship-medium-risk";
    return "";
  }

  function relationshipRiskLabel(relationship) {
    if (relationship.trust <= 3) return { text: "high friction", className: "risk-chip high" };
    if (relationship.trust <= 5) return { text: "watch closely", className: "risk-chip mid" };
    return { text: "stable", className: "risk-chip" };
  }

  function renderTelemetry() {
    const activeConversation = appState.activeConversation;
    const activeNames = activeConversation
      ? conversationParticipants(activeConversation).map((agent) => agent.name).join(" <> ")
      : "No active scene";
    const modelState = appState.models.reasoning;

    setElementText(elements.telemetryModelSummary, modelState.ready
      ? `${modelState.shortLabel} ready`
      : modelState.error
        ? `${modelState.shortLabel} error`
        : `${modelState.shortLabel} ${modelState.progress}%`);
    setElementText(elements.telemetryModelDetail, `${appState.networkRequests} requests - ${appState.telemetry.counts.errors} client errors`);
    setElementText(elements.telemetryRuntimeSummary, `Tick ${appState.tick}`);
    setElementText(elements.telemetryRuntimeDetail, activeNames);
    setElementText(elements.telemetryConversationSummary, `${appState.telemetry.counts.conversation} conversations`);
    setElementText(elements.telemetryConversationDetail, appState.telemetry.lastLatency.conversation === null
      ? `repeat guard ${appState.telemetry.repeatedConversationCount}/${appState.telemetry.blockedConversationCount}`
      : `last ${appState.telemetry.lastLatency.conversation} ms - repeat guard ${appState.telemetry.repeatedConversationCount}/${appState.telemetry.blockedConversationCount}`);

    if (activeConversation) {
      const speaker = getAgent(activeConversation.nextSpeakerId);
      elements.telemetryActiveSceneCard?.classList.remove("hidden");
      setElementText(elements.telemetryActiveSceneTitle, activeNames);
      setElementText(
        elements.telemetryActiveSceneDetail,
        `${activeConversation.topic} - ${activeConversation.turns.length} turns so far - next: ${speaker?.name || "unknown"}`
      );
    } else {
      elements.telemetryActiveSceneCard?.classList.add("hidden");
    }

    setElementText(elements.telemetryReflectionCount, `${appState.telemetry.counts.reflection} reflections`);
    setElementText(elements.telemetryConversationCount, `${appState.telemetry.counts.conversation} conversations`);
    setElementText(elements.telemetryMemoryCount, `${appState.telemetry.counts.memory} memory writes`);
    setElementText(elements.telemetryReflectionLatency, appState.telemetry.lastLatency.reflection === null
      ? "reflection -"
      : `reflection ${appState.telemetry.lastLatency.reflection} ms`);
    setElementText(elements.telemetryConversationLatency, appState.telemetry.lastLatency.conversation === null
      ? "conversation -"
      : `conversation ${appState.telemetry.lastLatency.conversation} ms`);
    setElementText(elements.telemetryMemoryLatency, appState.telemetry.lastLatency.memory === null
      ? "memory -"
      : `memory ${appState.telemetry.lastLatency.memory} ms`);
    setElementText(elements.telemetryRepeatCount, `${appState.telemetry.repeatedConversationCount} repeats / ${appState.telemetry.blockedConversationCount} blocked`);
    setElementText(elements.telemetryErrorCount, `${appState.telemetry.counts.errors} client errors`);
    setElementText(elements.telemetryLiveSpeaker, appState.telemetry.liveBubble.speaker);
    setElementText(elements.telemetryLiveText, appState.telemetry.liveBubble.text);

    if (!elements.telemetryStream) {
      return;
    }

    if (elements.promptTraceStream) {
      elements.promptTraceStream.innerHTML = "";
      if (appState.telemetry.promptTraces.length === 0) {
        const empty = document.createElement("article");
        empty.className = "telemetry-event";
        empty.textContent = "Conversation and office prompt traces appear here when debug-worthy model calls run.";
        elements.promptTraceStream.appendChild(empty);
      }

      appState.telemetry.promptTraces.forEach((trace) => {
        const node = document.createElement("article");
        node.className = `telemetry-event ${trace.accepted ? "" : "telemetry-event-warning"}`.trim();

        const title = document.createElement("strong");
        title.textContent = `${trace.kind} - tick ${trace.tick}`;

        const prompt = document.createElement("pre");
        prompt.className = "prompt-trace-copy";
        prompt.textContent = trace.prompt;

        const result = document.createElement("pre");
        result.className = "prompt-trace-copy prompt-trace-result";
        result.textContent = trace.error
          ? `ERROR\n${trace.error}`
          : `RAW\n${trace.response || ""}${trace.parsed ? `\n\nPARSED\n${trace.parsed}` : ""}`;

        node.append(title, prompt, result);
        elements.promptTraceStream.appendChild(node);
      });
    }

    elements.telemetryStream.innerHTML = "";
    appState.telemetry.events.forEach((event) => {
      const node = document.createElement("article");
      node.className = `telemetry-event telemetry-event-${event.level}`;
      const title = document.createElement("strong");
      title.textContent = event.title;
      const detail = document.createElement("span");
      detail.textContent = event.detail;
      const meta = document.createElement("small");
      meta.textContent = `tick ${event.tick}`;
      node.append(title, detail, meta);
      elements.telemetryStream.appendChild(node);
    });
  }

  function pushTelemetry(level, title, detail) {
    if (level === "info" && !/ready|error|failed|started|ended|wrapped|stalled|aborted|World generated|You ->/.test(title)) {
      return;
    }

    appState.telemetry.events.unshift({
      id: ++appState.telemetrySequence,
      tick: appState.tick,
      level,
      title,
      detail
    });
    appState.telemetry.events = appState.telemetry.events.slice(0, 10);
    renderTelemetry();
  }

  function recordCounter(kind) {
    if (!(kind in appState.telemetry.counts)) {
      return;
    }
    appState.telemetry.counts[kind] += 1;
    renderTelemetry();
  }

  function recordError(title, error) {
    appState.telemetry.counts.errors += 1;
    pushTelemetry("error", title, error.message || String(error));
    renderTelemetry();
  }

  function renderInspector() {
    const agent = selectedAgent();
    if (!agent) {
      elements.inspectorEmpty.classList.remove("hidden");
      elements.inspectorContent.classList.add("hidden");
      syncControls();
      return;
    }

    elements.inspectorEmpty.classList.add("hidden");
    elements.inspectorContent.classList.remove("hidden");
    elements.agentBadge.style.background = agent.color;
    elements.agentName.textContent = agent.name;
    elements.agentRole.textContent = `${agent.role} - ${slugLabel(agent.currentRoom)}`;

    const status = agentStatusSummary(agent);
    elements.agentStatusCard.className = "summary-card";
    elements.agentFocusCard.className = "summary-card active";
    elements.agentPressureCard.className = `summary-card ${pressureClass(agent)}`.trim();
    if (status.title === "In conversation" || status.title === "Speaking") {
      elements.agentStatusCard.classList.add("active");
    }

    elements.agentStatus.textContent = status.title;
    elements.agentStatusDetail.textContent = status.detail;
    elements.agentGoalTitle.textContent = agent.goal.split(/[.!?]/)[0];
    elements.agentPressureTitle.textContent = agentPressureSummary(agent);
    elements.agentThought.textContent = agent.thought;
    elements.agentGoal.textContent = agent.goal;
    elements.agentPersonality.textContent = agent.personality;
    elements.agentSecret.textContent = agent.secret;

    if (agent.speech && agent.speechUntil > performance.now()) {
      elements.agentSpeechSection.classList.remove("hidden");
      elements.agentSpeech.textContent = agent.speech;
    } else {
      elements.agentSpeechSection.classList.add("hidden");
      elements.agentSpeech.textContent = "";
    }

    elements.agentDiagnostics.innerHTML = "";
    [
      agent.lastDecisionLatencyMs === null ? "decision latency pending" : `decision latency ${agent.lastDecisionLatencyMs} ms`,
      `last action ${agent.lastActionSummary}`,
      agent.speechLatencyMs === null ? "speech latency pending" : `speech latency ${agent.speechLatencyMs} ms`,
      `memory count ${agent.memories.length}`
    ].forEach((line) => {
      const item = document.createElement("article");
      item.textContent = line;
      elements.agentDiagnostics.appendChild(item);
    });

    elements.relationshipList.innerHTML = "";
    Object.entries(agent.relationships)
      .sort(([, left], [, right]) => left.trust - right.trust || right.rapport - left.rapport)
      .slice(0, 3)
      .forEach(([otherId, relationship]) => {
        const other = getAgent(otherId);
        const item = document.createElement("article");
        const riskClass = relationshipRiskClass(relationship);
        const riskLabel = relationshipRiskLabel(relationship);
        if (riskClass) {
          item.classList.add(riskClass);
        }
        item.innerHTML = `<span class="${riskLabel.className}">${riskLabel.text}</span><strong>${other?.name || otherId}</strong><br><small>trust ${relationship.trust}/10 - rapport ${relationship.rapport}/10</small><p>${relationship.notes}</p>`;
        elements.relationshipList.appendChild(item);
      });

    elements.memoryList.innerHTML = "";
    if (agent.memories.length === 0) {
      const item = document.createElement("article");
      item.textContent = "No significant memories yet.";
      elements.memoryList.appendChild(item);
    } else {
      agent.memories.slice(0, 4).forEach((memory) => {
        const item = document.createElement("article");
        item.innerHTML = `<strong>${memory.type}</strong><br><small>tick ${memory.timestamp} - ${memory.sentiment} - importance ${memory.importance}/10${typeof memory.latencyMs === "number" ? ` - ${memory.latencyMs} ms` : ""}</small><p>${memory.summary}</p>`;
        elements.memoryList.appendChild(item);
      });
    }

    syncControls();
  }

  return {
    pushTelemetry,
    recordCounter,
    recordError,
    renderTelemetry,
    renderInspector
  };
}
