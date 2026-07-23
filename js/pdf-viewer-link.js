/**
 * GuidePdfLink equivalent — "View Resume" trigger + modal portal.
 * Progressive enhancement: the CTA is a real <a href="...pdf"> so the resume
 * remains reachable when JS is disabled or this module fails to init.
 * With JS, clicks open the modal viewer instead of navigating away.
 */
import { mountPdfViewer } from "./pdf-viewer.js";

function isPdf(url) {
  try {
    const path = new URL(url, window.location.href).pathname.toLowerCase();
    return path.endsWith(".pdf");
  } catch {
    return String(url).toLowerCase().includes(".pdf");
  }
}

function createModal({ title, file }) {
  const modal = document.createElement("div");
  modal.className = "pdf-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-label", title || "Document viewer");

  modal.innerHTML = `
    <div class="pdf-modal__backdrop" data-pdf-close></div>
    <div class="pdf-modal__panel">
      <header class="pdf-modal__header">
        <h2 class="pdf-modal__title">${escapeHtml(title || "Resume")}</h2>
        <div class="pdf-modal__header-actions">
          <a class="pdf-modal__download" href="${escapeAttr(file)}" download="Peter_Johnstone_Resume_7_23_2026.pdf">Download PDF</a>
          <button type="button" class="pdf-modal__close" data-pdf-close aria-label="Close">×</button>
        </div>
      </header>
      <div class="pdf-modal__body" data-pdf-host></div>
    </div>
  `;

  return modal;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("'", "&#39;");
}

function openPdfLink(trigger) {
  const file = trigger.getAttribute("href") || trigger.getAttribute("data-file");
  const title = trigger.getAttribute("data-title") || "Resume";
  if (!file) return;

  const modal = createModal({ title, file });
  const host = modal.querySelector("[data-pdf-host]");
  let dispose = null;
  const previousOverflow = document.body.style.overflow;

  function close() {
    dispose?.();
    dispose = null;
    document.removeEventListener("keydown", onKeyDown);
    modal.remove();
    document.body.style.overflow = previousOverflow;
    trigger.focus();
  }

  function onKeyDown(event) {
    if (event.key === "Escape") close();
  }

  modal.addEventListener("click", (event) => {
    if (event.target.closest("[data-pdf-close]")) close();
  });

  document.body.append(modal);
  document.body.style.overflow = "hidden";
  document.addEventListener("keydown", onKeyDown);
  modal.querySelector(".pdf-modal__close")?.focus();

  if (isPdf(file)) {
    mountPdfViewer(host, { src: file, title }).then((cleanup) => {
      dispose = cleanup;
    });
  } else {
    const img = document.createElement("img");
    img.className = "pdf-modal__image";
    img.src = file;
    img.alt = title;
    host.replaceChildren(img);
  }
}

function initPdfLinks() {
  document.querySelectorAll("[data-pdf-link]").forEach((trigger) => {
    trigger.addEventListener("click", (event) => {
      event.preventDefault();
      openPdfLink(trigger);
    });
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPdfLinks);
} else {
  initPdfLinks();
}
