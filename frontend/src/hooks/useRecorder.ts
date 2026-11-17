import { useEffect, useRef, useState } from "react";
import { MAX_AUDIO_SECONDS } from "../lib/audio";

export function useRecorder(
  onFile: (file: File) => void,
  onError: (message: string) => void,
) {
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval>>();
  const mounted = useRef(true);
  const callbacks = useRef({ onFile, onError });
  callbacks.current = { onFile, onError };
  const release = () => {
    clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (recorder.current) {
        recorder.current.onstop = null;
        if (recorder.current.state !== "inactive") recorder.current.stop();
      }
      release();
    };
  }, []);
  const stop = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  };
  const start = async () => {
    if (recording || requesting) return;
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      callbacks.current.onError(
        "Recording needs HTTPS and a browser that supports microphone access. You can still upload an audio file.",
      );
      return;
    }
    setRequesting(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      const mimeType = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      const next = new MediaRecorder(
        media,
        mimeType ? { mimeType } : undefined,
      );
      const chunks: BlobPart[] = [];
      next.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      next.onstop = () => {
        release();
        setRecording(false);
        const type = next.mimeType || mimeType || "audio/webm";
        const extension = type.includes("mp4")
          ? "m4a"
          : type.includes("ogg")
            ? "ogg"
            : "webm";
        const file = new File(
          chunks,
          `Voice note ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }).replace(":", "-")}.${extension}`,
          { type },
        );
        if (file.size) callbacks.current.onFile(file);
        else
          callbacks.current.onError("No audio was recorded. Please try again.");
      };
      next.onerror = () => {
        next.onstop = null;
        release();
        setRecording(false);
        callbacks.current.onError(
          "The microphone disconnected. Please try recording again.",
        );
      };
      recorder.current = next;
      next.start(250);
      setSeconds(0);
      setRecording(true);
      const started = Date.now();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed);
        if (elapsed >= MAX_AUDIO_SECONDS) stop();
      }, 250);
    } catch (error) {
      release();
      callbacks.current.onError(
        error instanceof DOMException && error.name === "NotAllowedError"
          ? "Microphone access was denied. Allow access in your browser, or upload a file."
          : "Could not open your microphone. Check that it is connected and try again.",
      );
    } finally {
      if (mounted.current) setRequesting(false);
    }
  };
  return { recording, requesting, seconds, start, stop };
}
