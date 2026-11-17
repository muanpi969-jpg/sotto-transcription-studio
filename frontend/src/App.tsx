import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Check,
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Clock3,
  Command,
  Copy,
  FileText,
  FolderOpen,
  Headphones,
  LayoutGrid,
  LoaderCircle,
  Menu,
  Mic,
  Moon,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Square,
  Star,
  Sun,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Brand, IconButton, Modal, Segmented, Waveform } from "./components/ui";
import { useRecorder } from "./hooks/useRecorder";
import { decodeAudio, MAX_AUDIO_MB, validateAudio } from "./lib/audio";
import {
  EXAMPLE,
  loadTranscripts,
  MAX_NOTES,
  saveTranscripts,
  type Transcript,
} from "./lib/storage";
import {
  cleanTranscript,
  exportText,
  formatTime,
  structuredNote,
  summarize,
  wordCount,
  type NoteView,
} from "./lib/text";

type Page = "workspace" | "library" | "starred" | "insights";
type Dialog = "settings" | "commands" | "about" | "delete" | null;
type Phase = "idle" | "decoding" | "loading" | "transcribing";
type Theme = "light" | "dark" | "system";
function readTheme(): Theme {
  try {
    const theme = localStorage.getItem("sotto.theme");
    return theme === "dark" || theme === "light" ? theme : "system";
  } catch {
    return "system";
  }
}

