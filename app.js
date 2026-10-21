"use strict";

const STORAGE_KEY = "lecto-webapp-v1";
const THEMES = {
  Warm: { background: "#f4f0e8", reader: "#fffaf0", text: "#211f1b", muted: "#716d63", accent: "#266a68" },
  Cool: { background: "#e9f0f2", reader: "#f7fbfc", text: "#17252b", muted: "#5f7076", accent: "#2c6078" },
  Night: { background: "#202628", reader: "#171b1d", text: "#ddf4dd", muted: "#aab7b2", accent: "#2c6078" }
};
const DEFAULT_BOOKS = [
  {
    id: "sample-testing-1",
    title: "Testing File 1",
    author: "Pre-Added",
    sourceText: "This is a test file. It only has a few scentences",
    progress: 0
  },
  {
    id: "sample-testing-2",
    title: "Testing File 2 (With Scrolling)",
    author: "Pre-Added",
    sourceText: "This is another test file. It also has a few scentences. But a lot of numbers. 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64 65 66 67 68 69 70 71 72 73 74 75 76 77 78 79 80",
    progress: 0
  }
];
const DEFAULT_SETTINGS = { chunkSize: 250, theme: "Warm" };
const MIN_READER_TEXT_SIZE = 10;
const MAX_READER_TEXT_SIZE = 28;

const screens = {
  library: document.querySelector("#library-screen"),
  settings: document.querySelector("#settings-screen"),
  reader: document.querySelector("#reader-screen")
};
const libraryList = document.querySelector("#library-list");
const libraryStatus = document.querySelector("#library-status");
const fileInput = document.querySelector("#file-input");
const settingsForm = document.querySelector("#settings-form");
const toast = document.querySelector("#toast");

let state = loadState();
let currentBookId = null;
let toastTimeout;
let gestureStart = null;
let pdfJsPromise = null;
let currentReaderLayout = null;
let readerLayoutRequest = 0;

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { books: structuredClone(DEFAULT_BOOKS), settings: { ...DEFAULT_SETTINGS } };
    const parsed = JSON.parse(stored);
    const books = Array.isArray(parsed.books) ? parsed.books.filter(isValidBook) : [];
    const settings = parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {};
    return {
      books,
      settings: {
        chunkSize: clampInteger(settings.chunkSize, 50, 500, DEFAULT_SETTINGS.chunkSize),
        theme: Object.hasOwn(THEMES, settings.theme) ? settings.theme : DEFAULT_SETTINGS.theme
      }
    };
  } catch (error) {
    console.error("Could not load saved Lecto data.", error);
    return { books: structuredClone(DEFAULT_BOOKS), settings: { ...DEFAULT_SETTINGS } };
  }
}

function isValidBook(book) {
  return book && typeof book.id === "string" && typeof book.title === "string"
    && typeof book.author === "string" && typeof book.sourceText === "string";
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.error("Could not save Lecto data.", error);
    showToast("Your browser could not save this change. Check available site storage.");
    return false;
  }
}

function splitIntoChunks(text, wordLimit) {
  const cleanText = text.replace(/\s+/g, " ").trim();
  if (!cleanText) return ["This Lecto is ready for your first good page."];
  const sentences = cleanText.match(/[^.!?]+(?:[.!?]+|$)/g) || [cleanText];
  const chunks = [];
  let current = [];
  let wordCount = 0;

  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;
    const sentenceWords = sentence.split(/\s+/).length;
    if (current.length && wordCount + sentenceWords > wordLimit) {
      chunks.push(current.join(" "));
      current = [];
      wordCount = 0;
    }
    current.push(sentence);
    wordCount += sentenceWords;
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks.length ? chunks : ["This Lecto is ready for your first good page."];
}

function bookChunks(book) {
  return splitIntoChunks(book.sourceText, state.settings.chunkSize);
}

