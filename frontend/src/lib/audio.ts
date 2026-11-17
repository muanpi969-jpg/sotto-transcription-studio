export const MAX_AUDIO_MB = 40;
export const MAX_AUDIO_SECONDS = 600;

export function validateAudio(file: File): void {
  if (!file.size)
    throw new Error(
      "This file is empty. Choose an audio file with some sound.",
    );
  if (file.size > MAX_AUDIO_MB * 1024 * 1024)
    throw new Error(`Choose a file smaller than ${MAX_AUDIO_MB} MB.`);
  if (
    !file.type.startsWith("audio/") &&
    !/\.(wav|mp3|m4a|mp4|ogg|webm|flac|aac)$/i.test(file.name)
  ) {
    throw new Error("Choose an audio file: MP3, WAV, M4A, OGG, FLAC, or WebM.");
  }
}

export async function decodeAudio(
  file: File,
): Promise<{ samples: Float32Array; duration: number }> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await file.arrayBuffer());
    if (decoded.duration > MAX_AUDIO_SECONDS)
      throw new Error(
        "Keep recordings under 10 minutes for reliable on-device processing.",
      );
    if (decoded.duration < 0.2)
      throw new Error("This audio is too short to transcribe.");
    const offline = new OfflineAudioContext(
      1,
      Math.ceil(decoded.duration * 16000),
      16000,
    );
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    const samples = rendered.getChannelData(0).slice();
    if (!samples.some((s) => Math.abs(s) > 0.002))
      throw new Error(
        "This recording appears to be silent. Try recording closer to the microphone.",
      );
    return { samples, duration: decoded.duration };
  } catch (error) {
    if (error instanceof DOMException)
      throw new Error(
        "Your browser could not decode this file. Try an MP3 or WAV file.",
      );
    throw error;
  } finally {
    await context.close();
  }
}
