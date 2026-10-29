/**
 * Import a list the shopper already has: paste, photo, file, link,
 * share, or speech. Matching stays on our catalog. Tiles do not show prices.
 */

import { describeMeal } from "./mealIdeas.js";

const MIC = `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 3a3 3 0 0 1 3 3v6a3 3 0 0 1-6 0V6a3 3 0 0 1 3-3z"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>`;

export function foundLabel(found, total) {
  const noun = total === 1 ? "item" : "items";
  return `Found ${found} of ${total} ${noun}`;
}

export function acceptLabel(count) {
  if (count === 1) return "Add 1 item to my trip";
  return `Add ${count} items to my trip`;
}

export function sizeName(variant) {
  const label = String(variant?.label || variant?.variantLabel || variant?.sizeLabel || "").trim();
  if (!label || label.includes("$")) return "";
  return label;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function deviceId() {
  const key = "gg-device";
  try {
    let id = localStorage.getItem(key);
    if (!id) {
      id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `gg-${Date.now()}`;
      localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return "gg-device";
  }
}

/**
 * @param {{ addProduct: Function, showStep: Function, remember?: Function, apiUrl: Function, toast?: Function, mediaUrl?: Function }} deps
 */
export function mountImport(deps) {
  if (!deps || document.getElementById("import-dialog")) return;
  const apiUrl = deps.apiUrl || ((path) => path);
  const toast = deps.toast || (() => {});
  const media = deps.mediaUrl || ((url) => url);
  let status = { photo: false, speech: false, ask: false };
  let review = null;
  let recording = null;
  let stopTimer = 0;

  const dialog = document.createElement("dialog");
  dialog.id = "import-dialog";
  dialog.className = "sheet import-sheet";
  dialog.setAttribute("aria-labelledby", "import-title");
  dialog.innerHTML = `
    <form class="sheet-body" id="import-form">
      <div class="list-head">
        <h2 id="import-title" tabindex="-1">Import your list</h2>
        <button type="button" class="text-btn" id="import-close">Close</button>
      </div>
      <div id="import-home">
        <button type="button" class="import-mic" id="import-mic" aria-pressed="false" aria-label="Speak your list">
          ${MIC}<span>Speak</span>
        </button>
        <p class="import-lead">Say the items, or paste a note, a cart, or a recipe. The microphone stays on only while you are speaking.</p>
        <label class="sr-only" for="import-paste">Your list</label>
        <textarea id="import-paste" class="import-paste" placeholder="Milk, bread, eggs…"></textarea>
        <button type="submit" class="primary" id="import-find">Find these items</button>
        <div class="import-tools">
          <button type="button" class="ghost" id="import-photo">Photo or screenshot</button>
          <button type="button" class="ghost" id="import-file">Upload a list</button>
          <button type="button" class="ghost" id="import-link-toggle">Paste a link</button>
        </div>
        <div id="import-link-row" class="import-link-row" hidden>
          <label for="import-link">Link to a shared list</label>
          <input id="import-link" type="url" inputmode="url" placeholder="https://" autocomplete="off" />
          <button type="button" class="ghost" id="import-link-go">Read this link</button>
        </div>
        <details class="import-ask" id="import-ask">
          <summary>Need a meal idea?</summary>
          <p class="import-lead">Try taco night for 6. You'll see the list before anything is added.</p>
          <label class="sr-only" for="import-goal">What are you shopping for?</label>
          <textarea id="import-goal" class="import-goal" maxlength="400" placeholder="Taco night for 6"></textarea>
          <button type="button" class="ghost" id="import-ask-go">Show this list</button>
        </details>
        <input id="import-photo-input" type="file" accept="image/*" hidden />
        <input id="import-file-input" type="file" accept="image/*,audio/*,.txt,.csv,text/plain,text/csv" hidden />
      </div>
      <div id="import-listen" hidden>
        <div class="import-listening">
          <p><span class="import-pulse" aria-hidden="true"></span>Listening… tap stop when you're done.</p>
          <p id="import-live" aria-live="polite"></p>
        </div>
        <button type="button" class="primary" id="import-stop">Stop</button>
      </div>
      <div id="import-transcript" hidden>
        <label for="import-heard">We heard</label>
        <textarea id="import-heard" class="import-transcript"></textarea>
        <button type="button" class="primary" id="import-heard-go">Find these items</button>
      </div>
      <div id="import-review" hidden></div>
      <p id="import-status" class="import-status" role="status"></p>
    </form>`;
  document.body.appendChild(dialog);

  const $ = (id) => dialog.querySelector(`#${id}`);
  const home = $("import-home");
  const listen = $("import-listen");
  const transcript = $("import-transcript");
  const reviewHost = $("import-review");
  const statusEl = $("import-status");

  function setStatus(message, kind) {
    statusEl.textContent = message || "";
    statusEl.dataset.kind = kind || "";
    if (kind === "error") statusEl.setAttribute("role", "alert");
    else statusEl.setAttribute("role", "status");
  }

  function show(which) {
    home.hidden = which !== "home";
    listen.hidden = which !== "listen";
    transcript.hidden = which !== "transcript";
    reviewHost.hidden = which !== "review";
    const mic = $("import-mic");
    if (mic) mic.setAttribute("aria-pressed", which === "listen" ? "true" : "false");
    if (which !== "review") {
      const title = $("import-title");
      if (title) title.textContent = "Import your list";
    }
  }

  function open(which) {
    show(which || "home");
    if (!dialog.open) dialog.showModal();
    const title = $("import-title");
    title?.focus();
  }

  function close() {
    void stopRecording(true);
    dialog.close();
    show("home");
    setStatus("");
  }

  async function post(path, body) {
    const response = await fetch(apiUrl(path), {
      method: "POST",
      headers: { "content-type": "application/json", "x-device-id": deviceId() },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "Something went wrong reading that. Paste the list instead.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function loadStatus() {
    try {
      const response = await fetch(apiUrl("/api/import/status"));
      if (response.ok) status = await response.json();
    } catch {
      /* paste still works */
    }
  }

  function bindAsk() {
    const mic = document.getElementById("ask-mic");
    const more = document.getElementById("ask-import");
    if (mic && mic.dataset.bound !== "1") {
      mic.dataset.bound = "1";
      mic.addEventListener("click", () => {
        open("home");
        void startRecording();
      });
    }
    if (more && more.dataset.bound !== "1") {
      more.dataset.bound = "1";
      more.addEventListener("click", () => open("home"));
    }
    return Boolean(mic || more);
  }

  function paintEntry() {
    if (bindAsk()) return;
    const host = document.getElementById("start-here");
    if (!host || host.querySelector(".import-entry")) return;
    const section = document.createElement("section");
    section.className = "import-entry";
    section.setAttribute("aria-label", "Import a list");
    section.innerHTML = `
      <div class="import-entry-row">
        <button type="button" class="primary import-open">Import your list</button>
        <button type="button" class="import-mic import-mic-inline" aria-label="Speak your list" aria-pressed="false">${MIC}<span>Speak</span></button>
      </div>
      <p class="import-lead">Paste a note, a cart, or a photo of a list you already use.</p>`;
    host.prepend(section);
    section.querySelector(".import-open")?.addEventListener("click", () => open("home"));
    section.querySelector(".import-mic-inline")?.addEventListener("click", () => {
      open("home");
      void startRecording();
    });
  }

  function find(text) {
    const value = String(text || "").trim();
    open("home");
    const paste = $("import-paste");
    if (paste) paste.value = value;
    if (!value) {
      setStatus("Type or paste a list.", "error");
      return Promise.resolve();
    }
    return runText(value);
  }

  function speak() {
    open("home");
    return startRecording();
  }

  function paintEmpty() {
    const empty = document.getElementById("list-empty");
    if (!empty || empty.hidden || empty.querySelector("[data-import-open]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ghost";
    button.dataset.importOpen = "1";
    button.textContent = "Import your list";
    button.addEventListener("click", () => open("home"));
    empty.appendChild(button);
  }

  function paintOnboarding() {
    const body = document.getElementById("onboard-body");
    if (!body || document.getElementById("onboard-import")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "primary";
    button.id = "onboard-import";
    button.textContent = "Import a list you already have";
    button.addEventListener("click", () => {
      document.getElementById("onboarding")?.close();
      open("home");
    });
    body.insertAdjacentElement("afterend", button);
  }

  function syncOnboarding() {
    const button = document.getElementById("onboard-import");
    const progress = document.getElementById("onboard-progress");
    if (!button) return;
    button.hidden = progress ? !/^1 of /.test(progress.textContent || "") : false;
  }

  function acceptedCount() {
    return (review?.items || []).filter((item) => item.accepted && item.selectedId).length;
  }

  function choiceProduct(item) {
    return item.choices?.find((choice) => choice.product?.id === item.selectedId)?.product || null;
  }

  function reviewHeading() {
    const idea = review?.idea;
    const title = $("import-title");
    if (!title) return;
    if (!idea) {
      title.textContent = "Review";
      return;
    }
    title.textContent = idea.namedPeople ? `${idea.title} for ${idea.people}` : idea.title;
  }

  function reviewLead() {
    const idea = review?.idea;
    if (!idea) return `<p class="import-count" aria-live="polite">${escapeHtml(foundLabel(review.found, review.total))}</p>`;
    const noun = review.items.length === 1 ? "item" : "items";
    const count = idea.namedPeople
      ? `${review.items.length} ${noun} for ${idea.people} people`
      : `${review.items.length} ${noun}`;
    return `<p class="import-idea-lead">${escapeHtml(idea.blurb)}</p><p class="import-count" aria-live="polite">${escapeHtml(count)}</p>`;
  }

  function renderReview() {
    if (!review) return;
    if (deps.shapeReview && !review.profileShaped) {
      const shaped = deps.shapeReview(review);
      review = shaped.review || review;
      if (shaped.note) setStatus(shaped.note);
    }
    const count = acceptedCount();
    const cards = review.items
      .map((item) => {
        const kicker = review.idea && item.raw ? `<p class="import-kicker">${escapeHtml(item.raw)}</p>` : "";
        if (item.status === "missing" || !item.choices?.length) {
          const hits = (item.searchHits || [])
            .map(
              (hit) =>
                `<button type="button" class="ghost import-search-hit" data-pick-search="${escapeHtml(item.key)}" data-id="${escapeHtml(hit.id)}">${escapeHtml(hit.name)}${hit.sizeLabel ? ` · ${escapeHtml(hit.sizeLabel)}` : ""}</button>`
            )
            .join("");
          return `<li class="import-tile" data-key="${escapeHtml(item.key)}">
            ${kicker}
            <h3>${escapeHtml(item.raw || item.name)}</h3>
            <p class="import-note">Not on the shelf.</p>
            <div class="import-tools">
              <button type="button" class="ghost" data-search="${escapeHtml(item.key)}">Search for it</button>
              <button type="button" class="text-btn" data-skip="${escapeHtml(item.key)}">Skip</button>
            </div>
            ${hits ? `<div class="import-tools">${hits}</div>` : ""}
          </li>`;
        }
        const product = choiceProduct(item);
        const title = product?.familyName || product?.name || item.raw || item.name;
        const brand = product?.brand && !String(title).toLowerCase().includes(String(product.brand).toLowerCase()) ? product.brand : "";
        const image = product?.imageUrls?.[0] || "";
        const sizeButtons = (product?.variants || [])
          .map((variant) => {
            const label = sizeName(variant);
            if (!label) return "";
            const on = variant.id === item.selectedId;
            return `<button type="button" class="ghost import-size" aria-pressed="${on}" data-size="${escapeHtml(item.key)}" data-id="${escapeHtml(variant.id)}">${escapeHtml(label)}</button>`;
          })
          .filter(Boolean);
        const sizes =
          sizeButtons.length > 1
            ? `<div class="import-size-row" role="group" aria-label="Size">${sizeButtons.join("")}</div>`
            : "";
        const alts =
          item.openAlts && item.choices.length > 1
            ? `<div class="import-choice-row" role="radiogroup" aria-label="Choices for ${escapeHtml(item.raw || item.name)}">${item.choices
                .map((choice) => {
                  const name = choice.product?.familyName || choice.product?.name || "Item";
                  const on = choice.product?.id === item.selectedId;
                  return `<button type="button" class="ghost import-choice" role="radio" aria-checked="${on}" data-choice="${escapeHtml(item.key)}" data-id="${escapeHtml(choice.product?.id || "")}">${escapeHtml(name)}</button>`;
                })
                .join("")}</div>`
            : "";
        const change =
          item.choices.length > 1
            ? `<button type="button" class="text-btn import-change" data-change="${escapeHtml(item.key)}">${item.openAlts ? "Hide choices" : "Change"}</button>`
            : "";
        return `<li class="import-tile" data-key="${escapeHtml(item.key)}">
          <div class="import-tile-head">
            ${image ? `<img src="${escapeHtml(media(image))}" alt="" />` : ""}
            <div>
              ${kicker}
              ${brand ? `<p class="brand">${escapeHtml(brand)}</p>` : ""}
              <h3>${escapeHtml(title)}</h3>
              ${item.shelfNote ? `<p class="import-note">${escapeHtml(item.shelfNote)}</p>` : ""}
            </div>
          </div>
          ${alts}
          ${sizes}
          <div class="import-entry-row">
            <label class="import-check"><input type="checkbox" data-accept="${escapeHtml(item.key)}" ${item.accepted ? "checked" : ""} /> Add</label>
            <div class="import-stepper">
              <button type="button" data-qty="${escapeHtml(item.key)}" data-delta="-1" aria-label="Decrease ${escapeHtml(title)}">−</button>
              <output>${item.quantity}</output>
              <button type="button" data-qty="${escapeHtml(item.key)}" data-delta="1" aria-label="Increase ${escapeHtml(title)}">+</button>
            </div>
            ${change}
          </div>
        </li>`;
      })
      .join("");
    reviewHeading();
    reviewHost.innerHTML = `
      ${reviewLead()}
      <ul class="import-review">${cards}</ul>
      <label class="import-save"><input type="checkbox" id="import-save" /> <span>Save for next time on this phone.</span></label>
      <div class="import-review-actions">
        <button type="button" class="ghost" id="import-back">Back</button>
        <button type="button" class="primary" id="import-accept" ${count ? "" : "disabled"}>${escapeHtml(acceptLabel(count))}</button>
      </div>`;
    show("review");
  }

  async function runText(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
      setStatus("Paste a list first.", "error");
      return;
    }
    const meal = describeMeal(trimmed);
    setStatus(meal ? "Putting a short list together…" : "Matching what you already buy…");
    try {
      review = await post("/api/import/text", { text: trimmed });
      setStatus("");
      renderReview();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Something went wrong reading that. Paste the list instead.", "error");
    }
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const value = String(reader.result || "");
        resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function prepareImage(file) {
    if (!file.type.startsWith("image/")) return file;
    const bitmap = await createImageBitmap(file).catch(() => null);
    if (!bitmap) return file;
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
    bitmap.close?.();
    return blob || file;
  }

  async function runPhoto(file) {
    if (!status.photo) {
      setStatus("Photo import isn't switched on yet. Paste the text instead.", "error");
      show("home");
      return;
    }
    setStatus("Reading the photo…");
    try {
      const prepared = await prepareImage(file);
      if (prepared.size > 4_000_000) {
        setStatus("That file is too large. Try a smaller screenshot or paste the text.", "error");
        return;
      }
      const imageBase64 = await blobToBase64(prepared);
      review = await post("/api/import/photo", { imageBase64, mimeType: prepared.type || "image/jpeg" });
      setStatus("");
      renderReview();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "That photo didn't open. Try a screenshot, or paste the text.", "error");
    }
  }

  async function runFile(file) {
    if (file.type.startsWith("image/")) return runPhoto(file);
    if (file.type.startsWith("audio/") || file.type.startsWith("video/")) return runAudioBlob(file);
    const text = await file.text();
    return runText(text);
  }

  function showTranscript(text) {
    $("import-heard").value = text || "";
    show("transcript");
    setStatus(text ? "" : "We didn't catch any words. Type them here, or paste the list.");
    $("import-heard").focus();
  }

  async function runAudioBlob(blob, seconds) {
    if (!status.speech) {
      setStatus("Voice import isn't switched on yet. Type or paste your list instead.", "error");
      show("home");
      return;
    }
    if (blob.size > 8_000_000) {
      setStatus("That recording is too long. Keep it under a minute and a half, or paste the list.", "error");
      return;
    }
    setStatus("Hearing your list…");
    try {
      const audioBase64 = await blobToBase64(blob);
      const body = await post("/api/import/audio", {
        audioBase64,
        mimeType: blob.type || "audio/webm",
        durationSec: seconds || undefined,
      });
      setStatus("");
      showTranscript(body.transcript || "");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "That recording didn't open. Try again, or paste the list.", "error");
      show("home");
    }
  }

  function nativePlugin() {
    const plugin = window.Capacitor?.Plugins?.SpeechRecognition;
    if (!plugin?.start || window.Capacitor?.isNativePlatform?.() !== true) return null;
    return plugin;
  }

  function webRecognizer() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    return Ctor ? new Ctor() : null;
  }

  async function startRecording() {
    setStatus("");
    const plugin = nativePlugin();
    if (plugin) {
      try {
        const perm = await plugin.requestPermissions();
        const state = perm?.speechRecognition || perm?.microphone;
        if (state === "denied") {
          setStatus("The microphone is off. You can allow it in your phone settings, or paste the list instead.", "error");
          return;
        }
        let heard = "";
        const listener = await plugin.addListener?.("partialResults", (event) => {
          heard = event?.matches?.[0] || heard;
          const live = $("import-live");
          if (live) live.textContent = heard;
        });
        await plugin.start({ language: "en-US", partialResults: true, maxResults: 1, popup: false });
        recording = {
          seconds: 0,
          async stop(cancel) {
            await plugin.stop?.().catch(() => undefined);
            await listener?.remove?.().catch(() => undefined);
            if (!cancel) showTranscript(heard);
          },
        };
        show("listen");
        return;
      } catch {
        setStatus("The microphone is off. You can allow it in your phone settings, or paste the list instead.", "error");
        return;
      }
    }

    let recognizer = null;
    let heard = "";
    const web = webRecognizer();
    if (web) {
      recognizer = web;
      recognizer.continuous = true;
      recognizer.interimResults = true;
      recognizer.lang = "en-US";
      recognizer.onresult = (event) => {
        heard = "";
        for (let i = 0; i < event.results.length; i += 1) heard += event.results[i][0]?.transcript || "";
        const live = $("import-live");
        if (live) live.textContent = heard;
      };
      try {
        recognizer.start();
      } catch {
        recognizer = null;
      }
    }

    let recorder = null;
    if (status.speech && navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mime = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "";
        const mediaRecorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        const chunks = [];
        mediaRecorder.ondataavailable = (event) => {
          if (event.data?.size) chunks.push(event.data);
        };
        mediaRecorder.start();
        recorder = { mediaRecorder, chunks, stream, mime: mediaRecorder.mimeType || mime || "audio/webm" };
      } catch (error) {
        if (!recognizer) {
          const denied = error && (error.name === "NotAllowedError" || error.name === "SecurityError");
          setStatus(
            denied
              ? "The microphone is off. You can allow it in your browser settings, or paste the list instead."
              : "Voice import isn't switched on yet. Type or paste your list instead.",
            "error"
          );
          return;
        }
      }
    }

    if (!recognizer && !recorder) {
      setStatus("Voice import isn't switched on yet. Type or paste your list instead.", "error");
      show("home");
      return;
    }

    const started = Date.now();
    const session = {
      seconds: 0,
      async stop(cancel) {
        window.clearTimeout(stopTimer);
        recognizer?.stop?.();
        if (recorder) {
          const blob = await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              resolve(new Blob(recorder.chunks, { type: recorder.mime }));
            };
            recorder.mediaRecorder.onstop = finish;
            window.setTimeout(finish, 1500);
            try {
              if (recorder.mediaRecorder.state !== "inactive") recorder.mediaRecorder.stop();
              else finish();
            } catch {
              finish();
            }
          });
          recorder.stream.getTracks().forEach((track) => track.stop());
          session.seconds = Math.max(1, Math.round((Date.now() - started) / 1000));
          if (!cancel && status.speech && blob.size > 800) {
            await runAudioBlob(blob, session.seconds);
            return;
          }
        }
        if (!cancel) showTranscript(heard);
      },
    };
    recording = session;
    show("listen");
    stopTimer = window.setTimeout(() => {
      void stopRecording(false);
    }, 60_000);
  }

  async function stopRecording(cancel) {
    const current = recording;
    recording = null;
    window.clearTimeout(stopTimer);
    if (current) await current.stop(cancel);
  }

  dialog.addEventListener("close", () => {
    void stopRecording(true);
  });
  $("import-close")?.addEventListener("click", close);
  $("import-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    void runText($("import-paste").value);
  });
  $("import-mic")?.addEventListener("click", () => void startRecording());
  $("import-stop")?.addEventListener("click", () => void stopRecording(false));
  $("import-heard-go")?.addEventListener("click", () => void runText($("import-heard").value));
  $("import-photo")?.addEventListener("click", () => $("import-photo-input").click());
  $("import-file")?.addEventListener("click", () => $("import-file-input").click());
  $("import-photo-input")?.addEventListener("change", () => {
    const file = $("import-photo-input").files?.[0];
    $("import-photo-input").value = "";
    if (file) void runPhoto(file);
  });
  $("import-file-input")?.addEventListener("change", () => {
    const file = $("import-file-input").files?.[0];
    $("import-file-input").value = "";
    if (file) void runFile(file);
  });
  $("import-link-toggle")?.addEventListener("click", () => {
    $("import-link-row").hidden = !$("import-link-row").hidden;
  });
  $("import-link-go")?.addEventListener("click", async () => {
    setStatus("Reading that link…");
    try {
      review = await post("/api/import/link", { url: $("import-link").value });
      setStatus("");
      renderReview();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "That link can't be read from here. Paste the list or send a screenshot instead.", "error");
    }
  });
  $("import-ask-go")?.addEventListener("click", async () => {
    const goal = $("import-goal").value.trim();
    if (!goal) {
      setStatus("Say what you want, like taco night for 6.", "error");
      return;
    }
    setStatus(describeMeal(goal) ? "Putting a short list together…" : "Thinking of a list…");
    try {
      const constraints = deps.askConstraints ? deps.askConstraints() : null;
      review = await post("/api/import/ask", constraints ? { goal, constraints } : { goal });
      setStatus("");
      renderReview();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "We couldn't make a list from that. Try a shorter goal, like taco night for 6.", "error");
    }
  });

  reviewHost.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target || !review) return;
    const key =
      target.dataset.accept ||
      target.dataset.qty ||
      target.dataset.choice ||
      target.dataset.size ||
      target.dataset.search ||
      target.dataset.skip ||
      target.dataset.pickSearch ||
      target.dataset.change;
    const item = review.items.find((row) => row.key === key);
    if (target.id === "import-back") {
      show("home");
      return;
    }
    if (target.id === "import-accept") {
      acceptAll();
      return;
    }
    if (!item) return;
    if (target.dataset.change) {
      item.openAlts = !item.openAlts;
      renderReview();
      return;
    }
    if (target.dataset.qty) {
      item.quantity = Math.min(99, Math.max(1, item.quantity + Number(target.dataset.delta || 0)));
      renderReview();
      return;
    }
    if (target.dataset.choice) {
      item.selectedId = target.dataset.id;
      item.accepted = true;
      renderReview();
      return;
    }
    if (target.dataset.size) {
      const product = choiceProduct(item);
      const variant = product?.variants?.find((row) => row.id === target.dataset.id);
      if (variant) {
        const familyName = product.familyName;
        const flavors = product.flavors;
        const variants = product.variants;
        const next = { ...product, ...variant, familyName, flavors, variants, catalogName: variant.name || product.catalogName };
        const choice = item.choices.find((row) => row.product?.id === item.selectedId) || item.choices[0];
        if (choice) choice.product = next;
        item.selectedId = variant.id;
        item.accepted = true;
      }
      renderReview();
      return;
    }
    if (target.dataset.skip) {
      item.accepted = false;
      item.status = "missing";
      item.choices = [];
      renderReview();
      return;
    }
    if (target.dataset.search) {
      void searchItem(item);
      return;
    }
    if (target.dataset.pickSearch) {
      const hit = (item.searchHits || []).find((row) => row.id === target.dataset.id);
      if (hit) void pickSearch(item, hit);
    }
  });

  reviewHost.addEventListener("change", (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !input.dataset.accept || !review) return;
    const item = review.items.find((row) => row.key === input.dataset.accept);
    if (!item) return;
    item.accepted = input.checked;
    const button = $("import-accept");
    if (button) {
      const count = acceptedCount();
      button.textContent = acceptLabel(count);
      button.disabled = count === 0;
    }
  });

  async function searchItem(item) {
    setStatus("Searching the shelf…");
    try {
      const response = await fetch(apiUrl(`/api/catalog/suggest?q=${encodeURIComponent(item.name)}`));
      const body = await response.json();
      item.searchHits = (body.suggestions || []).slice(0, 3).map((hit) => ({
        id: hit.id,
        name: hit.name,
        sizeLabel: hit.sizeLabel && !String(hit.sizeLabel).includes("$") ? hit.sizeLabel : "",
      }));
      setStatus(item.searchHits.length ? "" : "Nothing matched. Try different words, or skip it.");
      renderReview();
    } catch {
      setStatus("Search didn't load. Try again, or skip it.", "error");
    }
  }

  async function pickSearch(item, hit) {
    try {
      const response = await fetch(apiUrl(`/api/catalog/products/${encodeURIComponent(hit.id)}`));
      const body = await response.json();
      const product = body.product || { id: hit.id, name: hit.name, familyName: hit.name, brand: "" };
      product.familyName = product.familyName || hit.name;
      item.choices = [{ product, score: 1 }];
      item.selectedId = product.id;
      item.accepted = true;
      item.status = "matched";
      review.found = review.items.filter((row) => row.status !== "missing").length;
      renderReview();
    } catch {
      setStatus("That item didn't load. Try again.", "error");
    }
  }

  function acceptAll() {
    const chosen = (review?.items || []).filter((item) => item.accepted && choiceProduct(item));
    if (!chosen.length) return;
    let addedCount = 0;
    for (const item of chosen) {
      const product = choiceProduct(item);
      const prepared = deps.prepareAdd ? deps.prepareAdd(item, product) : { product, options: { quiet: true } };
      if (!prepared?.product) continue;
      deps.addProduct(prepared.product, item.quantity, { quiet: true, ...(prepared.options || {}) });
      addedCount += item.quantity;
    }
    if (!addedCount) {
      toast("Those items don't fit your taste profile.");
      close();
      return;
    }
    if ($("import-save")?.checked && deps.remember) {
      deps.remember(
        chosen.map((item) => {
          const product = choiceProduct(item);
          return {
            name: product.familyName || product.catalogName || product.name,
            brand: product.brand,
            catalogId: product.id,
            quantity: item.quantity,
          };
        })
      );
    }
    toast(addedCount === 1 ? "Added 1 item." : `Added ${addedCount} items.`);
    close();
    deps.showStep("plan");
  }

  async function consumeShare() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("import") !== "shared" || !("caches" in window)) return;
    const cache = await caches.open("gg-import-share");
    const manifestResponse = await cache.match("/import-share-cache/manifest");
    if (!manifestResponse) return;
    const data = await manifestResponse.json().catch(() => ({}));
    await cache.delete("/import-share-cache/manifest");
    const files = [];
    for (const file of data.files || []) {
      const stored = await cache.match(`/import-share-cache/${file.id}`);
      await cache.delete(`/import-share-cache/${file.id}`);
      if (!stored) continue;
      const blob = await stored.blob();
      files.push(new File([blob], file.name || "list", { type: file.type || blob.type }));
    }
    params.delete("import");
    const next = `${window.location.pathname}${params.toString() ? `?${params}` : ""}`;
    window.history.replaceState({}, "", next);
    open("home");
    if (files[0]) await runFile(files[0]);
    else if (data.url) {
      $("import-link").value = data.url;
      $("import-link-row").hidden = false;
      $("import-link-go").click();
    } else if (data.text || data.title) {
      $("import-paste").value = [data.title, data.text].filter(Boolean).join("\n");
      await runText($("import-paste").value);
    }
  }

  paintEntry();
  paintEmpty();
  paintOnboarding();
  syncOnboarding();
  const empty = document.getElementById("list-empty");
  if (empty) new MutationObserver(() => paintEmpty()).observe(empty, { childList: true, attributes: true, subtree: true });
  const progress = document.getElementById("onboard-progress");
  if (progress) new MutationObserver(syncOnboarding).observe(progress, { childList: true, characterData: true, subtree: true });
  void loadStatus();
  void consumeShare();
  return { open, find, speak };
}