function showScreen(name) {
  Object.entries(screens).forEach(([screenName, element]) => {
    element.hidden = screenName !== name;
  });
  document.body.classList.toggle("reading", name === "reader");
  if (name === "library") renderLibrary();
  if (name === "settings") populateSettings();
  if (name === "reader") renderReader();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function renderLibrary() {
  libraryList.replaceChildren();
  if (!state.books.length) {
    const empty = document.createElement("div");
    empty.className = "empty-library";
    empty.innerHTML = "<strong>A little room for a good story.</strong>Import a TXT or PDF to add your first book.";
    libraryList.append(empty);
    return;
  }

  for (const book of state.books) {
    const chunks = bookChunks(book);
    const progress = Math.min(Number.isInteger(book.progress) ? book.progress : 0, chunks.length - 1);
    const card = document.createElement("button");
    card.className = "book-card";
    card.type = "button";
    card.setAttribute("aria-label", `Read ${book.title} by ${book.author}`);
    const mark = document.createElement("span");
    mark.className = "book-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = book.title.trim().charAt(0).toUpperCase() || "L";
    const copy = document.createElement("span");
    copy.className = "book-copy";
    const title = document.createElement("span");
    title.className = "book-title";
    title.textContent = book.title;
    const author = document.createElement("span");
    author.className = "book-author";
    author.textContent = book.author;
    copy.append(title, author);
    const progressWrap = document.createElement("span");
    progressWrap.className = "book-progress";
    const progressLabel = document.createElement("span");
    progressLabel.className = "progress-label";
    progressLabel.textContent = `${progress + 1} of ${chunks.length} pages`;
    const track = document.createElement("span");
    track.className = "progress-track";
    const fill = document.createElement("span");
    fill.className = "progress-fill";
    fill.style.width = `${((progress + 1) / chunks.length) * 100}%`;
    track.append(fill);
    progressWrap.append(progressLabel, track);
    card.append(mark, copy, progressWrap);
    card.addEventListener("click", () => openBook(book.id));
    libraryList.append(card);
  }
}

function openBook(bookId) {
  currentBookId = bookId;
  currentReaderLayout = null;
  showScreen("reader");
}

function currentBook() {
  return state.books.find(book => book.id === currentBookId) || null;
}

async function renderReader() {
  const book = currentBook();
  if (!book) {
    showScreen("library");
    return;
  }
  document.querySelector("#reader-title").textContent = book.title;
  document.querySelector("#reader-author").textContent = book.author;
  const readerContent = document.querySelector("#reader-content");
  const request = ++readerLayoutRequest;
  await nextFrame();
  const layoutKey = `${book.id}:${state.settings.chunkSize}:${readerContent.clientWidth}:${readerContent.clientHeight}`;
  let layout = currentReaderLayout;
  if (!layout || layout.key !== layoutKey) {
    readerContent.textContent = "";
    layout = await fitChunksToReader(bookChunks(book), readerContent);
    layout.key = layoutKey;
  }
  if (request !== readerLayoutRequest || currentBook()?.id !== book.id || screens.reader.hidden) return;
  currentReaderLayout = layout;
  book.progress = Math.min(Number.isInteger(book.progress) ? book.progress : 0, layout.chunks.length - 1);
  renderReaderPage(book, layout);
  saveState();
}

function renderReaderPage(book, layout) {
  const readerContent = document.querySelector("#reader-content");
  readerContent.style.setProperty("--reader-text-size", `${layout.fontSize}px`);
  readerContent.textContent = layout.chunks[book.progress];
  document.querySelector("#previous-page").disabled = book.progress === 0;
  document.querySelector("#next-page").disabled = book.progress >= layout.chunks.length - 1;
  document.querySelector("#page-count").textContent = `${String(book.progress + 1).padStart(2, "0")} / ${String(layout.chunks.length).padStart(2, "0")}`;
}

function nextFrame() {
  return new Promise(resolve => window.requestAnimationFrame(resolve));
}

async function fitChunksToReader(chunks, element) {
  const measureFits = async (candidateChunks, fontSize) => {
    element.style.setProperty("--reader-text-size", `${fontSize}px`);
    await nextFrame();
    for (const chunk of candidateChunks) {
      element.textContent = chunk;
      if (element.scrollHeight > element.clientHeight + 1) return false;
    }
    return true;
  };

  const fittedChunks = chunks.slice();
  element.style.setProperty("--reader-text-size", `${MIN_READER_TEXT_SIZE}px`);
  await nextFrame();
  for (let index = 0; index < fittedChunks.length;) {
    element.textContent = fittedChunks[index];
    if (element.scrollHeight <= element.clientHeight + 1) {
      index += 1;
      continue;
    }

    const words = fittedChunks[index].split(/\s+/);
    if (words.length === 1) {
      const midpoint = Math.ceil(words[0].length / 2);
      if (midpoint === 0 || midpoint === words[0].length) {
        index += 1;
        continue;
      }
      fittedChunks.splice(index, 1, words[0].slice(0, midpoint), words[0].slice(midpoint));
    } else {
      const midpoint = Math.ceil(words.length / 2);
      fittedChunks.splice(index, 1, words.slice(0, midpoint).join(" "), words.slice(midpoint).join(" "));
    }
  }

  let low = MIN_READER_TEXT_SIZE;
  let high = MAX_READER_TEXT_SIZE;
  while (high - low > 0.25) {
    const middle = (low + high) / 2;
    if (await measureFits(fittedChunks, middle)) low = middle;
    else high = middle;
  }
  const fontSize = Math.floor(low * 10) / 10;
  element.style.setProperty("--reader-text-size", `${fontSize}px`);
  await nextFrame();
  return { chunks: fittedChunks, fontSize };
}

function changePage(direction) {
  const book = currentBook();
  if (!book) return;
  if (!currentReaderLayout || currentReaderLayout.chunks.length === 0) {
    renderReader();
    return;
  }
  const nextProgress = Math.max(0, Math.min(currentReaderLayout.chunks.length - 1, book.progress + direction));
  if (nextProgress === book.progress) return;
  book.progress = nextProgress;
  saveState();
  renderReaderPage(book, currentReaderLayout);
}

function populateSettings() {
  document.querySelector("#chunk-size").value = state.settings.chunkSize;
  document.querySelector("#chunk-size-output").value = state.settings.chunkSize;
  document.querySelector("#chunk-size-output").textContent = state.settings.chunkSize;
  const themeInput = settingsForm.querySelector(`input[name="theme"][value="${state.settings.theme}"]`);
  if (themeInput) themeInput.checked = true;
}

function applyTheme(themeName) {
  const theme = THEMES[themeName];
  const root = document.documentElement;
  root.style.setProperty("--background", theme.background);
  root.style.setProperty("--reader-background", theme.reader);
  root.style.setProperty("--text", theme.text);
  root.style.setProperty("--muted", theme.muted);
  root.style.setProperty("--accent", theme.accent);
  root.style.setProperty("--soft-accent", `${theme.accent}18`);
  root.style.colorScheme = themeName === "Night" ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]').content = theme.background;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 4200);
}

