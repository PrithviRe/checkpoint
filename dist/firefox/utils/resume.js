/**
 * Build a URL that opens a video at a specific timestamp.
 * Site-specific params where known; generic `?t=` fallback for HTML5 players.
 *
 * @param {string} baseUrl - Normalized or source video URL
 * @param {number} positionSeconds - Resume timestamp
 * @param {{ playlistId?: string, playlistIndex?: number }} [context] - Optional playlist context
 */
export function buildResumeUrl(baseUrl, positionSeconds, context = {}) {
  if (!baseUrl) return baseUrl;

  try {
    const url = new URL(baseUrl);
    const secs = positionSeconds != null ? Math.floor(positionSeconds) : 0;

    if (url.hostname.includes('youtube.com') || url.hostname.includes('youtu.be')) {
      if (context.playlistId) {
        url.searchParams.set('list', context.playlistId);
      }
      if (context.playlistIndex) {
        url.searchParams.set('index', String(context.playlistIndex));
      }
      if (secs > 0) {
        url.searchParams.set('t', String(secs));
      }
      return url.toString();
    }

    if (url.hostname.includes('vimeo.com')) {
      if (secs > 0) url.hash = `t=${secs}s`;
      return url.toString();
    }

    if (url.hostname.includes('twitch.tv')) {
      if (secs > 0) url.searchParams.set('t', String(secs));
      return url.toString();
    }

    if (url.hostname.includes('udemy.com')) {
      if (secs > 0) url.hash = `checkpoint-t=${secs}`;
      return url.toString();
    }

    if (url.hostname.includes('coursera.org') || url.hostname.includes('edx.org')) {
      if (secs > 0) url.searchParams.set('t', String(secs));
      return url.toString();
    }

    if (secs > 0) url.searchParams.set('t', String(secs));
    return url.toString();
  } catch {
    return baseUrl;
  }
}

/**
 * Parse a resume timestamp from the current page URL, if present.
 */
export function parseResumeTimestamp(urlString = window.location.href) {
  try {
    const url = new URL(urlString);

    if (url.hostname.includes('vimeo.com') && url.hash) {
      const match = url.hash.match(/t=(\d+)s?/);
      if (match) return parseInt(match[1], 10);
    }

    if (url.hash.startsWith('#checkpoint-t=')) {
      const val = parseInt(url.hash.replace('#checkpoint-t=', ''), 10);
      if (!isNaN(val)) return val;
    }

    const t = url.searchParams.get('t') || url.searchParams.get('time');
    if (t) {
      if (/^\d+$/.test(t)) return parseInt(t, 10);
      const hms = t.match(/(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?/);
      if (hms) {
        const h = parseInt(hms[1] || '0', 10);
        const m = parseInt(hms[2] || '0', 10);
        const s = parseInt(hms[3] || '0', 10);
        return h * 3600 + m * 60 + s;
      }
    }
  } catch {
    // ignore
  }
  return null;
}
