"use strict";

const STORAGE_KEY = "lecto-webapp-v1";
const LEGACY_DEFAULT_BOOK_IDS = new Set(["sample-testing-1", "sample-testing-2"]);
const THEMES = {
  Warm: { background: "#f4f0e8", reader: "#fffaf0", text: "#211f1b", muted: "#716d63", accent: "#266a68" },
  Cool: { background: "#e9f0f2", reader: "#f7fbfc", text: "#17252b", muted: "#5f7076", accent: "#2c6078" },
  Night: { background: "#202628", reader: "#171b1d", text: "#ddf4dd", muted: "#aab7b2", accent: "#2c6078" },
  Sage: { background: "#e8eee5", reader: "#f5f8f1", text: "#243027", muted: "#657367", accent: "#52745a" },
  Rose: { background: "#f3e8e8", reader: "#fff7f5", text: "#342426", muted: "#786568", accent: "#9a5368" },
  Lavender: { background: "#eeeaf4", reader: "#faf7ff", text: "#292336", muted: "#6c657a", accent: "#7256a5" },
  Forest: { background: "#1d2924", reader: "#17211d", text: "#e3efe5", muted: "#aab9ad", accent: "#3a6b45" }
};
const DEFAULT_BOOKS = [
  {
    id: "welcome-to-lecto",
    title: "Welcome to Lecto!",
    author: "Your reading guide",
    chapters: [
      {
        title: "Welcome",
        text: "Welcome to Lecto, a personalized reading improvement experience. This short guide walks you through the features so you can settle in and start reading. Use the chapter menu at the top to jump between topics, or turn pages to explore them in order."
      },
      {
        title: "Your library",
        text: "Your library keeps the books you add on this device. Choose a book to continue reading; Lecto remembers your place as you go. To remove a book, use its delete button and confirm the choice in the dialog."
      },
      {
        title: "Import a book",
        text: "Choose Import a book in your library to add a file. Lecto can read plain text TXT, PDF, EPUB, MOBI, AZW, and AZW3 files. Some MOBI and Kindle files use DRM or unsupported variants and may not open. Imported books are kept in this app locally."
      },
      {
        title: "Chapters and pages",
        text: "For books with chapter information, use the Chapter menu to jump straight to a chapter. Chapter breaks start a fresh page sequence. Use Previous and Next, the arrow keys, or swipe vertically on the reading page to turn pages."
      }
    ],
    progress: 0
  }
];
const DEFAULT_SETTINGS = { chunkSize: 250, theme: "Warm" };
const MIN_READER_TEXT_SIZE = 10;
const MIN_READER_MAX_TEXT_SIZE = 28;
const MAX_READER_MAX_TEXT_SIZE = 48;

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
const deleteBookDialog = document.querySelector("#delete-book-dialog");
const installDialog = document.querySelector("#install-dialog");
const installDialogMessage = document.querySelector("#install-dialog-message");
const installDialogSteps = document.querySelector("#install-dialog-steps");
const confirmInstallButton = document.querySelector("#confirm-install");
let deleteBookId = null;
let deferredInstallPrompt = null;
let installPlatform = null;

let needsLibraryMigration = false;
let state = loadState();
if (needsLibraryMigration) saveState();
let currentBookId = null;
let toastTimeout;
let gestureStart = null;
let pdfJsPromise = null;
let epubSupportPromise = null;
let mobiSupportPromise = null;
let currentReaderLayout = null;
let readerLayoutRequest = 0;

function loadState() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { books: structuredClone(DEFAULT_BOOKS), settings: { ...DEFAULT_SETTINGS } };
    const parsed = JSON.parse(stored);
    let books = Array.isArray(parsed.books) ? parsed.books.filter(isValidBook) : [];
    if (books.some(book => LEGACY_DEFAULT_BOOK_IDS.has(book.id))) {
      books = books.filter(book => !LEGACY_DEFAULT_BOOK_IDS.has(book.id));
      if (!books.some(book => book.id === "welcome-to-lecto")) {
        books.unshift(structuredClone(DEFAULT_BOOKS[0]));
      }
      needsLibraryMigration = true;
    }
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
    && typeof book.author === "string"
    && (typeof book.sourceText === "string" || (Array.isArray(book.chapters)
      && book.chapters.some(chapter => chapter && typeof chapter.title === "string"
        && typeof chapter.text === "string" && chapter.text.trim())));
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
    const words = sentence.split(/\s+/);
    const sentenceWords = words.length;
    if (current.length && wordCount + sentenceWords > wordLimit) {
      chunks.push(current.join(" "));
      current = [];
      wordCount = 0;
    }
    if (sentenceWords > wordLimit) {
      for (let index = 0; index < words.length; index += wordLimit) {
        chunks.push(words.slice(index, index + wordLimit).join(" "));
      }
      continue;
    }
    current.push(sentence);
    wordCount += sentenceWords;
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks.length ? chunks : ["This Lecto is ready for your first good page."];
}

