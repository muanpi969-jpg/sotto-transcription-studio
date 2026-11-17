export type Transcript = {
  id: string;
  title: string;
  raw: string;
  createdAt: number;
  duration: number;
  starred: boolean;
  source: "recording" | "upload" | "example";
};

export const STORAGE_KEY = "sotto.transcripts.v1";
export const MAX_NOTES = 50;

export function loadTranscripts(): Transcript[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(STORAGE_KEY) || "[]",
    );
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (n): n is Transcript =>
          n &&
          typeof n.id === "string" &&
          typeof n.title === "string" &&
          typeof n.raw === "string" &&
          Number.isFinite(n.createdAt) &&
          Number.isFinite(n.duration) &&
          typeof n.starred === "boolean" &&
          ["recording", "upload", "example"].includes(n.source),
      )
      .slice(0, MAX_NOTES);
  } catch {
    return [];
  }
}

export function saveTranscripts(notes: Transcript[]): boolean {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(notes.slice(0, MAX_NOTES)),
    );
    return true;
  } catch {
    return false;
  }
}

export const EXAMPLE: Transcript = {
  id: "sotto-example",
  title: "A little room for a big idea",
  raw: "Okay, so I've been thinking about what makes a really good workspace. Um, it isn't about doing more. It's about having a little room to think.\n\nThe idea is simple: a quiet place to capture a thought before it disappears. Something that feels as natural as a voice note, but gives you something useful to come back to.\n\nWe need to keep the experience focused and make every interaction feel effortless. Let's share the first prototype with the team on Friday.\n\nAnd, you know, the best part? Everything stays right here on your device. Your thoughts should always belong to you.",
  createdAt: 0,
  duration: 48,
  starred: false,
  source: "example",
};
