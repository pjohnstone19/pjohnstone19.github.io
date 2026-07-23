/**
 * PdfViewerClient — renders a PDF with responsive page width and a clickable
 * pdf.js annotation layer (so resume URI links work in the modal).
 */
import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.min.mjs";
import {
  AnnotationLayerBuilder,
  EventBus,
  LinkTarget,
  PDFLinkService,
} from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/web/pdf_viewer.mjs";

pdfjs.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/build/pdf.worker.min.mjs";

const PDF_VIEWER_CSS =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.8.69/web/pdf_viewer.css";

function ensurePdfViewerStyles() {
  if (document.querySelector('link[data-pdf-viewer-css]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = PDF_VIEWER_CSS;
  link.dataset.pdfViewerCss = "true";
  document.head.append(link);
}

/**
 * @param {HTMLElement} host
 * @param {{ src: string, title?: string }} options
 */
export async function mountPdfViewerClient(host, { src }) {
  ensurePdfViewerStyles();

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
  let linkService = null;

  async function renderPages() {
    if (!pdfDoc || !baseWidth || !linkService) return;
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
      const cssWidth = Math.floor(viewport.width);
      const cssHeight = Math.floor(viewport.height);

      const pageWrap = document.createElement("div");
      pageWrap.className = "pdf-viewer-client__page-wrap";
      pageWrap.style.width = `${cssWidth}px`;
      pageWrap.style.height = `${cssHeight}px`;

      const canvas = document.createElement("canvas");
      canvas.className = "pdf-viewer-client__page";
      canvas.setAttribute("aria-label", `Page ${pageNum}`);
      const context = canvas.getContext("2d", { alpha: false });
      const outputScale = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;

      const transform =
        outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

      pageWrap.append(canvas);
      pages.append(pageWrap);

      await page.render({
        canvasContext: context,
        viewport,
        transform,
      }).promise;

      if (token !== renderToken) return;

      const annotationBuilder = new AnnotationLayerBuilder({
        pdfPage: page,
        linkService,
        renderForms: false,
        enableScripting: false,
        onAppend(div) {
          pageWrap.append(div);
        },
      });
      await annotationBuilder.render(viewport);
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
    const eventBus = new EventBus();
    linkService = new PDFLinkService({
      eventBus,
      externalLinkTarget: LinkTarget.BLANK,
    });
    linkService.setDocument(pdfDoc);
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
    linkService = null;
  };
}