function bookChapters(book) {
  const chapters = Array.isArray(book.chapters)
    ? book.chapters.filter(chapter => chapter && typeof chapter.text === "string" && chapter.text.trim())
    : [];
  return chapters.length ? chapters : [{ title: "", text: book.sourceText || "" }];
}

function bookChunks(book) {
  const chapters = bookChapters(book);
  return chapters.flatMap((chapter, chapterIndex) =>
    splitIntoChunks(chapter.text, state.settings.chunkSize).map(text => ({
      text,
      chapterIndex,
      chapterTitle: chapter.title
    }))
  );
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
    empty.innerHTML = "<strong>A little room for a good story.</strong>Import a TXT, PDF, EPUB, MOBI, AZW, or AZW3 to add your first book.";
    libraryList.append(empty);
    return;
  }

  for (const book of state.books) {
    const chunks = bookChunks(book);
    const progress = Math.min(Number.isInteger(book.progress) ? book.progress : 0, chunks.length - 1);
    const card = document.createElement("article");
    card.className = "book-card";
    const mark = document.createElement("span");
    mark.className = "book-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = book.title.trim().charAt(0).toUpperCase() || "L";
    const openButton = document.createElement("button");
    openButton.className = "book-open";
    openButton.type = "button";
    openButton.setAttribute("aria-label", `Read ${book.title} by ${book.author}`);
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
    const progressPercentage = document.createElement("span");
    progressPercentage.className = "progress-percentage";
    const completion = Math.round(((progress + 1) / chunks.length) * 100);
    progressPercentage.textContent = `${completion}% finished`;
    const track = document.createElement("span");
    track.className = "progress-track";
    const fill = document.createElement("span");
    fill.className = "progress-fill";
    fill.style.width = `${completion}%`;
    track.append(fill);
    progressWrap.append(progressLabel, progressPercentage, track);
    openButton.append(copy, progressWrap);
    openButton.addEventListener("click", () => openBook(book.id));
    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-book-button";
    deleteButton.type = "button";
    deleteButton.setAttribute("aria-label", `Delete ${book.title}`);
    deleteButton.title = "Delete book";
    deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></svg>';
    deleteButton.addEventListener("click", () => requestDeleteBook(book.id));
    card.append(mark, openButton, deleteButton);
    libraryList.append(card);
    fitTitleToTwoLines(title, 19, 15);
  }
}

function requestDeleteBook(bookId) {
  const book = state.books.find(item => item.id === bookId);
  if (!book) return;
  deleteBookId = bookId;
  document.querySelector("#delete-dialog-message").textContent = `“${book.title}” will be removed from your library and its saved reading progress deleted.`;
  deleteBookDialog.showModal();
  document.querySelector("#cancel-delete").focus();
}

function deleteBook(bookId) {
  const bookIndex = state.books.findIndex(book => book.id === bookId);
  if (bookIndex < 0) return;
  const [book] = state.books.splice(bookIndex, 1);
  if (!saveState()) {
    state.books.splice(bookIndex, 0, book);
    return;
  }
  renderLibrary();
  showToast("Book removed from your library.");
}

