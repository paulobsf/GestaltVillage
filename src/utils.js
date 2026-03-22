export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function slugLabel(value) {
  return value
    .split(/[_\s]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function approximateTokens(text) {
  return Math.max(1, Math.ceil(String(text || "").length / 4));
}

export function pairKey(leftId, rightId) {
  return [leftId, rightId].sort().join(":");
}
