type WebKitFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type WebKitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

export function isPhotoFullscreen() {
  const fullscreenDocument = document as WebKitFullscreenDocument;
  return !!(document.fullscreenElement || fullscreenDocument.webkitFullscreenElement);
}

/**
 * True when the browser exposes an element-level Fullscreen API at all.
 * iPhone WebKit (Safari, and every iOS browser) does not, so callers can fall
 * back to the plain fixed overlay instead of waiting on a request that will
 * never resolve.
 */
export function supportsPhotoFullscreen(container: HTMLElement | null) {
  if (!container) return false;
  return !!(container.requestFullscreen || (container as WebKitFullscreenElement).webkitRequestFullscreen);
}

/**
 * Must be called while the browser still has user activation from the tap that
 * opened the viewer, and only once `container` is actually in the DOM.
 */
export async function requestPhotoFullscreen(container: HTMLElement | null) {
  if (!container) {
    console.warn('[fullscreen] no container element - request skipped');
    return false;
  }
  if (isPhotoFullscreen()) return true;

  const fullscreenContainer = container as WebKitFullscreenElement;

  try {
    if (container.requestFullscreen) {
      // navigationUI: 'hide' asks Chrome/Android to drop the browser toolbar
      // and the system navigation bar rather than keeping them overlaid.
      await container.requestFullscreen({ navigationUI: 'hide' });
    } else if (fullscreenContainer.webkitRequestFullscreen) {
      await fullscreenContainer.webkitRequestFullscreen();
    } else {
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[fullscreen] request failed', error);
    return false;
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

export function addFullscreenChangeListener(handler: () => void) {
  document.addEventListener('fullscreenchange', handler);
  document.addEventListener('webkitfullscreenchange', handler);

  return () => {
    document.removeEventListener('fullscreenchange', handler);
    document.removeEventListener('webkitfullscreenchange', handler);
  };
}