function fitTitleToTwoLines(element, baseSize, minimumSize) {
  element.style.fontSize = `${baseSize}px`;
  const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight);
  while (element.scrollHeight > lineHeight * 2 + 1
    && Number.parseFloat(element.style.fontSize) > minimumSize) {
    element.style.fontSize = `${Number.parseFloat(element.style.fontSize) - 1}px`;
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
  const readerTitle = document.querySelector("#reader-title");
  readerTitle.style.fontSize = "";
  fitTitleToTwoLines(readerTitle, Number.parseFloat(getComputedStyle(readerTitle).fontSize), 14);
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

function renderReaderPage(book, layout, direction = 0) {
  const readerContent = document.querySelector("#reader-content");
  const previousContent = readerContent.textContent;
  const viewport = readerContent.parentElement;
  if (direction !== 0 && previousContent) {
    viewport.querySelectorAll(".reader-page-layer").forEach(layer => layer.remove());
    const makeLayer = text => {
      const layer = readerContent.cloneNode(true);
      layer.removeAttribute("id");
      layer.removeAttribute("tabindex");
      layer.setAttribute("aria-hidden", "true");
      layer.classList.remove("gesture-active");
      layer.classList.add("reader-page-layer");
      layer.textContent = text;
      return layer;
    };
    const outgoing = makeLayer(previousContent);
    const incoming = makeLayer(layout.chunks[book.progress].text);
    outgoing.classList.add(direction > 0 ? "leave-up" : "leave-down");
    incoming.classList.add(direction > 0 ? "enter-from-below" : "enter-from-above");
    readerContent.classList.add("page-transition-active");
    viewport.append(outgoing, incoming);

    incoming.addEventListener("transitionend", event => {
      if (event.propertyName !== "transform") return;
      outgoing.remove();
      incoming.remove();
      readerContent.classList.remove("page-transition-active");
    }, { once: true });
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        outgoing.classList.add("is-moving");
        incoming.classList.add("is-moving");
      });
    });
  }
  readerContent.style.setProperty("--reader-text-size", `${layout.fontSize}px`);
  const currentPage = layout.chunks[book.progress];
  readerContent.textContent = currentPage.text;
  updateChapterNavigation(book, layout, currentPage.chapterIndex);
  document.querySelector("#previous-page").disabled = book.progress === 0;
  document.querySelector("#next-page").disabled = book.progress >= layout.chunks.length - 1;
  document.querySelector("#page-count").textContent = `${String(book.progress + 1).padStart(2, "0")} / ${String(layout.chunks.length).padStart(2, "0")}`;
}

function updateChapterNavigation(book, layout, chapterIndex) {
  const navigation = document.querySelector("#chapter-navigation");
  const chapterPicker = document.querySelector("#chapter-picker-toggle");
  const chapterPickerValue = document.querySelector("#chapter-picker-value");
  const chapterMenu = document.querySelector("#chapter-picker-menu");
  const chapterTitle = document.querySelector("#reader-chapter-title");
  const chapterPages = new Map();
  layout.chunks.forEach((page, index) => {
    if (!chapterPages.has(page.chapterIndex)) chapterPages.set(page.chapterIndex, index);
  });

  const chapters = bookChapters(book);
  navigation.hidden = chapters.length < 2 || chapterPages.size < 2;
  const activeChapter = chapters[chapterIndex];
  chapterTitle.textContent = activeChapter?.title || "";
  chapterTitle.hidden = navigation.hidden || !chapterTitle.textContent;
  if (navigation.hidden) return;

  if (chapterMenu.dataset.bookId !== book.id
    || chapterMenu.children.length !== chapterPages.size
    || [...chapterMenu.children].some((option, index) => option.dataset.chapterIndex !== String([...chapterPages.keys()][index]))) {
    chapterMenu.replaceChildren();
    for (const index of chapterPages.keys()) {
      const option = document.createElement("button");
      option.type = "button";
      option.className = "chapter-picker-option";
      option.setAttribute("role", "option");
      option.tabIndex = -1;
      option.dataset.chapterIndex = String(index);
      const page = layout.chunks[chapterPages.get(index)];
      option.textContent = page.chapterTitle || `Chapter ${index + 1}`;
      option.addEventListener("click", () => {
        jumpToChapter(index);
        closeChapterPicker();
        chapterPicker.focus();
      });
      chapterMenu.append(option);
    }
    chapterMenu.dataset.bookId = book.id;
  }
  const selectedOption = [...chapterMenu.children].find(option => option.dataset.chapterIndex === String(chapterIndex));
  if (selectedOption) {
    chapterPickerValue.textContent = selectedOption.textContent;
    for (const option of chapterMenu.children) {
      option.setAttribute("aria-selected", String(option === selectedOption));
    }
  }
}

function openChapterPicker(focusLast = false) {
  const toggle = document.querySelector("#chapter-picker-toggle");
  const menu = document.querySelector("#chapter-picker-menu");
  menu.hidden = false;
  toggle.setAttribute("aria-expanded", "true");
  const options = [...menu.querySelectorAll('[role="option"]')];
  const selected = options.find(option => option.getAttribute("aria-selected") === "true");
  (focusLast ? options[options.length - 1] : selected || options[0])?.focus();
}

