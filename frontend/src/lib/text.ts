export type NoteView = "cleaned" | "original" | "summary" | "clinical";

export function cleanTranscript(raw: string): string {
  return raw
    .replace(/\b(um+|uh+|erm|hmm)\b[,\s]*/gi, "")
    .replace(/\b(you know|i mean)\b[,\s]*/gi, "")
    .replace(/\b(\w+)(?:[ \t]+\1\b)+/gi, "$1")
    .replace(/[ \t]+/g, " ")
    .replace(/ +([,.!?;:])/g, "$1")
    .replace(/([,.!?;:])(?=[A-Za-z])/g, "$1 ")
    .replace(
      /(^|[.!?]\s+)([a-z])/g,
      (_, before: string, letter: string) => before + letter.toUpperCase(),
    )
    .replace(/\bi\b/g, "I")
    .trim();
}

export function sentences(text: string): string[] {
  return (
    text
      .match(/[^.!?]+(?:[.!?]+|$)/g)
      ?.map((s) => s.trim())
      .filter(Boolean) ?? []
  );
}

// Extractive by design: these are the speaker's sentences, never invented facts.
export function summarize(raw: string): {
  highlights: string[];
  actions: string[];
} {
  const items = sentences(cleanTranscript(raw));
  const actions = items.filter((s) =>
    /\b(need to|next step|will|let's|let us|action|follow up|by (?:monday|tuesday|wednesday|thursday|friday)|going to|remember to)\b/i.test(
      s,
    ),
  );
  return {
    highlights: items.filter((s) => !actions.includes(s)).slice(0, 3),
    actions: actions.slice(0, 5),
  };
}

export function structuredNote(raw: string): string {
  return `Clinical note draft\n\nDictated content\n${cleanTranscript(raw)}\n\nChief concern: Not assigned automatically.\nSubjective / Objective / Assessment / Plan: Review the dictated content and assign sections manually.\n\nThis tool only removes fillers and formats text. No diagnoses or clinical facts are inferred. Clinician review required.`;
}

export function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(safe / 60)
    .toString()
    .padStart(2, "0")}:${(safe % 60).toString().padStart(2, "0")}`;
}

export function exportText(title: string, raw: string, view: NoteView): string {
  if (view === "summary") {
    const { highlights, actions } = summarize(raw);
    return `${title}\n\nKey takeaways\n${highlights.map((s) => `• ${s}`).join("\n") || "No takeaways found."}\n\nAction items\n${actions.map((s) => `• ${s}`).join("\n") || "No explicit action items found."}`;
  }
  return `${title}\n\n${view === "clinical" ? structuredNote(raw) : view === "cleaned" ? cleanTranscript(raw) : raw}`;
}
