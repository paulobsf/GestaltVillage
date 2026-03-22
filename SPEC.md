# Gestalt Village

Browser-based local model demo for small-scale generative social simulation.

## Summary

The app takes a short natural-language scenario and turns it into a small pixel-art environment with a few agents. Those agents move between rooms, hold short conversations, accumulate lightweight memories, and expose their current state through an inspector.

This project borrows a few ideas from multi-agent orchestration patterns:

- distinct personas with different goals
- local memory influencing later behavior
- conversations that can change trust and rapport

It is not meant to be a general platform or a big framework demo. It is a local model proof of concept that should be easy to run, easy to understand, and visually legible.

## Product Goals

- Show that a small multi-agent social simulation can run fully in the browser
- Keep everything local after model download
- Make the simulation readable at a glance: who is talking, who is under pressure, what changed
- Let people try scenarios quickly without setup complexity
- Produce short, screen-recordable moments that feel alive

## User Experience

### Input

One prompt box.

Example:

> A small fintech startup. Maya is the CTO - principled, quietly worried about technical debt. Jordan runs sales - charismatic, prone to overpromising. Priya handles compliance - meticulous, suspects Jordan is cutting corners. Sam is the intern - eager, observant, talks to everyone.

### Output

The app generates:

- 4 rooms inferred from the scenario
- 4 agents with names, roles, personalities, goals, and secrets
- initial relationships between agents
- a live world view with movement and conversations
- an inspector for the selected agent
- a conversation log focused on the most recent dialogue

## Simulation Rules

### World generation

- Parse a freeform prompt into a small room layout and a cast of agents
- Keep the world compact and readable
- Prefer recognizable spaces such as studio floor, meeting room, kitchen, and ops room

### Agent loop

Each agent repeatedly:

1. reads the current room and recent events
2. evaluates whether to wait, move, or start a conversation
3. updates memory after meaningful events

### Conversations

- Agents decide who to approach and what to raise
- Once a conversation starts, both agents stop moving
- Dialogue happens turn by turn, not as a prewritten block
- After each utterance, local memory and relationship state update before the next turn
- A conversation can continue or end naturally

### Memory and relationships

- Each agent keeps a short rolling memory list
- Memories have a summary, sentiment, and importance
- Relationship values update based on what agents say and observe
- Trust and rapport should visibly affect later interactions

## UI Priorities

### World view

- Largest visual area on the page
- Simple pixel-art rooms with enough furniture/detail to read as places
- Speech bubbles should be easy to read and stay above scene clutter
- Thought bubbles should only appear for the selected agent

### Agent inspector

Show the selected agent's:

- status
- current thought
- role and personality
- goal and private pressure
- most important relationships
- recent memories
- direct office-chat input

### Telemetry and debug

Default UI should show only useful signals:

- model health
- runtime status
- active conversation state
- current speech

Low-level counters, timings, and raw debug events should stay collapsible.

## Technical Direction

- Static frontend app
- Browser WebGPU model inference via Transformers.js
- Local-first runtime after model download
- Canvas rendering for the world view
- Web Workers for model inference
- In-memory simulation state
- Service worker for static asset caching

## Current Scope

### In scope

- single prompt to generate a world
- 4 agents and 4 rooms
- agent movement
- local conversations
- local office chat with a selected agent
- memory and relationship updates
- readable world view and inspector
- collapsible debug information

### Out of scope for now

- save/load
- branching story tools
- user-triggered world events
- audio
- export workflows
- large maps or dozens of agents

## Success Criteria

- The simulation boots in a browser tab with a local model and no backend
- Agents visibly move, talk, and update relationships
- The world view is readable without needing debug panels
- The inspector quickly explains why an agent is acting the way it is
- The conversation log surfaces actual dialogue rather than low-value system noise