function closeChapterPicker() {
  document.querySelector("#chapter-picker-menu").hidden = true;
  document.querySelector("#chapter-picker-toggle").setAttribute("aria-expanded", "false");
}

function nextFrame() {
  return new Promise(resolve => window.requestAnimationFrame(resolve));
}

async function fitChunksToReader(chunks, element) {
  const maxFontSize = MAX_READER_MAX_TEXT_SIZE
    - ((state.settings.chunkSize - 50) / 450)
      * (MAX_READER_MAX_TEXT_SIZE - MIN_READER_MAX_TEXT_SIZE);
  const measureFits = async (candidateChunks, fontSize) => {
    element.style.setProperty("--reader-text-size", `${fontSize}px`);
    await nextFrame();
    for (const chunk of candidateChunks) {
      element.textContent = chunk.text;
      if (element.scrollHeight > element.clientHeight + 1) return false;
    }
    return true;
  };

  const fittedChunks = chunks.slice();
  element.style.setProperty("--reader-text-size", `${MIN_READER_TEXT_SIZE}px`);
  await nextFrame();
  for (let index = 0; index < fittedChunks.length;) {
    element.textContent = fittedChunks[index].text;
    if (element.scrollHeight <= element.clientHeight + 1) {
      index += 1;
      continue;
    }

    const currentChunk = fittedChunks[index];
    const words = currentChunk.text.split(/\s+/);
    if (words.length === 1) {
      const midpoint = Math.ceil(words[0].length / 2);
      if (midpoint === 0 || midpoint === words[0].length) {
        index += 1;
        continue;
      }
      fittedChunks.splice(index, 1,
        { ...currentChunk, text: words[0].slice(0, midpoint) },
        { ...currentChunk, text: words[0].slice(midpoint) });
    } else {
      const midpoint = Math.ceil(words.length / 2);
      fittedChunks.splice(index, 1,
        { ...currentChunk, text: words.slice(0, midpoint).join(" ") },
        { ...currentChunk, text: words.slice(midpoint).join(" ") });
    }
  }

  let low = MIN_READER_TEXT_SIZE;
  let high = maxFontSize;
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
  renderReaderPage(book, currentReaderLayout, direction);
}

function jumpToChapter(chapterIndex) {
  const book = currentBook();
  if (!book || !currentReaderLayout) return;
  const targetProgress = currentReaderLayout.chunks.findIndex(page => page.chapterIndex === chapterIndex);
  if (targetProgress < 0 || targetProgress === book.progress) return;
  const direction = targetProgress > book.progress ? 1 : -1;
  book.progress = targetProgress;
  saveState();
  renderReaderPage(book, currentReaderLayout, direction);
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
  root.style.colorScheme = themeName === "Night" || themeName === "Forest" ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]').content = theme.background;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => toast.classList.remove("visible"), 4200);
}

function detectInstallPlatform() {
  const userAgent = navigator.userAgent;
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)) return "apple";
  return null;
}

function isInstalledAsApp() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function isSecureInstallOrigin() {
  return location.protocol === "https:"
    || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
}

function showInstallPrompt() {
  installPlatform = detectInstallPlatform();
  if (!installPlatform || !isSecureInstallOrigin() || isInstalledAsApp()
    || sessionStorage.getItem("lecto-install-prompt-dismissed")) return;

  const instructions = installPlatform === "apple"
    ? {
      message: "Add Lecto to your Home Screen for a focused, app-like reading experience.",
      steps: ["Open this page in Safari.", "Tap the Share button.", "Choose “Add to Home Screen,” then tap “Add.”"]
    }
    : {
      message: "Install Lecto to add it to your phone’s app library and open it like an app.",
      steps: ["Tap “Install app” when your browser offers it.", "If there is no install button, open the browser menu and choose “Install app” or “Add to Home screen.”"]
    };
  installDialogMessage.textContent = instructions.message;
  installDialogSteps.replaceChildren(...instructions.steps.map(text => {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }));
  confirmInstallButton.textContent = installPlatform === "android" && deferredInstallPrompt
    ? "Install app"
    : "Got it";
  installDialog.showModal();
}

