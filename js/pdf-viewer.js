/**
 * PdfViewer — client-only wrapper (analogous to next/dynamic { ssr: false }).
 * Lazily imports PdfViewerClient so pdf.js only loads when the modal opens.
 */

/**
 * @param {HTMLElement} host
 * @param {{ src: string, title?: string }} options
 * @returns {Promise<() => void>}
 */
export async function mountPdfViewer(host, options) {
  host.replaceChildren();
  host.classList.add("pdf-viewer");
  host.setAttribute("data-loading", "true");

  const loading = document.createElement("p");
  loading.className = "pdf-viewer__loading";
  loading.textContent = "Loading viewer…";
  host.append(loading);

  const { mountPdfViewerClient } = await import("./pdf-viewer-client.js");
  host.removeAttribute("data-loading");
  return mountPdfViewerClient(host, options);
}
