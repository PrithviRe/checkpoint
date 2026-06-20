import { CheckpointDB, normalizeUrl } from '../storage/db.js';
import { upsertPlaylistEntry } from '../utils/playlist.js';


const db = new CheckpointDB();
db.init().then(() => {
  console.log('Checkpoint IndexedDB initialized in background worker.');
});

// Tracks active players in memory for popup status query
// Keys: tabId, Values: { url, lastPosition, title, channel }
const activePlayers = {};

// Clean up player on tab closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (activePlayers[tabId]) {
    delete activePlayers[tabId];
  }
});

// Clean up player if tab navigates away
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && activePlayers[tabId]) {
    const normChangeUrl = normalizeUrl(changeInfo.url);
    const normPlayerUrl = normalizeUrl(activePlayers[tabId].url);
    if (normChangeUrl !== normPlayerUrl) {
      delete activePlayers[tabId];
    }
  }
});

// Auto Course Detection clustering
function parseCourseTitle(title) {
  const regexes = [
    /(.*?)\s*[-:|\[\(\{]\s*(?:Lecture|Video|Part|Ep|Episode|#|Vol\.?)\s*(\d+)/i,
    /(.*?)\s*(?:Lecture|Video|Part|Ep|Episode|#|Vol\.?)\s*(\d+)/i,
    /(.*?)\s*(\d+)\s*of\s*(\d+)/i,
    /(\d+)\s*[-:|]\s*(.*)/
  ];

  for (const regex of regexes) {
    const match = title.match(regex);
    if (match) {
      let base, index;
      if (regex.toString().includes('of')) {
        base = match[1].trim();
        index = parseInt(match[2], 10);
      } else if (regex.source.startsWith('(\\d+)')) {
        index = parseInt(match[1], 10);
        base = match[2].trim();
      } else {
        base = match[1].trim();
        index = parseInt(match[2], 10);
      }
      base = base.replace(/^[-\s:|]+|[--\s:|]+$/g, '');
      if (base.length > 4 && !isNaN(index)) {
        return { base, index };
      }
    }
  }
  return null;
}

function getHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash).toString(16);
}

async function handleAutoCourseDetection(video) {
  if (video.playlistId || video.courseId) return video.courseId || null;

  const parsed = parseCourseTitle(video.title);
  if (!parsed) return null;

  const courseId = `auto_course_${getHash(parsed.base.toLowerCase())}`;
  
  const allVideos = await db.getAllVideos();
  const matchingVideos = allVideos.filter(v => {
    if (v.url === video.url) return false;
    const p = parseCourseTitle(v.title);
    return p && p.base.toLowerCase() === parsed.base.toLowerCase();
  });

  const courseVideos = [...matchingVideos, video];

  if (courseVideos.length >= 2) {
    courseVideos.sort((a, b) => {
      const pa = parseCourseTitle(a.title);
      const pb = parseCourseTitle(b.title);
      return (pa ? pa.index : 0) - (pb ? pb.index : 0);
    });

    for (const v of matchingVideos) {
      if (v.courseId !== courseId) {
        v.courseId = courseId;
        await db.saveVideo(v);
      }
    }

    await db.savePlaylist({
      id: courseId,
      title: parsed.base,
      type: 'auto',
      videoIds: courseVideos.map(v => v.url),
      totalVideos: courseVideos.length
    });

    return courseId;
  }

  return null;
}

// Listen for messages from content scripts and popups
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TRACK_UPDATE') {
    const tabId = sender.tab ? sender.tab.id : null;
    const data = message.data;
    const normUrl = normalizeUrl(data.url);

    if (tabId) {
      activePlayers[tabId] = {
        url: normUrl,
        lastPosition: data.lastPosition,
        title: data.title,
        channel: data.channel
      };
    }

    const videoRecord = {
      url: normUrl,
      title: data.title,
      channel: data.channel,
      duration: data.duration,
      lastPosition: data.lastPosition,
      thumbnailUrl: data.thumbnailUrl,
      playlistId: data.playlistId || null,
      courseId: data.courseId || null,
      completed: data.lastPosition >= data.duration - 15 // Consider completed if within 15 seconds of end
    };

    (async () => {
      try {
        const autoCourseId = await handleAutoCourseDetection(videoRecord);
        if (autoCourseId) {
          videoRecord.courseId = autoCourseId;
        }

        await db.saveVideo(videoRecord);

        const activePlaylistId = data.playlistId || videoRecord.courseId;
        let activePlaylistTitle = data.playlistTitle;
        if (!activePlaylistTitle && videoRecord.courseId) {
          const parsed = parseCourseTitle(videoRecord.title);
          if (parsed) {
            activePlaylistTitle = parsed.base;
          }
        }

        if (activePlaylistId && activePlaylistTitle) {
          let playlist = await db.getPlaylist(activePlaylistId) || {
            id: activePlaylistId,
            title: activePlaylistTitle,
            type: videoRecord.courseId ? 'auto' : (data.courseId ? 'course' : 'youtube'),
            videoIds: [],
            videos: [],
            totalVideos: data.playlistTotal || 0,
            currentIndex: 0
          };

          // Upsert current video
          playlist = upsertPlaylistEntry(playlist, {
            url: normUrl,
            index: data.playlistIndex,
            title: data.title
          });

          // Upsert other videos in playlist/course
          if (data.playlistVideoUrls && Array.isArray(data.playlistVideoUrls)) {
            data.playlistVideoUrls.forEach((item, offset) => {
              if (item && typeof item === 'object') {
                const itemUrl = normalizeUrl(item.url);
                playlist = upsertPlaylistEntry(playlist, {
                  url: itemUrl,
                  index: item.index,
                  title: item.title
                });
              } else if (typeof item === 'string') {
                const itemUrl = normalizeUrl(item);
                playlist = upsertPlaylistEntry(playlist, {
                  url: itemUrl,
                  index: data.playlistIndex ? undefined : offset + 1
                });
              }
            });
          }

          // Set currentIndex based on current video's index
          const currentEntry = playlist.videos ? playlist.videos.find(v => v.url === normUrl) : null;
          if (currentEntry && currentEntry.index > 0) {
            playlist.currentIndex = Math.max(playlist.currentIndex || 0, currentEntry.index);
          } else {
            const currentVideoIndex = playlist.videoIds.indexOf(normUrl) + 1;
            if (currentVideoIndex > 0) {
              playlist.currentIndex = Math.max(playlist.currentIndex || 0, currentVideoIndex);
            }
          }

          playlist.totalVideos = Math.max(playlist.totalVideos, playlist.videoIds.length, data.playlistTotal || 0);
          await db.savePlaylist(playlist);
        }

        sendResponse({ success: true, courseId: videoRecord.courseId });
      } catch (e) {
        console.error('Error in background tracker handler:', e);
        sendResponse({ success: false, error: e.message });
      }
    })();

    return true;
  }

  if (message.type === 'GET_ACTIVE_VIDEO') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length === 0) {
        sendResponse({ active: null });
        return;
      }
      const activeTab = tabs[0];
      const player = activePlayers[activeTab.id];
      if (player) {
        sendResponse({ active: player });
      } else {
        sendResponse({ active: null });
      }
    });
    return true;
  }

  if (message.type === 'SEEK_TO') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'SEEK_TO', timestamp: message.timestamp });
      }
    });
    sendResponse({ success: true });
    return false;
  }

  if (message.type === 'RESTORE_WORKSPACE') {
    chrome.windows.create({ url: message.urls }, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'GET_VIDEO_PROGRESS') {
    const normUrl = normalizeUrl(message.url);
    db.getVideo(normUrl).then(video => {
      sendResponse({
        lastPosition: video ? video.lastPosition : null,
        lastWatched: video ? video.lastWatched : null,
        duration: video ? video.duration : null
      });
    }).catch(err => {
      console.error('Error fetching video progress:', err);
      sendResponse({ lastPosition: null });
    });
    return true;
  }
});
