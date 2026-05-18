/**
 * Embed-mode detection for HA Lovelace iframes.
 *
 * Returns true when 3Dash is running inside an iframe OR when the URL has
 * `?embed=1` (or just `?embed`). Cross-origin parent access throws — that's
 * an even stronger signal we're iframed, so we catch and return true.
 *
 * Power users can force standalone chrome with `?embed=0`.
 */
export function isEmbedded(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const params = new URLSearchParams(window.location.search);
    if (params.has('embed')) {
      const v = params.get('embed');
      if (v === '0' || v === 'false') return false;
      return true;
    }
    if (window.top && window !== window.top) return true;
  } catch {
    // Cross-origin access throws — definitely iframed.
    return true;
  }
  return false;
}

/**
 * Apply the `embedded` class to <body> based on `isEmbedded()`.
 * Returns a cleanup fn that removes the class.
 */
export function applyEmbedBodyClass(): () => void {
  if (typeof document === 'undefined') return () => {};
  const embedded = isEmbedded();
  if (embedded) {
    document.body.classList.add('embedded');
  } else {
    document.body.classList.remove('embedded');
  }
  return () => {
    document.body.classList.remove('embedded');
  };
}
