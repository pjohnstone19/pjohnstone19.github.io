/**
 * PdfViewerClient — renders a PDF with responsive page width.
 * Mirrors the react-pdf Document/Page client renderer using pdf.js.
 */
import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs";

pdfjs.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs";

/**
 * @param {HTMLElement} host
 * @param {{ src: string, title?: string }} options
 */
export async function mountPdfViewerClient(host, { src }) {
  host.replaceChildren();
  host.classList.add("pdf-viewer-client");

  const scroll = document.createElement("div");
  scroll.className = "pdf-viewer-client__scroll";

  const pages = document.createElement("div");
  pages.className = "pdf-viewer-client__pages";
  scroll.append(pages);

  const status = document.createElement("p");
  status.className = "pdf-viewer-client__status";
  status.textContent = "Loading resume…";

  host.append(scroll, status);

  let baseWidth = 0;
  let pdfDoc = null;
  let renderToken = 0;

  async function renderPages() {
    if (!pdfDoc || !baseWidth) return;
    const token = ++renderToken;
    const width = Math.max(280, Math.floor(baseWidth));
    pages.replaceChildren();

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
      if (token !== renderToken) return;
      const page = await pdfDoc.getPage(pageNum);
      if (token !== renderToken) return;

      const unscaled = page.getViewport({ scale: 1 });
      const scale = width / unscaled.width;
      const viewport = page.getViewport({ scale });

      const canvas = document.createElement("canvas");
      canvas.className = "pdf-viewer-client__page";
      canvas.setAttribute("aria-label", `Page ${pageNum}`);
      const context = canvas.getContext("2d", { alpha: false });
      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      const transform =
        outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

      pages.append(canvas);
      await page.render({
        canvasContext: context,
        viewport,
        transform,
      }).promise;
    }
  }

  function measureAndRender() {
    const width = Math.floor(scroll.clientWidth - 8);
    if (width <= 0) return;
    baseWidth = width;
    renderPages();
  }

  const resizeObserver = new ResizeObserver(() => {
    measureAndRender();
  });
  resizeObserver.observe(scroll);

  try {
    pdfDoc = await pdfjs.getDocument({ url: src, withCredentials: false }).promise;
    status.remove();
    measureAndRender();
  } catch (error) {
    console.error("PDF load failed:", error);
    status.textContent = "Couldn’t load the resume. Try downloading instead.";
  }

  return () => {
    renderToken++;
    resizeObserver.disconnect();
    pdfDoc = null;
  };
}