async function importFile(file) {
  if (!file) return;
  const extension = file.name.toLowerCase().split(".").pop();
  try {
    let text;
    if (extension === "pdf") {
      text = await extractPdfText(file);
    } else if (extension === "txt") {
      text = await file.text();
    } else {
      throw new Error("Choose a .txt or .pdf file.");
    }
    if (!text.trim()) throw new Error("No readable text was found in that file.");
    const title = file.name.replace(/\.[^.]+$/, "").replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase());
    const book = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      title: title || "Untitled",
      author: "Imported by you",
      sourceText: text,
      progress: 0
    };
    state.books.unshift(book);
    if (saveState()) {
      libraryStatus.textContent = "";
      showScreen("library");
      showToast("Added to your library.");
    } else {
      state.books.shift();
    }
  } catch (error) {
    console.error("Could not import file.", error);
    libraryStatus.textContent = error instanceof Error ? error.message : "The file could not be imported.";
  } finally {
    fileInput.value = "";
  }
}

async function extractPdfText(file) {
  if (!window.pdfjsLib) {
    await loadPdfJs();
  }
  const pdfjs = window.pdfjsLib;
  if (!pdfjs) throw new Error("PDF support could not be loaded. Check your internet connection and try again.");
  pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(content.items.map(item => "str" in item ? item.str : "").join(" "));
  }
  return pages.join("\n\n");
}

