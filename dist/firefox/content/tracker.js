// Video playback tracker content script

(function () {
  let lastReportedTime = -999;
  let lastReportedTimeClock = 0;
  let reportIntervalMs = 5000;
  let pageUrl = location.href;
  let metadataRetryTimer = null;

  function onPageNavigate() {
    const newUrl = location.href;
    if (newUrl === pageUrl) return;
    pageUrl = newUrl;
    lastReportedTime = -999;
    lastReportedTimeClock = 0;

    document.querySelectorAll('video').forEach(v => {
      delete v.__checkpoint_tracked;
      delete v.__checkpoint_url_seeked;
      delete v.__checkpoint_resumed;
    });

    const banner = document.getElementById('checkpoint-resume-banner');
    if (banner) banner.remove();

    scan();
  }

  window.addEventListener('yt-navigate-finish', onPageNavigate);
  window.addEventListener('popstate', onPageNavigate);
  setInterval(() => {
    if (location.href !== pageUrl) onPageNavigate();
  }, 1000);

  function scheduleMetadataRetry(video) {
    if (metadataRetryTimer) clearTimeout(metadataRetryTimer);
    metadataRetryTimer = setTimeout(() => {
      if (document.contains(video)) sendUpdate(video);
    }, 2500);
  }

  function loadTrackingSettings() {
    chrome.storage.local.get({ trackingInterval: 5 }, (items) => {
      reportIntervalMs = Math.max(3000, (items.trackingInterval || 5) * 1000);
    });
  }

  loadTrackingSettings();
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.trackingInterval) {
      reportIntervalMs = Math.max(3000, changes.trackingInterval.newValue * 1000);
    }
  });

  function parseUrlTimestamp() {
    try {
      const url = new URL(window.location.href);

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

  function applyUrlTimestamp(video) {
    const target = parseUrlTimestamp();
    if (target == null || target <= 0 || video.__checkpoint_url_seeked) return;

    const seek = () => {
      if (isNaN(video.duration) || video.duration <= 0) return;
      if (target >= video.duration - 5) return;
      video.currentTime = target;
      video.__checkpoint_url_seeked = true;
    };

    if (video.readyState >= 1) {
      seek();
    } else {
      video.addEventListener('loadedmetadata', seek, { once: true });
    }
  }

  function getMetadata() {
    if (typeof window.getMetadataAdapter === 'function') {
      const adapter = window.getMetadataAdapter(window.location.href);
      return adapter.getMetadata();
    }
    return {
      title: document.title,
      channel: window.location.hostname,
      thumbnailUrl: getFavicon()
    };
  }

  function getFavicon() {
    const link = document.querySelector("link[rel*='icon']");
    return link ? link.href : `${window.location.origin}/favicon.ico`;
  }

  function sendUpdate(video) {
    if (!video || isNaN(video.duration) || video.duration <= 0) return;

    let metadata = {};
    let playlistUrls = [];
    if (typeof window.getMetadataAdapter === 'function') {
      const adapter = window.getMetadataAdapter(window.location.href);
      metadata = adapter.getMetadata();
      if (typeof adapter.getPlaylistUrls === 'function') {
        playlistUrls = adapter.getPlaylistUrls();
      }
    } else {
      metadata = {
        title: document.title,
        channel: window.location.hostname,
        thumbnailUrl: getFavicon()
      };
    }

    const payload = {
      url: window.location.href,
      sourceUrl: window.location.href,
      title: metadata.title,
      channel: metadata.channel,
      duration: video.duration,
      lastPosition: video.currentTime,
      thumbnailUrl: metadata.thumbnailUrl,
      playlistId: metadata.playlistId || null,
      playlistTitle: metadata.playlistTitle || null,
      playlistTotal: metadata.playlistTotal || 0,
      playlistIndex: metadata.playlistIndex || 0,
      courseId: metadata.courseId || null,
      playlistVideoUrls: playlistUrls
    };

    if (!payload.title || payload.title.length < 2) {
      scheduleMetadataRetry(video);
    }
    if (payload.playlistId && (!payload.playlistIndex || payload.playlistTitle === 'YouTube Playlist')) {
      scheduleMetadataRetry(video);
    }

    chrome.runtime.sendMessage({ type: 'TRACK_UPDATE', data: payload }, () => {
      if (chrome.runtime.lastError) {
        // ignore — background may be restarting
      }
    });

    lastReportedTime = video.currentTime;
    lastReportedTimeClock = Date.now();
  }

  function handlePlay(video) {
    sendUpdate(video);
  }

  function handlePause(video) {
    sendUpdate(video);
  }

  function handleTimeUpdate(video) {
    if (video.paused) return;

    const timeDiff = Math.abs(video.currentTime - lastReportedTime);
    const clockDiff = Date.now() - lastReportedTimeClock;

    // Send update if playback position jumped significantly (e.g. seeking)
    // or if the standard update interval has passed.
    if (timeDiff > 3 || clockDiff >= reportIntervalMs) {
      sendUpdate(video);
    }
  }

  function handleSeeking(video) {
    // Standard seek event
    sendUpdate(video);
  }

  function handleEnded(video) {
    sendUpdate(video);
  }

  function injectResumeBanner(video, lastPosition, lastWatched) {
    if (document.getElementById('checkpoint-resume-banner')) return;

    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const isStale = lastWatched && (Date.now() - lastWatched) >= THIRTY_DAYS_MS;

    const banner = document.createElement('div');
    banner.id = 'checkpoint-resume-banner';

    const formatTime = (secs) => {
      const h = Math.floor(secs / 3600);
      const m = Math.floor((secs % 3600) / 60);
      const s = Math.floor(secs % 60);
      const formattedS = s < 10 ? `0${s}` : s;
      if (h > 0) {
        const formattedM = m < 10 ? `0${m}` : m;
        return `${h}:${formattedM}:${formattedS}`;
      }
      return `${m}:${formattedS}`;
    };

    if (!document.getElementById('checkpoint-banner-styles')) {
      const style = document.createElement('style');
      style.id = 'checkpoint-banner-styles';
      style.textContent = `
        #checkpoint-resume-banner {
          position: fixed;
          bottom: 24px;
          right: 24px;
          background: rgba(10, 10, 18, 0.95);
          backdrop-filter: blur(12px);
          border: 1px solid rgba(255, 255, 255, 0.12);
          border-radius: 12px;
          padding: 16px;
          color: #f4f4f5;
          font-family: 'Inter', system-ui, -apple-system, sans-serif;
          box-shadow: 0 12px 36px rgba(0, 0, 0, 0.6);
          z-index: 2147483647;
          display: flex;
          flex-direction: column;
          gap: 12px;
          width: 290px;
          animation: checkpoint-slide-in 0.35s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes checkpoint-slide-in {
          from { transform: translateY(40px) scale(0.95); opacity: 0; }
          to { transform: translateY(0) scale(1); opacity: 1; }
        }
        #checkpoint-resume-banner .title {
          font-size: 13.5px;
          font-weight: 700;
          color: #818cf8;
          margin: 0;
        }
        #checkpoint-resume-banner .description {
          font-size: 11px;
          color: #a1a1aa;
          margin: 0;
          line-height: 1.45;
        }
        #checkpoint-resume-banner .buttons {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          margin-top: 4px;
        }
        #checkpoint-resume-banner .btn {
          border: none;
          border-radius: 6px;
          padding: 6px 14px;
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.2s, transform 0.1s;
        }
        #checkpoint-resume-banner .btn-resume {
          background: linear-gradient(135deg, #6366f1, #a855f7);
          color: white;
        }
        #checkpoint-resume-banner .btn-resume:hover {
          transform: translateY(-1px);
        }
        #checkpoint-resume-banner .btn-dismiss {
          background: rgba(255, 255, 255, 0.07);
          color: #f4f4f5;
          border: 1px solid rgba(255, 255, 255, 0.05);
        }
        #checkpoint-resume-banner .btn-dismiss:hover {
          background: rgba(255, 255, 255, 0.12);
        }
      `;
      document.head.appendChild(style);
    }

    const title = document.createElement('p');
    title.className = 'title';
    title.textContent = 'Checkpoint: Resume Video?';

    const description = document.createElement('p');
    description.className = 'description';
    description.append('You watched this video previously. Resume from ');
    const resumeTime = document.createElement('strong');
    resumeTime.textContent = formatTime(lastPosition);
    description.append(resumeTime, '?');
    if (isStale) {
      description.appendChild(document.createElement('br'));
      const staleNote = document.createElement('span');
      staleNote.style.color = '#fbbf24';
      staleNote.textContent = 'You haven\'t opened this in over 30 days.';
      description.appendChild(staleNote);
    }

    const buttons = document.createElement('div');
    buttons.className = 'buttons';
    const dismissButton = document.createElement('button');
    dismissButton.className = 'btn btn-dismiss';
    dismissButton.id = 'checkpoint-btn-dismiss';
    dismissButton.textContent = 'Dismiss';
    const resumeButton = document.createElement('button');
    resumeButton.className = 'btn btn-resume';
    resumeButton.id = 'checkpoint-btn-resume';
    resumeButton.textContent = 'Resume';
    buttons.append(dismissButton, resumeButton);
    banner.append(title, description, buttons);

    document.body.appendChild(banner);

    const dismissTimer = setTimeout(() => {
      removeBanner();
    }, 12000); // 12 seconds auto-dismiss

    function removeBanner() {
      clearTimeout(dismissTimer);
      if (banner && banner.parentNode) {
        banner.style.animation = 'checkpoint-slide-in 0.25s reverse ease-in';
        setTimeout(() => {
          if (banner.parentNode) banner.parentNode.removeChild(banner);
        }, 220);
      }
    }

    banner.querySelector('#checkpoint-btn-resume').addEventListener('click', () => {
      video.currentTime = lastPosition;
      video.play().catch(err => console.log('Autoplay blocked after seek:', err));
      video.__checkpoint_resumed = true;
      removeBanner();
    });

    banner.querySelector('#checkpoint-btn-dismiss').addEventListener('click', () => {
      removeBanner();
    });
  }

  function hookVideo(video) {
    if (video.__checkpoint_tracked) return;
    video.__checkpoint_tracked = true;
    video.__checkpoint_page_url = location.href;

    video.addEventListener('play', () => handlePlay(video));
    video.addEventListener('pause', () => handlePause(video));
    video.addEventListener('timeupdate', () => handleTimeUpdate(video));
    video.addEventListener('seeking', () => handleSeeking(video));
    video.addEventListener('ended', () => handleEnded(video));

    applyUrlTimestamp(video);

    chrome.runtime.sendMessage({ type: 'GET_VIDEO_PROGRESS', url: window.location.href }, (response) => {
      if (!response || !response.lastPosition) return;

      const pos = response.lastPosition;
      if (pos <= 10) return;

      chrome.storage.local.get({ smartRevisit: true }, (settings) => {
        const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
        const isStale = response.lastWatched && (Date.now() - response.lastWatched) >= THIRTY_DAYS_MS;
        if (isStale && settings.smartRevisit === false) return;

        let bannerInjected = false;

        const tryInjectBanner = () => {
          if (bannerInjected || video.__checkpoint_url_seeked || video.__checkpoint_resumed) return;
          if (location.href !== pageUrl) return;
          if (!isNaN(video.duration) && video.duration > 0 && pos < video.duration - 15) {
            injectResumeBanner(video, pos, response.lastWatched);
            bannerInjected = true;
          }
        };

        if (video.readyState >= 1) {
          tryInjectBanner();
        } else {
          video.addEventListener('loadedmetadata', tryInjectBanner, { once: true });
        }
        video.addEventListener('play', tryInjectBanner, { once: true });
      });
    });

    if (!video.paused && video.currentTime > 0) {
      handlePlay(video);
    } else if (!video.paused) {
      video.addEventListener('playing', () => handlePlay(video), { once: true });
    }
  }

  function scan() {
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
      if (video.__checkpoint_tracked && video.__checkpoint_page_url !== location.href) {
        delete video.__checkpoint_tracked;
      }
      hookVideo(video);
    });
  }

  // Run scanner every 2 seconds
  setInterval(scan, 2000);
  scan();

  // Listen for message commands from the extension popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'SEEK_TO') {
      const videos = document.querySelectorAll('video');
      let found = false;
      videos.forEach(video => {
        video.currentTime = message.timestamp;
        // If it was paused, play it
        if (video.paused) {
          video.play().catch(err => console.log('Auto-play blocked after seek:', err));
        }
        found = true;
      });
      sendResponse({ success: found });
    }
    if (message.type === 'GET_PLAYBACK_STATE') {
      const video = document.querySelector('video');
      if (video) {
        sendResponse({
          exists: true,
          currentTime: video.currentTime,
          duration: video.duration
        });
      } else {
        sendResponse({ exists: false });
      }
    }
    return true; // Keep connection open for async responses if needed
  });
})();