export default function App() {
  const [notes, setNotes] = useState(loadTranscripts);
  const [current, setCurrent] = useState<Transcript | null>(EXAMPLE);
  const [page, setPage] = useState<Page>("workspace");
  const [view, setView] = useState<NoteView>("cleaned");
  const [theme, setTheme] = useState<Theme>(readTheme);
  const [dark, setDark] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [commandSearch, setCommandSearch] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [playTime, setPlayTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [download, setDownload] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [storageWarning, setStorageWarning] = useState(false);
  const worker = useRef<Worker | null>(null);
  const operation = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const busy = phase !== "idle";
  const notify = (message: string) => {
    clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(""), 3500);
  };
  const closeDialog = useCallback(() => {
    setDialog(null);
    setCommandSearch("");
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const isDark = theme === "dark" || (theme === "system" && media.matches);
      document.documentElement.dataset.theme = isDark ? "dark" : "light";
      setDark(isDark);
    };
    apply();
    try {
      localStorage.setItem("sotto.theme", theme);
    } catch {
      /* Theme still works without storage. */
    }
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    setStorageWarning(!saveTranscripts(notes));
  }, [notes]);
  useEffect(() => {
    if (!file) {
      setAudioUrl("");
      setPlaying(false);
      setPlayTime(0);
      setAudioDuration(0);
      return;
    }
    const url = URL.createObjectURL(file);
    setAudioUrl(url);
    setPlayTime(0);
    setPlaying(false);
    setAudioDuration(0);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setDialog((d) => (d === "commands" ? null : "commands"));
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        setDialog("settings");
      }
    };
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      operation.current++;
      worker.current?.terminate();
      clearTimeout(toastTimer.current);
    };
  }, []);

  const selectFile = (next: File, recording = false) => {
    if (busy) return;
    try {
      validateAudio(next);
      setFile(next);
      setError("");
      setPage("workspace");
      setSidebarOpen(false);
      if (recording) notify("Recording captured. Ready when you are.");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not open this file.",
      );
    }
  };
  const recorder = useRecorder((next) => selectFile(next, true), setError);
  const navigate = (next: Page) => {
    audio.current?.pause();
    setPlaying(false);
    setPage(next);
    setSidebarOpen(false);
    setSearch("");
  };
  const restricted = busy || recorder.recording || recorder.requesting;
  const newNote = () => {
    if (restricted) return;
    setCurrent(null);
    setFile(null);
    setError("");
    setView("cleaned");
    navigate("workspace");
  };
  const openNote = (note: Transcript) => {
    if (restricted) return;
    setCurrent(note);
    setFile(null);
    setView("cleaned");
    navigate("workspace");
  };
  const openExample = () => {
    openNote(EXAMPLE);
    notify("An example of a little clarity.");
  };

  const transcribe = async () => {
    if (!file || busy || recorder.recording) return;
    const id = ++operation.current;
    setPhase("decoding");
    setError("");
    setDownload(0);
    try {
      const { samples, duration } = await decodeAudio(file);
      if (operation.current !== id) return;
      setAudioDuration(duration);
      setPhase("loading");
      if (!worker.current)
        worker.current = new Worker(
          new URL("./transcription.worker.ts", import.meta.url),
          { type: "module" },
        );
      const sourceFile = file;
      worker.current.onmessage = (
        event: MessageEvent<{
          status: string;
          progress?: number;
          text?: string;
          message?: string;
        }>,
      ) => {
        if (operation.current !== id) return;
        const message = event.data;
        if (message.status === "downloading")
          setDownload(message.progress ?? 0);
        if (message.status === "transcribing") setPhase("transcribing");
        if (message.status === "complete") {
          setPhase("idle");
          if (!message.text) {
            setError("No speech was detected. Try a clearer recording.");
            return;
          }
          const note: Transcript = {
            id: crypto.randomUUID(),
            title: sourceFile.name.replace(/\.[^.]+$/, ""),
            raw: message.text,
            createdAt: Date.now(),
            duration,
            starred: false,
            source: sourceFile.name.startsWith("Voice note ")
              ? "recording"
              : "upload",
          };
          setNotes((prev) => [note, ...prev].slice(0, MAX_NOTES));
          setCurrent(note);
          setView("cleaned");
          notify("A little clarity, captured.");
        }
        if (message.status === "error") {
          setPhase("idle");
          setError(
            `Could not load or run Whisper. Check your connection and try again. ${message.message?.slice(0, 160) || ""}`,
          );
          worker.current?.terminate();
          worker.current = null;
        }
      };
      worker.current.onerror = () => {
        if (operation.current !== id) return;
        setPhase("idle");
        setError(
          "The transcription engine stopped. Your browser may be low on memory. Try a shorter recording.",
        );
        worker.current?.terminate();
        worker.current = null;
      };
      worker.current.postMessage({ audio: samples }, [samples.buffer]);
    } catch (caught) {
      if (operation.current === id) {
        setPhase("idle");
        setError(
          caught instanceof Error ? caught.message : "Could not process audio.",
        );
      }
    }
  };
  const cancel = () => {
    operation.current++;
    worker.current?.terminate();
    worker.current = null;
    setPhase("idle");
    notify("Transcription cancelled. Your file is still here.");
  };
  const star = () => {
    if (!current) return;
    const next = { ...current, starred: !current.starred };
    setCurrent(next);
    if (next.source !== "example")
      setNotes((prev) => prev.map((n) => (n.id === next.id ? next : n)));
  };
  const rename = (title: string) => {
    if (!current) return;
    const next = { ...current, title: title.slice(0, 100) };
    setCurrent(next);
    setNotes((prev) => prev.map((n) => (n.id === next.id ? next : n)));
  };
  const textContent = current
    ? exportText(current.title || "Untitled note", current.raw, view)
    : "";
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(textContent);
      notify("Copied to clipboard.");
    } catch {
      setError(
        "Clipboard access was blocked. Use Export to save your text instead.",
      );
    }
  };
  const exportNote = () => {
    if (!current) return;
    const url = URL.createObjectURL(
      new Blob([textContent], { type: "text/plain;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(current.title || "Untitled note").replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "note"}.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify("Your words, ready to go.");
  };
  const togglePlayback = async () => {
    if (!audio.current) return;
    try {
      if (playing) audio.current.pause();
      else await audio.current.play();
    } catch {
      setError(
        "This audio cannot be played in your browser. Try another format.",
      );
    }
  };
  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!restricted && event.dataTransfer.files[0])
      selectFile(event.dataTransfer.files[0]);
  };
  const words = current ? wordCount(current.raw) : 0;
  const summary = summarize(current?.raw || "");
  const recent = notes.slice(0, 3);
  const filtered = notes.filter(
    (n) =>
      (page !== "starred" || n.starred) &&
      `${n.title} ${n.raw}`.toLowerCase().includes(search.toLowerCase()),
  );
  const today = new Date().toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="app">
      <a className="skip-link" href="#main-content">
        Skip to workspace
      </a>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <div className="ambient ambient-three" />
      <div className="desktop-caption">
        <span className="tiny-brand">✳</span> A LITTLE SPACE FOR YOUR THOUGHTS{" "}
        <span className="caption-line" /> BUILT TO STAY YOURS
      </div>
      <div className="app-window glass">
        {sidebarOpen && (
          <button
            className="sidebar-scrim"
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <aside className={`sidebar ${sidebarOpen ? "sidebar-open" : ""}`}>
          <div className="window-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </div>
          <div className="sidebar-brand">
            <Brand />
            <span className="version-pill">STUDIO</span>
          </div>
          <button
            className="new-note-button"
            onClick={newNote}
            disabled={restricted}
          >
            <Plus size={17} /> New transcript <span>+</span>
          </button>
          <div className="nav-label">YOUR WORKSPACE</div>
          <nav aria-label="Main navigation">
            {(
              [
                { id: "workspace", icon: LayoutGrid, label: "Studio" },
                { id: "library", icon: FolderOpen, label: "All transcripts" },
                { id: "starred", icon: Star, label: "Starred" },
                { id: "insights", icon: AudioLines, label: "Your activity" },
              ] as const
            ).map((item) => (
              <button
                className={`nav-item ${page === item.id ? "nav-active" : ""}`}
                key={item.id}
                onClick={() => navigate(item.id)}
              >
                <item.icon size={18} strokeWidth={1.7} />
                <span>{item.label}</span>
                {item.id === "library" && (
                  <span className="nav-count">{notes.length}</span>
                )}
                {page === item.id && item.id !== "library" && (
                  <span className="nav-active-dot" />
                )}
              </button>
            ))}
          </nav>
          <div className="recent-heading">
            <span className="nav-label">RECENT TRANSCRIPTS</span>
            <MoreHorizontal size={16} aria-hidden="true" />
          </div>
          <div className="recent-list">
            {recent.length ? (
              recent.map((note) => (
                <button
                  key={note.id}
                  className="recent-note"
                  onClick={() => openNote(note)}
                  disabled={restricted}
                >
                  <FileText size={16} />
                  <span>{note.title || "Untitled note"}</span>
                </button>
              ))
            ) : (
              <button
                className="recent-note"
                onClick={openExample}
                disabled={restricted}
              >
                <FileText size={16} />
                <span>A little room for a big idea</span>
              </button>
            )}
          </div>
          <div className="sidebar-bottom">
            <div className="privacy-card">
              <div className="privacy-icon">
                <ShieldCheck size={19} />
              </div>
              <h3>Just you and your thoughts.</h3>
              <p>
                On-device transcription.
                <br />
                No account. No subscriptions.
              </p>
              <span>
                <span className="status-dot" /> Always yours
              </span>
            </div>
            <button className="nav-item" onClick={() => setDialog("settings")}>
              <Settings2 size={18} strokeWidth={1.7} />
              <span>Settings</span>
              <span className="shortcut">⌘ ,</span>
            </button>
            <div className="profile">
              <div className="avatar">Y</div>
              <div>
                <strong>Your personal space</strong>
                <span>Local workspace</span>
              </div>
              <span className="free-badge">FREE</span>
            </div>
          </div>
        </aside>
        <div className="main-shell">
          <header className="toolbar">
            <div className="breadcrumbs">
              <IconButton
                icon={Menu}
                label="Open navigation"
                onClick={() => setSidebarOpen(true)}
                className="mobile-menu"
              />
              <Headphones size={17} strokeWidth={1.6} />
              <span>Workspace</span>
              <ChevronRight size={13} />
              <strong>
                {page === "workspace"
                  ? "Studio"
                  : page === "library"
                    ? "All transcripts"
                    : page === "starred"
                      ? "Starred"
                      : "Your activity"}
              </strong>
            </div>
            <div className="toolbar-actions">
              <button
                className="search-trigger"
                onClick={() => setDialog("commands")}
              >
                <Search size={16} />
                <span>Search anything</span>
                <kbd>⌘ K</kbd>
              </button>
              <span className="toolbar-divider" />
              <IconButton
                icon={dark ? Sun : Moon}
                label={dark ? "Switch to light mode" : "Switch to dark mode"}
                onClick={() => setTheme(dark ? "light" : "dark")}
              />
              <IconButton
                icon={CircleHelp}
                label="About Sotto"
                onClick={() => setDialog("about")}
              />
            </div>
          </header>
          <main id="main-content" className="main-content">
            <div className="page-heading">
              <div>
                <div className="eyebrow">
                  <span /> YOUR MIND, A LITTLE CLEARER
                </div>
                <h1>
                  {page === "workspace" ? (
                    <>
                      Good thoughts deserve
                      <br className="mobile-break" /> a little space
                      <span>.</span>
                    </>
                  ) : page === "library" ? (
                    <>
                      Every thought, in one place<span>.</span>
                    </>
                  ) : page === "starred" ? (
                    <>
                      The ones worth keeping<span>.</span>
                    </>
                  ) : (
                    <>
                      A little progress, every day<span>.</span>
                    </>
                  )}
                </h1>
                <p>
                  {page === "workspace"
                    ? "Turn your voice into something you can come back to."
                    : page === "insights"
                      ? "A quiet look at what you’ve captured in this browser."
                      : "Your words live here. Find a thought and pick up where you left off."}
                </p>
              </div>
              <div className="date-chip">
                <span className="status-dot" />
                <span>{today}</span>
              </div>
            </div>
            {storageWarning && (
              <div className="error-banner" role="alert">
                Browser storage is full or unavailable. Export your notes before
                closing this tab.
              </div>
            )}
            {error && (
              <div className="error-banner" role="alert">
                <span>{error}</span>
                <IconButton
                  icon={X}
                  label="Dismiss error"
                  onClick={() => setError("")}
                />
              </div>
            )}
            {page === "workspace" ? (
              <>
                <div className="workspace-grid">
                  <div className="capture-column">
                    <section
                      className={`capture-card surface ${dragging ? "drag-over" : ""}`}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragging(true);
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={onDrop}
                      aria-labelledby="capture-title"
                    >
                      <div className="card-label">
                        <span className="mini-icon violet">
                          <Mic size={15} />
                        </span>
                        <h2 id="capture-title">A thought starts here</h2>
                        <span className="step-chip">01</span>
                      </div>
                      <div
                        className={`record-scene ${recorder.recording ? "is-recording" : ""}`}
                      >
                        <div className="record-orbit orbit-one" />
                        <div className="record-orbit orbit-two" />
                        <button
                          className="record-button"
                          onClick={
                            recorder.recording ? recorder.stop : recorder.start
                          }
                          disabled={busy || recorder.requesting}
                          aria-label={
                            recorder.recording
                              ? "Stop recording"
                              : "Start recording"
                          }
                        >
                          {recorder.requesting ? (
                            <LoaderCircle size={30} className="spin" />
                          ) : recorder.recording ? (
                            <Square size={27} fill="currentColor" />
                          ) : (
                            <Mic size={31} strokeWidth={1.5} />
                          )}
                        </button>
                        <span className="record-spark spark-one">✦</span>
                        <span className="record-spark spark-two">✦</span>
                      </div>
                      <h3>
                        {recorder.recording
                          ? formatTime(recorder.seconds)
                          : recorder.requesting
                            ? "Opening your microphone…"
                            : "Let it all out."}
                      </h3>
                      <p className="capture-copy">
                        {recorder.recording
                          ? "Recording your thought. Tap to finish."
                          : "A passing idea. A conversation.\nSomething worth remembering."}
                      </p>
                      <button
                        className={`button button-primary record-cta ${recorder.recording ? "button-recording" : ""}`}
                        onClick={
                          recorder.recording ? recorder.stop : recorder.start
                        }
                        disabled={busy || recorder.requesting}
                      >
                        {recorder.recording ? (
                          <Square size={15} />
                        ) : (
                          <Mic size={16} />
                        )}
                        {recorder.recording
                          ? "Finish recording"
                          : "Start recording"}
                        {!recorder.recording && <ArrowRight size={15} />}
                      </button>
                      <div className="or-divider">
                        <span />
                        or bring your own audio
                        <span />
                      </div>
                      <button
                        className="upload-zone"
                        onClick={() => fileInput.current?.click()}
                        disabled={restricted}
                      >
                        <div className="upload-icon">
                          <Upload size={20} strokeWidth={1.6} />
                        </div>
                        <strong>
                          {file ? file.name : "Drop an audio file here"}
                        </strong>
                        <p>
                          {file ? (
                            `${(file.size / 1024 / 1024).toFixed(1)} MB · Click to choose another`
                          ) : (
                            <>
                              or <span>browse files</span> from your device
                            </>
                          )}
                        </p>
                        <span className="file-formats">
                          MP3, WAV, M4A & MORE · UP TO {MAX_AUDIO_MB} MB
                        </span>
                      </button>
                      <input
                        ref={fileInput}
                        type="file"
                        accept="audio/*,.m4a,.mp3,.wav,.webm,.ogg,.flac,.aac,.mp4"
                        aria-label="Choose audio file"
                        className="visually-hidden"
                        disabled={restricted}
                        onChange={(e) => {
                          const selected = e.target.files?.[0];
                          if (selected) selectFile(selected);
                          e.target.value = "";
                        }}
                      />
                      {file && (
                        <div className="transcribe-action">
                          {busy ? (
                            <>
                              <div className="engine-progress">
                                <LoaderCircle size={15} className="spin" />
                                <span>
                                  {phase === "decoding"
                                    ? "Preparing audio…"
                                    : phase === "loading"
                                      ? `Loading Whisper${download ? ` · ${download}%` : "…"}`
                                      : "Listening on your device…"}
                                </span>
                                <button onClick={cancel}>Cancel</button>
                              </div>
                              {phase === "loading" && (
                                <progress
                                  max="100"
                                  value={download}
                                  aria-label="Model download progress"
                                />
                              )}
                            </>
                          ) : (
                            <button
                              className="button button-primary"
                              onClick={transcribe}
                              disabled={
                                recorder.recording || recorder.requesting
                              }
                            >
                              <Sparkles size={16} />
                              Transcribe audio
                              <ArrowRight size={15} />
                            </button>
                          )}
                        </div>
                      )}
                      <div className="on-device">
                        <ShieldCheck size={13} /> Processed on your device.
                        Never uploaded.
                      </div>
                    </section>
                    <button
                      className="example-card surface"
                      onClick={openExample}
                      disabled={restricted}
                    >
                      <span className="mini-icon peach">
                        <Sparkles size={19} />
                      </span>
                      <div>
                        <strong>A little inspiration?</strong>
                        <span>Take a peek at an example transcript.</span>
                      </div>
                      <ArrowRight size={17} />
                    </button>
                  </div>
                  <section
                    className="document-card surface"
                    aria-labelledby="document-heading"
                  >
                    <div className="document-topline">
                      <div className="card-label">
                        <span className="mini-icon blue">
                          <FileText size={15} />
                        </span>
                        <h2 id="document-heading">Your words, with clarity</h2>
                      </div>
                      <span className="document-state">
                        <span className="status-dot" />
                        {current?.source === "example"
                          ? "EXAMPLE"
                          : current
                            ? "SAVED LOCALLY"
                            : "READY FOR A THOUGHT"}
                      </span>
                    </div>
                    <div className="document-meta">
                      <div className="note-type">
                        {current?.source === "example"
                          ? "A NOTE TO GET YOU STARTED"
                          : current?.source === "recording"
                            ? "VOICE NOTE"
                            : current
                              ? "AUDIO TRANSCRIPT"
                              : "YOUR NEXT IDEA"}
                      </div>
                      <div className="document-title-row">
                        <input
                          className="document-title"
                          aria-label="Transcript title"
                          value={
                            current?.title ?? "Something good is on its way"
                          }
                          readOnly={!current}
                          onChange={(e) => rename(e.target.value)}
                          onBlur={() => {
                            if (current && !current.title.trim())
                              rename("Untitled note");
                          }}
                          maxLength={100}
                        />
                        <IconButton
                          icon={Star}
                          label={
                            current?.starred
                              ? "Unstar transcript"
                              : "Star transcript"
                          }
                          onClick={star}
                          disabled={!current || current.source === "example"}
                          className={current?.starred ? "is-starred" : ""}
                        />
                      </div>
                      <div className="note-details">
                        <span>
                          <Clock3 size={13} />
                          {formatTime(current?.duration ?? 0)}
                        </span>
                        <span className="meta-dot">·</span>
                        <span>{words} words</span>
                        <span className="meta-dot">·</span>
                        <span>English</span>
                      </div>
                    </div>
                    <div className="document-controls">
                      <Segmented<NoteView>
                        items={[
                          { value: "cleaned", label: "Cleaned" },
                          { value: "original", label: "Original" },
                          { value: "summary", label: "Summary" },
                        ]}
                        value={view}
                        onChange={setView}
                        label="Transcript view"
                      />
                      <div className="document-tools">
                        <IconButton
                          icon={Copy}
                          label="Copy transcript"
                          onClick={copy}
                          disabled={!current}
                        />
                        <IconButton
                          icon={ArrowDownToLine}
                          label="Export transcript"
                          onClick={exportNote}
                          disabled={!current}
                        />
                      </div>
                    </div>
                    <div
                      className={`document-body ${!current ? "document-empty" : ""}`}
                    >
                      {current ? (
                        view === "summary" ? (
                          <>
                            <div className="summary-label">
                              <Sparkles size={14} /> KEY TAKEAWAYS
                            </div>
                            {summary.highlights.length ? (
                              summary.highlights.map((s, i) => (
                                <p key={i}>{s}</p>
                              ))
                            ) : (
                              <p>No key takeaways found.</p>
                            )}
                            <div className="summary-label action-label">
                              <CheckCheck size={15} /> ACTION ITEMS
                            </div>
                            {summary.actions.length ? (
                              summary.actions.map((s, i) => (
                                <div className="action-item" key={i}>
                                  <span className="check-square" />
                                  <p>{s}</p>
                                </div>
                              ))
                            ) : (
                              <p>No explicit action items found.</p>
                            )}
                            <p className="processing-note">
                              Selected sentences from your transcript. No new
                              facts added.
                            </p>
                          </>
                        ) : view === "clinical" ? (
                          <p className="clinical-text">
                            {structuredNote(current.raw)}
                          </p>
                        ) : (
                          (view === "cleaned"
                            ? cleanTranscript(current.raw)
                            : current.raw
                          )
                            .split(/\n\n+/)
                            .map((paragraph, i) => <p key={i}>{paragraph}</p>)
                        )
                      ) : (
                        <>
                          <span className="empty-document-icon">
                            <FileText size={34} strokeWidth={1.2} />
                          </span>
                          <h3>Make room for your next idea.</h3>
                          <p>
                            Record a thought or upload audio.
                            <br />
                            Your transcript will find a home right here.
                          </p>
                          <button className="text-button" onClick={openExample}>
                            Explore an example <ArrowRight size={15} />
                          </button>
                        </>
                      )}
                    </div>
                    {current && (
                      <div className="document-footnote">
                        <span>
                          <Sparkles size={12} />
                          {view === "original"
                            ? "Exactly as transcribed"
                            : view === "summary"
                              ? "Extractive summary · generated locally"
                              : view === "clinical"
                                ? "Formatting only · clinician review required"
                                : "Filler words removed. Your meaning preserved."}
                        </span>
                        <span>
                          {Math.max(1, Math.ceil(words / 200))} MIN READ
                        </span>
                      </div>
                    )}
                    <div className="audio-player">
                      <button
                        className="play-button"
                        aria-label={playing ? "Pause audio" : "Play audio"}
                        disabled={!audioUrl}
                        onClick={togglePlayback}
                      >
                        {playing ? (
                          <Pause size={15} fill="currentColor" />
                        ) : (
                          <Play size={15} fill="currentColor" />
                        )}
                      </button>
                      <div className="player-wave">
                        <Waveform active={playing || recorder.recording} />
                        <span>
                          {audioUrl
                            ? file?.name
                            : current?.source === "example"
                              ? "Example transcript · text preview"
                              : "Audio stays in this session"}
                        </span>
                      </div>
                      <span className="player-time">
                        {formatTime(playTime)}{" "}
                        <span>
                          /{" "}
                          {formatTime(
                            audioDuration ||
                              (audioUrl ? 0 : (current?.duration ?? 0)),
                          )}
                        </span>
                      </span>
                    </div>
                    {audioUrl && (
                      <audio
                        key={audioUrl}
                        ref={audio}
                        src={audioUrl}
                        onPlay={() => setPlaying(true)}
                        onPause={() => setPlaying(false)}
                        onEnded={() => setPlaying(false)}
                        onTimeUpdate={(e) =>
                          setPlayTime(e.currentTarget.currentTime)
                        }
                        onLoadedMetadata={(e) => {
                          if (Number.isFinite(e.currentTarget.duration))
                            setAudioDuration(e.currentTarget.duration);
                        }}
                        onError={() => {
                          setPlaying(false);
                          setError(
                            "Audio playback is unavailable for this format. Transcription may still work.",
                          );
                        }}
                      />
                    )}
                  </section>
                </div>
                <section
                  className="value-strip"
                  aria-label="Workspace benefits"
                >
                  <div>
                    <span className="benefit-icon mint">
                      <ShieldCheck size={18} />
                    </span>
                    <div>
                      <strong>Private by nature</strong>
                      <span>Your audio never leaves your browser.</span>
                    </div>
                  </div>
                  <div>
                    <span className="benefit-icon lilac">
                      <Sparkles size={18} />
                    </span>
                    <div>
                      <strong>A little less noise</strong>
                      <span>Fewer fillers. More of what you mean.</span>
                    </div>
                  </div>
                  <div>
                    <span className="benefit-icon sand">
                      <Headphones size={18} />
                    </span>
                    <div>
                      <strong>Built for your everyday</strong>
                      <span>Voice notes, meetings, and big ideas.</span>
                    </div>
                  </div>
                </section>
              </>
            ) : page === "insights" ? (
              <section className="insights-grid">
                <Metric
                  label="Thoughts captured"
                  value={String(notes.length)}
                  icon={FileText}
                  copy="Every idea starts with showing up."
                />
                <Metric
                  label="Minutes transcribed"
                  value={String(
                    Math.round(
                      notes.reduce((n, item) => n + item.duration, 0) / 60,
                    ),
                  )}
                  icon={Clock3}
                  copy="A little time, given back to you."
                />
                <Metric
                  label="Words remembered"
                  value={notes
                    .reduce((n, item) => n + wordCount(item.raw), 0)
                    .toLocaleString()}
                  icon={AudioLines}
                  copy="Good thoughts, out of your head."
                />
                <div className="activity-note surface">
                  <ShieldCheck size={28} />
                  <h2>Your space. Your pace.</h2>
                  <p>
                    These numbers come only from transcripts saved in this
                    browser. No analytics, trackers, or accounts.
                  </p>
                  <button
                    className="button button-primary"
                    onClick={newNote}
                    disabled={restricted}
                  >
                    <Plus size={16} />
                    Capture a thought
                  </button>
                </div>
              </section>
            ) : (
              <section className="library surface">
                <div className="library-toolbar">
                  <h2>
                    {page === "starred"
                      ? "Your favorites"
                      : "Transcript library"}{" "}
                    <span>{filtered.length}</span>
                  </h2>
                  <div className="library-search">
                    <Search size={16} />
                    <input
                      aria-label="Search transcripts"
                      placeholder="Find a thought…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                </div>
                {filtered.length ? (
                  <div className="note-grid">
                    {filtered.map((note) => (
                      <button
                        className="library-note"
                        key={note.id}
                        onClick={() => openNote(note)}
                        disabled={restricted}
                      >
                        <div>
                          <span className="mini-icon violet">
                            <FileText size={20} />
                          </span>
                          {note.starred && (
                            <Star
                              size={16}
                              fill="currentColor"
                              className="star-icon"
                            />
                          )}
                        </div>
                        <h3>{note.title}</h3>
                        <p>{cleanTranscript(note.raw).slice(0, 130)}</p>
                        <footer>
                          <span>
                            {new Date(note.createdAt).toLocaleDateString(
                              undefined,
                              { month: "short", day: "numeric" },
                            )}
                          </span>
                          <span>
                            {formatTime(note.duration)}
                            <ArrowRight size={14} />
                          </span>
                        </footer>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="library-empty">
                    <FolderOpen size={42} strokeWidth={1.2} />
                    <h3>
                      {search
                        ? "No thoughts found."
                        : page === "starred"
                          ? "Keep your favorites close."
                          : "Your story starts here."}
                    </h3>
                    <p>
                      {search
                        ? "Try another word or phrase."
                        : page === "starred"
                          ? "Star a saved transcript to find it here."
                          : "Your recordings and uploads will live in this space."}
                    </p>
                    <button
                      className="button button-primary"
                      onClick={newNote}
                      disabled={restricted}
                    >
                      <Plus size={16} />
                      New transcript
                    </button>
                  </div>
                )}
              </section>
            )}
            <footer className="workspace-footer">
              <span>
                <Brand compact /> A LITTLE CLARITY GOES A LONG WAY.
              </span>
              <button onClick={() => setDialog("about")}>
                Made for your peace of mind{" "}
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M3 9 9 3M3 3h6v6"
                    stroke="currentColor"
                    strokeWidth="1.2"
                  />
                </svg>
              </button>
            </footer>
          </main>
        </div>
      </div>
      <div className="below-window">
        <span>LESS FRICTION. MORE THOUGHT.</span>
        <span>
          WHISPER ON DEVICE <span>✦</span> NO API KEYS
        </span>
      </div>
      {toast && (
        <div className="toast glass" role="status">
          <Check size={17} />
          {toast}
        </div>
      )}
      {dialog === "settings" && (
        <Modal
          title="Make yourself at home."
          subtitle="A few small things, just the way you like them."
          onClose={closeDialog}
        >
          <div className="settings-section">
            <label>APPEARANCE</label>
            <Segmented<Theme>
              items={[
                { value: "light", label: "Light" },
                { value: "dark", label: "Dark" },
                { value: "system", label: "System" },
              ]}
              value={theme}
              onChange={setTheme}
              label="Appearance"
            />
          </div>
          <div className="settings-row">
            <span className="mini-icon violet">
              <AudioLines size={20} />
            </span>
            <div>
              <strong>Whisper Tiny · English</strong>
              <p>
                On-device, quantized model. Downloads on first use and caches
                when browser storage is available.
              </p>
            </div>
            <span className="free-badge">FREE</span>
          </div>
          <div className="settings-row">
            <ShieldCheck size={22} />
            <div>
              <strong>Your words stay here</strong>
              <p>
                Up to {MAX_NOTES} transcripts are saved in this browser. Audio
                is kept only for this session. Export anything you want to keep.
              </p>
            </div>
          </div>
          <div className="settings-row">
            <FileText size={22} />
            <div>
              <strong>Clinical formatting</strong>
              <p>
                Format dictated text without adding diagnoses or assigning
                medical sections.
              </p>
            </div>
            <button
              className="button button-small"
              disabled={!current}
              onClick={() => {
                setView("clinical");
                navigate("workspace");
                closeDialog();
              }}
            >
              Open
            </button>
          </div>
          <button
            className="danger-button"
            disabled={!notes.length || restricted}
            onClick={() => setDialog("delete")}
          >
            <Trash2 size={16} />
            Clear saved transcripts
          </button>
        </Modal>
      )}
      {dialog === "delete" && (
        <Modal
          title="Clear your workspace?"
          subtitle="This removes all saved transcripts from this browser. Export any notes you want to keep first."
          onClose={closeDialog}
        >
          <div className="modal-actions">
            <button className="button" onClick={closeDialog}>
              Keep my notes
            </button>
            <button
              className="button button-danger"
              onClick={() => {
                setNotes([]);
                setCurrent(null);
                setFile(null);
                closeDialog();
                notify("Saved transcripts cleared from this browser.");
              }}
            >
              Clear {notes.length} transcripts
            </button>
          </div>
        </Modal>
      )}
      {dialog === "about" && (
        <Modal
          title="A little quieter. A little clearer."
          subtitle="Meet Sotto, your personal transcription studio."
          onClose={closeDialog}
        >
          <div className="about-brand">
            <Brand />
          </div>
          <p className="about-copy">
            Capture a voice note, bring in a recording, and turn it into words
            worth keeping. Whisper runs right in your browser, so your audio
            stays on your device.
          </p>
          <div className="about-facts">
            <span>
              <ShieldCheck size={17} />
              No accounts or API keys
            </span>
            <span>
              <AudioLines size={17} />
              Real, on-device transcription
            </span>
            <span>
              <Sparkles size={17} />
              Local, rule-based cleanup
            </span>
          </div>
          <p className="settings-hint">
            English audio · Up to 10 minutes / 40 MB · A model download is
            required on first use. Processing speed depends on your device.
            Summaries select existing sentences; they do not use a generative AI
            service.
          </p>
          <a
            className="text-button"
            href="https://huggingface.co/onnx-community/whisper-tiny.en"
            target="_blank"
            rel="noreferrer"
          >
            Explore the open model <ArrowRight size={15} />
          </a>
        </Modal>
      )}
      {dialog === "commands" && (
        <Modal title="Find a little clarity." onClose={closeDialog}>
          <div className="command-search">
            <Search size={19} />
            <input
              data-autofocus
              aria-label="Search commands and transcripts"
              placeholder="Search transcripts or jump to…"
              value={commandSearch}
              onChange={(e) => setCommandSearch(e.target.value)}
            />
          </div>
          <div className="command-list">
            {!commandSearch && (
              <>
                <button
                  onClick={() => {
                    newNote();
                    closeDialog();
                  }}
                  disabled={restricted}
                >
                  <Plus size={18} />
                  New transcript
                  <ChevronRight size={15} />
                </button>
                <button
                  onClick={() => {
                    navigate("library");
                    closeDialog();
                  }}
                >
                  <FolderOpen size={18} />
                  All transcripts
                  <ChevronRight size={15} />
                </button>
                <button onClick={() => setDialog("settings")}>
                  <Settings2 size={18} />
                  Settings
                  <ChevronRight size={15} />
                </button>
              </>
            )}
            {notes
              .filter((n) =>
                `${n.title} ${n.raw}`
                  .toLowerCase()
                  .includes(commandSearch.toLowerCase()),
              )
              .slice(0, 8)
              .map((note) => (
                <button
                  key={note.id}
                  onClick={() => {
                    openNote(note);
                    closeDialog();
                  }}
                  disabled={restricted}
                >
                  <FileText size={18} />
                  <span>{note.title}</span>
                  <ChevronRight size={15} />
                </button>
              ))}
            {commandSearch &&
              !notes.some((n) =>
                `${n.title} ${n.raw}`
                  .toLowerCase()
                  .includes(commandSearch.toLowerCase()),
              ) && (
                <p className="command-empty">
                  No saved transcripts match “{commandSearch}”.
                </p>
              )}
          </div>
          <div className="command-footer">
            <Command size={12} /> K to open <span>ESC to close</span>
          </div>
        </Modal>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  icon: Icon,
  copy,
}: {
  label: string;
  value: string;
  icon: typeof FileText;
  copy: string;
}) {
  return (
    <div className="metric surface">
      <span className="mini-icon violet">
        <Icon size={20} />
      </span>
      <span>{label}</span>
      <strong>{value}</strong>
      <p>{copy}</p>
    </div>
  );
}