function loadPdfJs() {
  if (window.pdfjsLib) return Promise.resolve();
  if (pdfJsPromise) return pdfJsPromise;
  pdfJsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
    script.dataset.pdfjs = "true";
    script.onload = () => resolve();
    script.onerror = () => {
      script.remove();
      pdfJsPromise = null;
      reject(new Error("PDF support could not be loaded. Check your internet connection."));
    };
    document.head.append(script);
  });
  return pdfJsPromise;
}

document.querySelector("#settings-button").addEventListener("click", () => showScreen("settings"));
document.querySelector("#import-button").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", event => importFile(event.target.files[0]));
document.querySelectorAll("[data-screen]").forEach(button => {
  button.addEventListener("click", () => showScreen(button.dataset.screen));
});
document.querySelector("#chunk-size").addEventListener("input", event => {
  document.querySelector("#chunk-size-output").value = event.target.value;
  document.querySelector("#chunk-size-output").textContent = event.target.value;
});
settingsForm.addEventListener("submit", event => {
  event.preventDefault();
  const formData = new FormData(settingsForm);
  state.settings = {
    chunkSize: clampInteger(formData.get("chunkSize"), 50, 500, DEFAULT_SETTINGS.chunkSize),
    theme: Object.hasOwn(THEMES, formData.get("theme")) ? formData.get("theme") : DEFAULT_SETTINGS.theme
  };
  for (const book of state.books) {
    book.progress = Math.min(Number.isInteger(book.progress) ? book.progress : 0, bookChunks(book).length - 1);
  }
  applyTheme(state.settings.theme);
  if (saveState()) {
    showScreen("library");
    showToast("Your reading settings are saved.");
  }
});
document.querySelector("#previous-page").addEventListener("click", () => changePage(-1));
document.querySelector("#next-page").addEventListener("click", () => changePage(1));

const readerContent = document.querySelector("#reader-content");
readerContent.addEventListener("pointerdown", event => {
  if (!event.isPrimary || event.button !== 0) return;
  gestureStart = {
    x: event.clientX,
    y: event.clientY,
    pointerId: event.pointerId,
  };
  readerContent.classList.add("gesture-active");
  if (event.isTrusted) readerContent.setPointerCapture(event.pointerId);
  event.preventDefault();
});
readerContent.addEventListener("pointerup", event => {
  if (!gestureStart || event.pointerId !== gestureStart.pointerId) return;
  const start = gestureStart;
  const deltaX = event.clientX - start.x;
  const deltaY = event.clientY - start.y;
  gestureStart = null;
  readerContent.classList.remove("gesture-active");
  if (Math.abs(deltaY) < 45 || Math.abs(deltaY) <= Math.abs(deltaX)) return;
  changePage(deltaY < 0 ? 1 : -1);
});
readerContent.addEventListener("pointercancel", () => {
  gestureStart = null;
  readerContent.classList.remove("gesture-active");
});
readerContent.addEventListener("lostpointercapture", () => {
  gestureStart = null;
  readerContent.classList.remove("gesture-active");
});
document.addEventListener("keydown", event => {
  if (screens.reader.hidden || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") changePage(1);
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") changePage(-1);
  if (event.key === "Escape") showScreen("library");
});
let resizeFrame = 0;
window.addEventListener("resize", () => {
  if (screens.reader.hidden || resizeFrame) return;
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = 0;
    currentReaderLayout = null;
    renderReader();
  });
});

applyTheme(state.settings.theme);
renderLibrary();
