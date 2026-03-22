export function createAppState(modelConfig) {
  return {
    running: true,
    speed: 1,
    selectedAgentId: null,
    tick: 0,
    tokens: 0,
    networkRequests: 0,
    logMode: "latest",
    world: null,
    agents: [],
    rooms: [],
    roomLookup: {},
    recentEvents: [],
    activeConversation: null,
    directChatInFlight: false,
    tickInFlight: false,
    lastTickAt: 0,
    rpcSequence: 0,
    appUnlocked: false,
    promptExpanded: true,
    modelLoadPromise: null,
    loadProgressPercent: null,
    pairCooldowns: new Map(),
    pending: new Map(),
    countedDownloads: new Set(),
    downloadProgress: new Map(),
    telemetrySequence: 0,
    models: {
      reasoning: {
        ...modelConfig.reasoning,
        progress: 0,
        ready: false,
        error: false,
        stage: "idle",
        message: "Queued"
      }
    },
    telemetry: {
      counts: {
        world: 0,
        reflection: 0,
        conversation: 0,
        memory: 0,
        errors: 0
      },
      lastLatency: {
        world: null,
        reflection: null,
        conversation: null,
        memory: null
      },
      repeatedConversationCount: 0,
      blockedConversationCount: 0,
      recentConversationSignatures: [],
      promptTraces: [],
      liveBubble: {
        speaker: "No active speech",
        text: "The full current speech line appears here."
      },
      events: []
    }
  };
}
