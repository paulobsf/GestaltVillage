export function createLogApi({ appState, elements }) {
  function syncLogMode() {
    elements.logLatestButton.classList.toggle("active", appState.logMode === "latest");
    elements.logFullButton.classList.toggle("active", appState.logMode === "full");

    const entries = Array.from(elements.conversationLog.children);
    entries.forEach((entry, index) => {
      entry.classList.toggle("log-entry-hidden", appState.logMode === "latest" && index >= 4);
    });
  }

  function addLogEntry(title, text, options = {}) {
    const node = elements.template.content.firstElementChild.cloneNode(true);
    const metaBits = [`tick ${appState.tick}`];
    if (options.tag) {
      metaBits.push(options.tag);
    }
    if (typeof options.latencyMs === "number") {
      metaBits.push(`${options.latencyMs} ms`);
    }
    if (options.repeated) {
      metaBits.push("repeat detected");
    }
    node.querySelector(".log-meta").textContent = metaBits.join(" - ");

    const body = node.querySelector(".log-body");
    const heading = document.createElement("div");
    heading.className = "log-title";
    heading.textContent = title;
    body.appendChild(heading);

    if (text) {
      const subtitle = document.createElement("p");
      subtitle.className = "log-subtitle";
      subtitle.textContent = text;
      body.appendChild(subtitle);
    }

    if (Array.isArray(options.lines) && options.lines.length > 0) {
      options.lines.forEach((line, index) => {
        const lineNode = document.createElement("div");
        const alignsRight = line.speakerName === "You" || index % 2 === 1;
        lineNode.className = `transcript-line ${alignsRight ? "transcript-line-right" : "transcript-line-left"}`;
        const speaker = document.createElement("strong");
        speaker.textContent = `${line.speakerName}:`;
        const content = document.createElement("span");
        content.textContent = line.text;
        lineNode.append(speaker, content);
        body.appendChild(lineNode);
      });
    }

    elements.conversationLog.prepend(node);
    syncLogMode();
  }

  return {
    syncLogMode,
    addLogEntry
  };
}
