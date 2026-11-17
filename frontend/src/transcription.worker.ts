import {
  env,
  pipeline,
  type AutomaticSpeechRecognitionPipeline,
} from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;
// One WASM thread works on static hosts without cross-origin isolation headers.
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.numThreads = 1;
  env.backends.onnx.wasm.wasmPaths = `${self.location.origin}/ort/`;
}

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
const downloads = new Map<string, { loaded: number; total: number }>();

self.onmessage = async (event: MessageEvent<{ audio: Float32Array }>) => {
  try {
    if (!transcriber) {
      transcriber = await pipeline<"automatic-speech-recognition">(
        "automatic-speech-recognition",
        "onnx-community/whisper-tiny.en",
        {
          device: "wasm",
          dtype: "q8",
          progress_callback: (progress) => {
            if (progress.status === "progress") {
              downloads.set(progress.file, {
                loaded: progress.loaded,
                total: progress.total,
              });
              const values = [...downloads.values()];
              const loaded = values.reduce((sum, p) => sum + p.loaded, 0);
              const total = values.reduce((sum, p) => sum + p.total, 0);
              self.postMessage({
                status: "downloading",
                progress: total ? Math.round((loaded / total) * 100) : 0,
              });
            }
          },
        },
      );
    }
    self.postMessage({ status: "transcribing" });
    const result = await transcriber(event.data.audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    });
    const output = Array.isArray(result) ? result[0] : result;
    self.postMessage({ status: "complete", text: output.text.trim() });
  } catch (error) {
    // Recreate a failed model on retry instead of retaining a rejected pipeline.
    transcriber = null;
    self.postMessage({
      status: "error",
      message: error instanceof Error ? error.message : "Transcription failed.",
    });
  }
};