function dismissInstallPrompt() {
  sessionStorage.setItem("lecto-install-prompt-dismissed", "true");
  installDialog.close();
}

window.addEventListener("beforeinstallprompt", event => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (installPlatform === "android" && installDialog.open) {
    confirmInstallButton.textContent = "Install app";
  }
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  if (installDialog.open) installDialog.close();
});
document.querySelector("#dismiss-install").addEventListener("click", dismissInstallPrompt);
confirmInstallButton.addEventListener("click", async () => {
  if (installPlatform !== "android" || !deferredInstallPrompt) {
    dismissInstallPrompt();
    return;
  }
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  await promptEvent.prompt();
  await promptEvent.userChoice;
  dismissInstallPrompt();
});

async function importFile(file) {
  if (!file) return;
  const extension = file.name.toLowerCase().split(".").pop();
  try {
    let text;
    let chapters;
    if (extension === "pdf") {
      text = await extractPdfText(file);
    } else if (extension === "txt") {
      text = await file.text();
    } else if (extension === "epub") {
      chapters = await extractEbookText(file, "epub");
      text = chapters.map(chapter => chapter.text).join("\n\n");
    } else if (["mobi", "azw", "azw3"].includes(extension)) {
      chapters = await extractEbookText(file, "mobi");
      text = chapters.map(chapter => chapter.text).join("\n\n");
    } else {
      throw new Error("Choose a TXT, PDF, EPUB, MOBI, AZW, or AZW3 file.");
    }
    if (!text.trim()) throw new Error("No readable text was found in that file.");
    const title = file.name.replace(/\.[^.]+$/, "").replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase());
    const book = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      title: title || "Untitled",
      author: "Imported by you",
      ...(chapters ? { chapters } : { sourceText: text }),
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

async function extractEbookText(file, format) {
  const cdnRoot = "https://cdn.jsdelivr.net/gh/johnfactotum/foliate-js@78914aef4466eb960965702401634c2cb348e9b1";
  let book;
  let closeLoader = () => {};
  try {
    if (format === "epub") {
      const [{ EPUB }, zip] = await loadEpubSupport(cdnRoot);
      zip.configure({ useWebWorkers: false });
      const loader = await makeEpubZipLoader(file, zip);
      closeLoader = loader.close;
      book = await new EPUB(loader).init();
    } else {
      const [{ MOBI }, fflate] = await loadMobiSupport(cdnRoot);
      book = await new MOBI({ unzlib: fflate.unzlibSync }).open(file);
    }
  } catch (error) {
    await closeLoader();
    if (error instanceof TypeError && /fetch|import|module/i.test(error.message)) {
      throw new Error(`${format.toUpperCase()} support could not be loaded. Check your internet connection and try again.`);
    }
    throw new Error(`Could not read this ${format.toUpperCase()} file. It may be DRM-protected or use an unsupported format.`);
  }

  try {
    const sections = [];
    for (const [index, section] of book.sections.entries()) {
      const document = await section.createDocument();
      sections.push(...extractDocumentChapters(document, `Chapter ${index + 1}`));
    }
    if (!sections.length) throw new Error(`No readable text was found in that ${format.toUpperCase()} file.`);
    return sections;
  } finally {
    await closeLoader();
  }
}

function extractDocumentChapters(document, fallbackTitle) {
  const body = document.body || document.documentElement;
  const headingTag = body.querySelector("h1") ? "H1" : "H2";
  const fallback = document.querySelector("title")?.textContent?.trim() || fallbackTitle;
  const blockTags = new Set(["ADDRESS", "BLOCKQUOTE", "BR", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "P", "PRE", "SECTION", "TR"]);
  const chapters = [];
  const parts = [];
  let title = fallback;
  const flushChapter = () => {
    const text = parts.join("")
      .replace(/[ \t]*\n[ \t]*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (text) chapters.push({ title: title.replace(/\s+/g, " ").slice(0, 160), text });
    parts.length = 0;
  };
  const visit = node => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent);
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const tagName = node.tagName.toUpperCase();
    if (["SCRIPT", "STYLE", "NOSCRIPT"].includes(tagName)) return;
    if (tagName === headingTag) {
      flushChapter();
      title = node.textContent.trim() || `Chapter ${chapters.length + 1}`;
      return;
    }
    const isBlock = blockTags.has(tagName);
    if (isBlock) parts.push("\n");
    for (const child of node.childNodes) visit(child);
    if (isBlock) parts.push("\n");
  };
  visit(body);
  flushChapter();
  return chapters;
}

