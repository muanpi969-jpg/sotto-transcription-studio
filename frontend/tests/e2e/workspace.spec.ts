import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";

test("light and dark workspaces pass WCAG A/AA automated accessibility checks", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  expect(
    (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze())
      .violations,
  ).toEqual([]);
});

test("desktop sample, view switching, theme persistence, keyboard search, export", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Good thoughts deserve/ }),
  ).toBeVisible();
  await expect(page.locator(".document-state")).toHaveText("EXAMPLE");
  await page.getByRole("button", { name: "Original", exact: true }).click();
  await expect(page.locator(".document-body")).toContainText("Um,");
  await page.getByRole("button", { name: "Cleaned", exact: true }).click();
  await expect(page.locator(".document-body")).not.toContainText("Um,");
  await mkdir(resolve("../docs"), { recursive: true });
  await page.screenshot({ path: "../docs/studio-light.png", fullPage: true });
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  await expect(page.locator(".document-body")).toContainText("ACTION ITEMS");
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export transcript", exact: true })
    .click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/\.txt$/);
  await expect(page.getByRole("status")).not.toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "Switch to dark mode" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Cleaned", exact: true }).click();
  await page.screenshot({ path: "../docs/studio-dark.png", fullPage: true });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.keyboard.press("ControlOrMeta+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Search commands and transcripts" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("local library, search, favorites, rename, statistics and deletion", async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem(
      "sotto.transcripts.v1",
      JSON.stringify([
        {
          id: "test-note",
          title: "Friday prototype",
          raw: "We need to review the prototype on Friday.",
          duration: 65,
          createdAt: Date.now(),
          starred: false,
          source: "upload",
        },
      ]),
    ),
  );
  await page.goto("/");
  await page.getByRole("button", { name: /^All transcripts/ }).click();
  await page
    .getByRole("textbox", { name: "Search transcripts" })
    .fill("nothing like this");
  await expect(page.getByText("No thoughts found.")).toBeVisible();
  await page
    .getByRole("textbox", { name: "Search transcripts" })
    .fill("Friday");
  await page.locator(".library-note").click();
  await page
    .getByRole("textbox", { name: "Transcript title" })
    .fill("Design review");
  await page
    .getByRole("button", { name: "Star transcript", exact: true })
    .click();
  await page.getByRole("button", { name: "Starred", exact: true }).click();
  await expect(page.locator(".library-note")).toContainText("Design review");
  await page
    .getByRole("button", { name: "Your activity", exact: true })
    .click();
  await expect(page.locator(".metric").first()).toContainText("1");
  await page.getByRole("button", { name: /Settings/ }).click();
  await page.getByRole("button", { name: "Clear saved transcripts" }).click();
  await page.getByRole("button", { name: "Clear 1 transcripts" }).click();
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("sotto.transcripts.v1") || "[]"),
    ),
  ).toEqual([]);
});

test("invalid upload is rejected and microphone permission error is actionable", async ({
  page,
  context,
}) => {
  await context.clearPermissions();
  await page.goto("/");
  await page
    .getByLabel("Choose audio file")
    .setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("not audio"),
    });
  await expect(page.getByRole("alert")).toContainText("Choose an audio file");
  await page.getByRole("button", { name: "Dismiss error" }).click();
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .first()
    .click();
  await expect(page.getByRole("alert")).toContainText(
    /Microphone access was denied|Could not open your microphone/,
  );
});

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`responsive layout at ${width}px has glass and no clipping`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: /Good thoughts deserve/ }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".app-window")
        .evaluate((el) => getComputedStyle(el).backdropFilter),
    ).toContain("blur");
    const offscreen = await page
      .locator("main button, main input")
      .evaluateAll((els) =>
        els
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width && (r.right > innerWidth + 1 || r.left < -1);
          })
          .map((el) => el.getAttribute("aria-label") || el.textContent),
      );
    expect(offscreen).toEqual([]);
    if (width === 390) {
      await page.screenshot({
        path: "../docs/studio-mobile.png",
        fullPage: true,
      });
      await page.getByRole("button", { name: "Open navigation" }).click();
      await page.getByRole("button", { name: /^All transcripts/ }).click();
      await expect(
        page.getByRole("heading", { name: "Transcript library" }),
      ).toBeVisible();
    }
  });
}

test("microphone recording produces a correctly typed, playable audio file", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["microphone"]);
  // A real Web Audio stream exercises MediaRecorder without depending on an
  // operating-system microphone driver in headless Linux CI.
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const audioContext = new AudioContext();
      const oscillator = audioContext.createOscillator();
      const destination = audioContext.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      await audioContext.resume();
      const stream = destination.stream;
      for (const track of stream.getTracks()) {
        const stopTrack = track.stop.bind(track);
        track.stop = () => {
          stopTrack();
          oscillator.stop();
          void audioContext.close();
        };
      }
      return stream;
    };
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Start recording", exact: true })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "00:01", exact: true }),
  ).toBeVisible({ timeout: 5000 });
  await page.getByRole("button", { name: "Finish recording" }).click();
  await expect(page.locator(".upload-zone")).toContainText("Voice note");
  await expect(
    page.getByRole("button", { name: "Transcribe audio" }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Play audio", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Play audio", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Pause audio", exact: true }),
  ).toBeVisible();
});

test("transcription can be cancelled during model loading and retried", async ({
  page,
}) => {
  const samples = 16000;
  const wav = Buffer.alloc(44 + samples * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16000, 24);
  wav.writeUInt32LE(32000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++)
    wav.writeInt16LE(Math.round(Math.sin(i * 0.08) * 5000), 44 + i * 2);
  await page.route("https://huggingface.co/**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.abort().catch(() => {});
  });
  await page.goto("/");
  await page
    .getByLabel("Choose audio file")
    .setInputFiles({ name: "test.wav", mimeType: "audio/wav", buffer: wav });
  await page.getByRole("button", { name: "Transcribe audio" }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Transcribe audio" }),
  ).toBeEnabled();
  await expect(page.locator(".upload-zone")).toContainText("test.wav");
  await expect(page.getByRole("status")).toContainText("cancelled");
});

test("real on-device Whisper inference, with no audio uploaded to a server", async ({
  page,
  request,
}) => {
  test.skip(
    !process.env.RUN_MODEL_TEST,
    "Set RUN_MODEL_TEST=1 to download the open model and transcribe real speech.",
  );
  test.setTimeout(240_000);
  const fixture = await request.get(
    "https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/jfk.wav",
  );
  expect(fixture.ok()).toBe(true);
  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST") posts.push(r.url());
  });
  await page.goto("/");
  await page
    .getByLabel("Choose audio file")
    .setInputFiles({
      name: "Kennedy speech.wav",
      mimeType: "audio/wav",
      buffer: await fixture.body(),
    });
  await page.getByRole("button", { name: "Transcribe audio" }).click();
  await expect(page.locator(".document-state")).toHaveText("SAVED LOCALLY", {
    timeout: 210_000,
  });
  await expect(page.locator(".document-body")).toContainText(/country/i);
  expect(posts).toEqual([]);
  await expect(
    page.getByRole("textbox", { name: "Transcript title" }),
  ).toHaveValue("Kennedy speech");
  await page.reload();
  await page.getByRole("button", { name: /^All transcripts/ }).click();
  await expect(page.locator(".library-note")).toContainText("Kennedy speech");
});
