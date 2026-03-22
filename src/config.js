export const MODEL_CONFIG = {
  reasoning: {
    key: "reasoning",
    label: "Simulation model",
    shortLabel: "Nemotron 3 Nano",
    model: "onnx-community/NVIDIA-Nemotron-3-Nano-4B-BF16-ONNX",
    approxSize: "4B q4 WebGPU",
    device: "webgpu",
    dtype: "q4"
  }
};

export const DEFAULT_PROMPT = "A small fintech startup. Maya is the CTO - principled, quietly worried about technical debt. Jordan runs sales - charismatic, prone to overpromising. Priya handles compliance - meticulous, suspects Jordan is cutting corners. Sam is the intern - eager, observant, talks to everyone.";

export const ROOM_LAYOUTS = [
  { x: 1, y: 1, w: 5, h: 4 },
  { x: 7, y: 1, w: 4, h: 4 },
  { x: 1, y: 6, w: 4, h: 3 },
  { x: 6, y: 6, w: 3, h: 3 },
  { x: 10, y: 6, w: 3, h: 3 }
];
