/**
 * Shared playlist / course progress helpers.
 * Handles the common case: user starts at video N without prior extension history.
 */

export function upsertPlaylistEntry(playlist, { url, index, title }) {
  if (!playlist.videos) {
    playlist.videos = (playlist.videoIds || []).map((entryUrl, i) => ({
      url: entryUrl,
      index: i + 1,
      title: null
    }));
  }

  const normalizedIndex = index && index > 0 ? index : undefined;

  const existing = playlist.videos.find(v => v.url === url);
  if (existing) {
    if (normalizedIndex) existing.index = normalizedIndex;
    if (title) existing.title = title;
  } else {
    playlist.videos.push({
      url,
      index: normalizedIndex || playlist.videos.length + 1,
      title: title || null
    });
  }

  playlist.videos.sort((a, b) => a.index - b.index);
  playlist.videoIds = playlist.videos.map(v => v.url);
  return playlist;
}

export function mergePlaylistUrls(playlist, urls, startIndex = 0) {
  urls.forEach((urlStr, offset) => {
    const index = startIndex > 0 ? startIndex + offset : undefined;
    upsertPlaylistEntry(playlist, { url: urlStr, index });
  });
  return playlist;
}

/**
 * Completed count when user joined mid-series.
 * Prior videos (index < currentIndex) are treated as already done.
 */
export function getPlaylistProgress(playlist, allVideos) {
  const total = playlist.totalVideos || playlist.videoIds?.length || playlist.videos?.length || 0;
  const currentIndex = playlist.currentIndex || 0;

  const entries = playlist.videos?.length
    ? playlist.videos
    : (playlist.videoIds || []).map((url, i) => ({ url, index: i + 1 }));

  let completedCount = 0;

  for (const entry of entries) {
    const hist = allVideos.find(v => v.url === entry.url);
    if (hist?.completed) {
      completedCount++;
    } else if (currentIndex > 0 && entry.index < currentIndex) {
      completedCount++;
    }
  }

  // User is past video 11 → at least 10 prior videos are done even if never tracked
  if (currentIndex > 1) {
    completedCount = Math.max(completedCount, currentIndex - 1);
  }

  const progressPercent = total > 0
    ? Math.min(Math.round((completedCount / total) * 100), 100)
    : 0;

  return { completedCount, total, progressPercent, currentIndex };
}

/**
 * Find the video the user should watch next.
 */
export function getNextPlaylistVideo(playlist, allVideos) {
  const total = playlist.totalVideos || playlist.videoIds?.length || 0;
  const currentIndex = playlist.currentIndex || 0;

  const entries = playlist.videos?.length
    ? [...playlist.videos].sort((a, b) => a.index - b.index)
    : (playlist.videoIds || []).map((url, i) => ({ url, index: i + 1, title: null }));

  const findEntry = (index) => entries.find(e => e.index === index);

  // Current video in progress?
  if (currentIndex > 0) {
    const current = findEntry(currentIndex);
    if (current) {
      const hist = allVideos.find(v => v.url === current.url);
      if (!hist || !hist.completed) {
        return {
          url: current.url,
          title: hist?.title || current.title || `Video ${currentIndex}`,
          position: hist?.lastPosition || 0,
          index: currentIndex
        };
      }
    }
  }

  // Walk forward from current position (or start)
  const startFrom = currentIndex > 0 ? currentIndex + 1 : 1;
  for (let i = startFrom; i <= total; i++) {
    const entry = findEntry(i);
    if (entry) {
      const hist = allVideos.find(v => v.url === entry.url);
      if (!hist || !hist.completed) {
        return {
          url: entry.url,
          title: hist?.title || entry.title || `Video ${i}`,
          position: hist?.lastPosition || 0,
          index: i
        };
      }
    } else if (currentIndex > 0 && i > currentIndex && playlist.id && !isInternalPlaylistId(playlist.id)) {
      // YouTube: open playlist at index when we don't know the video ID yet
      return {
        url: buildYouTubePlaylistIndexUrl(playlist.id, i),
        title: `Video ${i}`,
        position: 0,
        index: i
      };
    }
  }

  // Fallback: first incomplete in stored order
  for (const entry of entries) {
    if (currentIndex > 0 && entry.index < currentIndex) continue;
    const hist = allVideos.find(v => v.url === entry.url);
    if (!hist || !hist.completed) {
      return {
        url: entry.url,
        title: hist?.title || entry.title || `Video ${entry.index}`,
        position: hist?.lastPosition || 0,
        index: entry.index
      };
    }
  }

  return null;
}

function isInternalPlaylistId(id) {
  return id.startsWith('auto_course_') || id.startsWith('udemy_') ||
    id.startsWith('coursera_') || id.startsWith('edx_');
}

function buildYouTubePlaylistIndexUrl(playlistId, index) {
  return `https://www.youtube.com/watch?v=&list=${encodeURIComponent(playlistId)}&index=${index}`;
}

export function getCurrentPlaylistVideo(playlist, allVideos) {
  const currentIndex = playlist.currentIndex;
  if (!currentIndex) return null;

  const entries = playlist.videos || (playlist.videoIds || []).map((url, i) => ({ url, index: i + 1 }));
  const entry = entries.find(e => e.index === currentIndex);
  if (!entry) return null;

  const hist = allVideos.find(v => v.url === entry.url);
  return {
    url: entry.url,
    title: hist?.title || entry.title || `Video ${currentIndex}`,
    position: hist?.lastPosition || 0,
    index: currentIndex
  };
}
