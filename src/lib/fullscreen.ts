type WebKitFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type WebKitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export function requestPhotoFullscreen(container: HTMLDivElement | null) {
  if (!container) return;
  const fullscreenContainer = container as WebKitFullscreenElement;
  if (container.requestFullscreen) {
    container.requestFullscreen().catch(() => {});
  } else if (fullscreenContainer.webkitRequestFullscreen) {
    fullscreenContainer.webkitRequestFullscreen();
  }
}

export async function exitPhotoFullscreen() {
  try {
    const fullscreenDocument = document as WebKitFullscreenDocument;
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else if (fullscreenDocument.webkitFullscreenElement) {
      await fullscreenDocument.webkitExitFullscreen?.();
    }
  } catch {
    // Ignore errors
  }
}
