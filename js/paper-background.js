import {
    emptyPixel,
    ShaderMount,
    getShaderNoiseTexture,
    paperTextureFragmentShader,
  } from "https://esm.sh/@paper-design/shaders@0.0.77";
  
  const hexToRgba = (hex) => {
    const value = hex.replace("#", "").trim();
    const normalized =
      value.length === 3
        ? value
            .split("")
            .map((char) => char + char)
            .join("")
        : value;
  
    const number = Number.parseInt(normalized.slice(0, 6), 16);
    return [
      ((number >> 16) & 255) / 255,
      ((number >> 8) & 255) / 255,
      (number & 255) / 255,
      1,
    ];
  };
  
  const loadImage = (src) =>
    new Promise((resolve, reject) => {
      const image = new Image();
      image.addEventListener("load", () => resolve(image), { once: true });
      image.addEventListener("error", reject, { once: true });
      image.src = src;
    });
  
  const getDocumentHeight = () =>
    Math.max(
      document.documentElement.scrollHeight,
      document.documentElement.offsetHeight,
      document.body?.scrollHeight || 0,
      document.body?.offsetHeight || 0,
      window.innerHeight,
    );
  
  const syncPaperBackgroundHeight = (container) => {
    // Match the full page so the texture scrolls like a real sheet of paper.
    // Read height without collapsing the layer first (avoids a 0-height flash).
    const nextHeight = `${getDocumentHeight()}px`;
    if (container.style.height !== nextHeight) {
      container.style.height = nextHeight;
    }
  };
  
  const observePaperBackgroundHeight = (container) => {
    let frameId = null;
    const scheduleSync = () => {
      if (frameId !== null) return;
      frameId = requestAnimationFrame(() => {
        frameId = null;
        syncPaperBackgroundHeight(container);
      });
    };
  
    const resizeObserver = new ResizeObserver(scheduleSync);
    resizeObserver.observe(document.documentElement);
    if (document.body) resizeObserver.observe(document.body);
  
    const mutationObserver = new MutationObserver(scheduleSync);
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  
    window.addEventListener("load", scheduleSync);
    window.addEventListener("resize", scheduleSync);
    document.fonts?.ready.then(scheduleSync).catch(() => {});
  
    scheduleSync();
    setTimeout(scheduleSync, 250);
    setTimeout(scheduleSync, 1000);
    setTimeout(scheduleSync, 3000);
  };
  
  const mountPaperBackground = async () => {
    const container = document.getElementById("paper-background");
    if (!container || container.paperShaderMount) return;
  
    try {
      const image = await loadImage(emptyPixel);
      syncPaperBackgroundHeight(container);
  
      new ShaderMount(
        container,
        paperTextureFragmentShader,
        {
          u_image: image,
          u_colorBack: hexToRgba("#ffffff"),
          u_colorFront: hexToRgba("#EEEADF"),
          u_contrast: 0.75,
          u_roughness: 0.5,
          u_fiber: 0.3,
          u_fiberSize: 0.1,
          u_crumples: 0.25,
          u_crumpleSize: 0.45,
          u_folds: 0,
          u_foldCount: 0,
          u_drops: 0,
          u_fade: 0.3,
          u_seed: 861.8,
          u_scale: 0.4,
          u_fit: 1,
          u_rotation: 0.2,
          u_offsetX: 0,
          u_offsetY: 0,
          u_originX: 0.5,
          u_originY: 0.5,
          u_worldWidth: 1920,
          u_worldHeight: 1920,
          u_noiseTexture: getShaderNoiseTexture(),
        },
        {
          alpha: true,
          antialias: false,
          depth: false,
          stencil: false,
          powerPreference: "low-power",
          failIfMajorPerformanceCaveat: false,
        },
        0,
      );
  
      container.dataset.paperReady = "true";
      observePaperBackgroundHeight(container);
    } catch (error) {
      console.warn("Failed to mount paper background shader", error);
      container.dataset.paperReady = "fallback";
      syncPaperBackgroundHeight(container);
      observePaperBackgroundHeight(container);
    }
  };
  
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountPaperBackground, {
      once: true,
    });
  } else {
    mountPaperBackground();
  }
  