async function loadEpubSupport(cdnRoot) {
  if (!epubSupportPromise) {
    epubSupportPromise = Promise.all([
      import(`${cdnRoot}/epub.js`),
      import(`${cdnRoot}/vendor/zip.js`)
    ]).catch(error => {
      epubSupportPromise = null;
      throw error;
    });
  }
  return epubSupportPromise;
}

async function loadMobiSupport(cdnRoot) {
  if (!mobiSupportPromise) {
    mobiSupportPromise = Promise.all([
      import(`${cdnRoot}/mobi.js`),
      import(`${cdnRoot}/vendor/fflate.js`)
    ]).catch(error => {
      mobiSupportPromise = null;
      throw error;
    });
  }
  return mobiSupportPromise;
}

async function makeEpubZipLoader(file, zip) {
  const reader = new zip.ZipReader(new zip.BlobReader(file));
  const entries = await reader.getEntries();
  const entryMap = new Map(entries.map(entry => [entry.filename, entry]));
  const loadText = async path => {
    const entry = entryMap.get(path);
    return entry ? entry.getData(new zip.TextWriter()) : null;
  };
  const loadBlob = async (path, type) => {
    const entry = entryMap.get(path);
    return entry ? entry.getData(new zip.BlobWriter(type)) : null;
  };
  const getSize = path => entryMap.get(path)?.uncompressedSize ?? 0;
  return { loadText, loadBlob, getSize, close: () => reader.close() };
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
const chapterPickerToggle = document.querySelector("#chapter-picker-toggle");
const chapterPickerMenu = document.querySelector("#chapter-picker-menu");
chapterPickerToggle.addEventListener("click", () => {
  if (chapterPickerMenu.hidden) openChapterPicker();
  else closeChapterPicker();
});
chapterPickerToggle.addEventListener("keydown", event => {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    openChapterPicker(event.key === "ArrowUp");
  }
});
chapterPickerMenu.addEventListener("keydown", event => {
  const options = [...chapterPickerMenu.querySelectorAll('[role="option"]')];
  const currentIndex = options.indexOf(document.activeElement);
  let nextIndex = currentIndex;
  if (event.key === "ArrowDown") nextIndex = Math.min(options.length - 1, currentIndex + 1);
  else if (event.key === "ArrowUp") nextIndex = Math.max(0, currentIndex - 1);
  else if (event.key === "Home") nextIndex = 0;
  else if (event.key === "End") nextIndex = options.length - 1;
  else if (event.key === "Escape") {
    event.preventDefault();
    closeChapterPicker();
    chapterPickerToggle.focus();
    return;
  } else {
    return;
  }
  event.preventDefault();
  options[nextIndex]?.focus();
});
document.addEventListener("pointerdown", event => {
  if (!event.target.closest(".chapter-picker")) closeChapterPicker();
});
document.querySelector("#cancel-delete").addEventListener("click", () => {
  deleteBookId = null;
  deleteBookDialog.close();
});
document.querySelector("#confirm-delete").addEventListener("click", () => {
  const bookId = deleteBookId;
  deleteBookId = null;
  deleteBookDialog.close();
  if (bookId) deleteBook(bookId);
});
deleteBookDialog.addEventListener("close", () => {
  deleteBookId = null;
});

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
  if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, button, [contenteditable='true']")) return;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") changePage(1);
  if (event.key === "ArrowLeft" || event.key === "ArrowUp") changePage(-1);
  if (event.key === "Escape") showScreen("library");
});
let resizeFrame = 0;
window.addEventListener("resize", () => {
  if ((screens.reader.hidden && screens.library.hidden) || resizeFrame) return;
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = 0;
    if (!screens.reader.hidden) {
      currentReaderLayout = null;
      renderReader();
    } else if (!screens.library.hidden) {
      renderLibrary();
    }
  });
});

applyTheme(state.settings.theme);
renderLibrary();
if ("serviceWorker" in navigator && isSecureInstallOrigin()) {
  navigator.serviceWorker.register("./service-worker.js")
    .catch(error => console.error("Could not register the Lecto service worker.", error));
}
if (detectInstallPlatform() && isSecureInstallOrigin() && !isInstalledAsApp()) {
  window.setTimeout(showInstallPrompt, 900);
}
