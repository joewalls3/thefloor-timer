export function formatTime(ms) {
  const totalSeconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export async function sendAction(action) {
  const response = await fetch("/api/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Action failed");
  }

  return response.json();
}

export function connectToState(onState) {
  const source = new EventSource("/events");
  source.onmessage = event => onState(JSON.parse(event.data));
  source.onerror = () => console.warn("Connection interrupted. Retrying automatically.");
  return source;
}

export function estimateRemaining(state, team) {
  const key = team === "A" ? "remainingA" : "remainingB";
  let remaining = state[key];

  if (state.running && state.activeTeam === team) {
    remaining -= Date.now() - state.serverTime;
  }

  return Math.max(0, remaining);
}
