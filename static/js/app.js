(() => {
  const form = document.getElementById("convert-form");
  const tabUpload = document.getElementById("tab-upload");
  const tabPaste = document.getElementById("tab-paste");
  const panelUpload = document.getElementById("panel-upload");
  const panelPaste = document.getElementById("panel-paste");

  // Upload elements
  const fileInput = document.getElementById("file-input");
  const dropSurface = document.getElementById("drop-surface");
  const fileChip = document.getElementById("file-chip");
  const fileName = document.getElementById("file-name");
  const fileSize = document.getElementById("file-size");

  // Paste elements
  const textarea = document.getElementById("markdown-textarea");
  const customFilename = document.getElementById("custom-filename");
  const loadSampleBtn = document.getElementById("load-sample-btn");
  const clearPasteBtn = document.getElementById("clear-paste-btn");
  const pasteStats = document.getElementById("paste-stats");

  // Shared elements
  const convertingPanel = document.getElementById("converting-panel");
  const convertingLabel = document.getElementById("converting-label");
  const actions = document.getElementById("actions");
  const convertBtn = document.getElementById("convert-btn");
  const clearBtn = document.getElementById("clear-btn");
  const statusEl = document.getElementById("status");
  const hero = document.getElementById("hero");
  const preview = document.getElementById("preview");
  const previewFrame = document.getElementById("preview-frame");
  const previewName = document.getElementById("preview-name");
  const previewSub = document.getElementById("preview-sub");
  const downloadBtn = document.getElementById("download-btn");
  const closePreviewBtn = document.getElementById("close-preview-btn");

  const MAX_BYTES = 5 * 1024 * 1024;
  const ALLOWED = new Set([".md", ".markdown"]);
  const STAGE_MESSAGES = [
    "Parsing Markdown…",
    "Rendering diagrams…",
    "Applying typography…",
    "Generating vector PDF…",
  ];

  const SAMPLE_MARKDOWN = `# Project Architecture & Flow

Welcome to **MD to PDF**. This tool transforms Markdown into print-perfect A4 documents with GitHub typography and auto-scaled vector diagrams.

## System Workflow

\`\`\`mermaid
flowchart TD
    Start([User Uploads / Pastes Markdown]) --> Validate{Validate Input}
    Validate -- Valid --> Engine[Playwright Chromium Engine]
    Validate -- Invalid --> Error[Display Helpful Error Alert]
    Engine --> Mermaid[Render Mermaid Vector Diagrams]
    Mermaid --> Scaler[Apply Auto-Fit Print Scaling]
    Scaler --> PDF([Download Clean A4 PDF])
\`\`\`

## Feature Overview

| Capability | Details |
| :--- | :--- |
| **Instant Preview** | Live high-fidelity preview before downloading |
| **Diagram Support** | Mermaid flowcharts, sequence diagrams, state charts |
| **Clean Typography** | GitHub markdown stylesheet with clear code highlighting |
| **Single-Page Fit** | Scaled SVGs avoid awkward multi-page breaks |

> **Pro Tip:** Press \`Ctrl + Enter\` (or \`Cmd + Enter\`) to generate your PDF immediately!
`;

  let currentMode = "upload";
  let selectedFile = null;
  let userEditedFilename = false;
  let converting = false;
  let previewUrl = null;
  let stageTimer = null;
  let dragDepth = 0;

  function setStatus(message, kind = "info") {
    if (!message) {
      statusEl.hidden = true;
      statusEl.textContent = "";
      statusEl.classList.remove("is-error", "is-success", "is-info");
      return;
    }
    statusEl.hidden = false;
    statusEl.textContent = message;
    statusEl.classList.remove("is-error", "is-success", "is-info");
    statusEl.classList.add(`is-${kind}`);
  }

  function extensionOf(name) {
    const i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i).toLowerCase() : "";
  }

  function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  }

  function validateFile(file) {
    if (!file) return "Choose a Markdown file to continue.";
    const ext = extensionOf(file.name);
    if (!ALLOWED.has(ext)) return "Only .md or .markdown files are accepted.";
    if (file.size === 0) return "That file looks empty.";
    if (file.size > MAX_BYTES) return "File is too large — max 5 MB.";
    return null;
  }

  function stopStageMessages() {
    if (stageTimer) {
      clearInterval(stageTimer);
      stageTimer = null;
    }
  }

  function startStageMessages() {
    stopStageMessages();
    let i = 0;
    convertingLabel.textContent = STAGE_MESSAGES[0];
    stageTimer = setInterval(() => {
      i = (i + 1) % STAGE_MESSAGES.length;
      convertingLabel.textContent = STAGE_MESSAGES[i];
    }, 1500);
  }

  function clearPreview() {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = null;
    }
    previewFrame.onload = null;
    previewFrame.removeAttribute("src");
    preview.hidden = true;
    preview.classList.remove("is-ready");
    hero.classList.remove("has-preview");
    previewName.textContent = "";
    previewSub.textContent = "A4 · Ready to download";
    downloadBtn.removeAttribute("href");
    downloadBtn.removeAttribute("download");
  }

  function showPreview(blob, filename) {
    clearPreview();
    previewUrl = URL.createObjectURL(blob);
    preview.classList.remove("is-ready");
    preview.hidden = false;
    hero.classList.add("has-preview");
    previewName.textContent = filename;
    previewSub.textContent = `A4 · ${formatSize(blob.size)}`;
    downloadBtn.href = previewUrl;
    downloadBtn.download = filename;

    previewFrame.onload = () => {
      preview.classList.add("is-ready");
    };
    previewFrame.src = previewUrl;

    setTimeout(() => preview.classList.add("is-ready"), 1200);

    requestAnimationFrame(() => {
      preview.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function switchMode(mode) {
    if (converting || mode === currentMode) return;
    currentMode = mode;

    if (mode === "upload") {
      tabUpload.classList.add("is-active");
      tabUpload.setAttribute("aria-selected", "true");
      tabPaste.classList.remove("is-active");
      tabPaste.setAttribute("aria-selected", "false");
      panelUpload.hidden = false;
      panelPaste.hidden = true;
      clearBtn.textContent = "Remove file";

      actions.hidden = !selectedFile;
      if (selectedFile) {
        setStatus("File selected — convert when you’re ready.", "info");
      } else {
        setStatus("");
      }
    } else {
      tabPaste.classList.add("is-active");
      tabPaste.setAttribute("aria-selected", "true");
      tabUpload.classList.remove("is-active");
      tabUpload.setAttribute("aria-selected", "false");
      panelPaste.hidden = false;
      panelUpload.hidden = true;
      clearBtn.textContent = "Clear text";

      updateEditorStats();
      textarea.focus();
      if (!textarea.value.trim()) {
        setStatus("Paste or type Markdown code, or click 'Sample' to test.", "info");
      }
    }
  }

  function updateEditorStats() {
    const text = textarea.value;
    const chars = text.length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    pasteStats.textContent = `${words} ${words === 1 ? "word" : "words"} · ${chars} chars`;

    if (currentMode === "paste") {
      actions.hidden = chars === 0;
    }

    if (!userEditedFilename && chars > 0) {
      const match = /^#\s+([^\n\r#]+)/m.exec(text);
      if (match) {
        const title = match[1].trim().slice(0, 40).replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
        if (title) {
          customFilename.value = title;
        }
      }
    }
  }

  function selectFile(file) {
    const error = validateFile(file);
    if (error) {
      clearSelection();
      setStatus(error, "error");
      return;
    }
    clearPreview();
    selectedFile = file;
    form.classList.add("has-file");
    form.classList.remove("is-loading");
    fileChip.hidden = false;
    convertingPanel.hidden = true;
    actions.hidden = false;
    fileName.textContent = file.name;
    fileSize.textContent = `${formatSize(file.size)} · Markdown`;
    setStatus("File selected — convert when you’re ready.", "info");
    convertBtn.focus();
  }

  function clearSelection() {
    selectedFile = null;
    fileInput.value = "";
    form.classList.remove("has-file", "is-loading", "is-dragover");
    fileChip.hidden = true;
    convertingPanel.hidden = true;
    actions.hidden = true;
    clearPreview();
    stopStageMessages();
    setStatus("");
  }

  function clearPaste() {
    textarea.value = "";
    userEditedFilename = false;
    customFilename.value = "document";
    updateEditorStats();
    clearPreview();
    setStatus("Editor cleared.", "info");
    textarea.focus();
  }

  function setLoading(on) {
    converting = on;
    form.classList.toggle("is-loading", on);
    convertBtn.disabled = on;
    clearBtn.disabled = on;
    closePreviewBtn.disabled = on;
    loadSampleBtn.disabled = on;
    clearPasteBtn.disabled = on;
    customFilename.disabled = on;
    tabUpload.disabled = on;
    tabPaste.disabled = on;
    dropSurface.setAttribute("aria-disabled", on ? "true" : "false");
    convertingPanel.hidden = !on;

    if (on) {
      startStageMessages();
    } else {
      stopStageMessages();
    }
  }

  function openPicker() {
    if (converting || form.classList.contains("has-file")) return;
    fileInput.click();
  }

  // Tab switching events
  tabUpload.addEventListener("click", () => switchMode("upload"));
  tabPaste.addEventListener("click", () => switchMode("paste"));

  // Drop surface events
  dropSurface.addEventListener("click", (e) => {
    if (form.classList.contains("has-file") || converting) {
      e.preventDefault();
      return;
    }
    openPicker();
  });

  dropSurface.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openPicker();
    }
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) selectFile(file);
  });

  dropSurface.addEventListener("dragenter", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (converting) return;
    dragDepth += 1;
    form.classList.add("is-dragover");
  });

  dropSurface.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  dropSurface.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) form.classList.remove("is-dragover");
  });

  dropSurface.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepth = 0;
    form.classList.remove("is-dragover");
    if (converting) return;
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) selectFile(file);
  });

  // Editor events
  textarea.addEventListener("input", updateEditorStats);

  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      textarea.value = textarea.value.substring(0, start) + "  " + textarea.value.substring(end);
      textarea.selectionStart = textarea.selectionEnd = start + 2;
      updateEditorStats();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (!converting && textarea.value.trim()) {
        form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event("submit", { cancelable: true }));
      }
    }
  });

  customFilename.addEventListener("input", () => {
    userEditedFilename = true;
  });

  loadSampleBtn.addEventListener("click", () => {
    if (converting) return;
    textarea.value = SAMPLE_MARKDOWN;
    customFilename.value = "Project_Architecture";
    userEditedFilename = true;
    updateEditorStats();
    setStatus("Sample loaded with Mermaid flowchart. Convert to see the result!", "info");
    textarea.focus();
  });

  clearPasteBtn.addEventListener("click", () => {
    if (converting) return;
    clearPaste();
  });

  panelPaste.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  panelPaste.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (converting) return;
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        textarea.value = ev.target.result;
        userEditedFilename = true;
        customFilename.value = file.name.replace(/\.(md|markdown)$/i, "");
        updateEditorStats();
        setStatus(`Loaded content from "${file.name}".`, "info");
      };
      reader.readAsText(file);
    }
  });

  // Global paste detection when in upload tab
  window.addEventListener("paste", (e) => {
    if (currentMode === "upload" && !selectedFile && document.activeElement !== fileInput) {
      const text = e.clipboardData && e.clipboardData.getData("text");
      if (text && text.trim().length > 10) {
        switchMode("paste");
        textarea.value = text;
        updateEditorStats();
        setStatus("Pasted Markdown into editor. Ready to convert.", "info");
        e.preventDefault();
      }
    }
  });

  clearBtn.addEventListener("click", () => {
    if (converting) return;
    if (currentMode === "upload") {
      clearSelection();
    } else {
      clearPaste();
    }
  });

  closePreviewBtn.addEventListener("click", () => {
    if (converting) return;
    clearPreview();
    setStatus("Preview closed. Convert again anytime.", "info");
  });

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || converting) return;
    if (!preview.hidden) {
      clearPreview();
      setStatus("Preview closed.", "info");
    } else if (currentMode === "upload" && selectedFile) {
      clearSelection();
    }
  });

  async function handleConvertResponse(res, fallbackName) {
    if (!res.ok) {
      let detail = "Conversion failed.";
      try {
        const data = await res.json();
        if (data && data.detail) detail = data.detail;
      } catch (_) {
        /* ignore */
      }
      throw new Error(detail);
    }

    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(disposition);
    const downloadName = match
      ? decodeURIComponent(match[1].replace(/"/g, ""))
      : (fallbackName.endsWith(".pdf") ? fallbackName : `${fallbackName}.pdf`);

    showPreview(blob, downloadName);
    setStatus("PDF ready — preview below, or download now.", "success");
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (converting) return;

    if (currentMode === "upload") {
      const error = validateFile(selectedFile);
      if (error) {
        setStatus(error, "error");
        return;
      }

      setLoading(true);
      setStatus("Hang tight — high-fidelity render in progress.", "info");

      const body = new FormData();
      body.append("file", selectedFile, selectedFile.name);

      try {
        const res = await fetch("/api/convert", {
          method: "POST",
          body,
        });
        await handleConvertResponse(res, selectedFile.name);
      } catch (err) {
        clearPreview();
        setStatus(err.message || "Something went wrong.", "error");
      } finally {
        setLoading(false);
      }
    } else {
      const text = textarea.value;
      if (!text || !text.trim()) {
        setStatus("Please enter or paste Markdown code first.", "error");
        textarea.focus();
        return;
      }

      if (new Blob([text]).size > MAX_BYTES) {
        setStatus("Markdown content is too large — max 5 MB.", "error");
        return;
      }

      setLoading(true);
      setStatus("Hang tight — rendering Markdown & diagrams...", "info");

      const rawName = (customFilename.value || "").trim() || "document";
      const cleanStem = rawName.replace(/\.pdf$/i, "").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 60) || "document";
      const exportName = `${cleanStem}.pdf`;

      try {
        const res = await fetch("/api/convert-text", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            markdown: text,
            filename: cleanStem,
          }),
        });
        await handleConvertResponse(res, exportName);
      } catch (err) {
        clearPreview();
        setStatus(err.message || "Something went wrong.", "error");
      } finally {
        setLoading(false);
      }
    }
  });
})();
