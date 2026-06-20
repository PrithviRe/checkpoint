import { CheckpointDB, normalizeUrl } from '../storage/db.js';
import { buildResumeUrl } from '../utils/resume.js';
import { getPlaylistProgress, getNextPlaylistVideo, getCurrentPlaylistVideo } from '../utils/playlist.js';

const db = new CheckpointDB();
const FALLBACK_THUMB = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100"><rect width="100%" height="100%" fill="%231e1b4b"/><path d="M40 35v30l25-15z" fill="%23818cf8"/></svg>`;
const PLAY_ICON = 'M8 5v14l11-7z';
const DELETE_ICON = 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z';

// State
let activeTab = null;
let currentVideoState = null;
let notePollingInterval = null;

function createSvg(width, height, pathData) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', pathData);
  svg.appendChild(path);
  return svg;
}

function createThumb(src, className, alt) {
  const img = document.createElement('img');
  img.className = className;
  img.src = src || FALLBACK_THUMB;
  img.alt = alt;
  img.addEventListener('error', () => {
    img.src = FALLBACK_THUMB;
  }, { once: true });
  return img;
}

// Initialize Popup
document.addEventListener('DOMContentLoaded', async () => {
  await db.init();
  initNavigation();
  await checkActiveTabVideo();
  renderResume(); // Default tab
  
  // Workspace save button
  document.getElementById('btn-save-workspace').addEventListener('click', saveCurrentWorkspace);
  
  // Note input listener
  document.getElementById('note-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      saveNote('note');
    }
  });
  document.getElementById('add-note-btn').addEventListener('click', () => saveNote('note'));
  document.getElementById('add-bookmark-btn').addEventListener('click', () => saveNote('bookmark'));

  // History search listener removed
});

// Navigation logic
function initNavigation() {
  const navItems = document.querySelectorAll('.nav-item');
  navItems.forEach(item => {
    item.addEventListener('click', () => {
      // Toggle active classes on nav items
      navItems.forEach(nav => nav.classList.remove('active'));
      item.classList.add('active');

      // Toggle tab views
      const targetTab = item.getAttribute('data-tab');
      const views = document.querySelectorAll('.tab-view');
      views.forEach(view => {
        if (view.id === `view-${targetTab}`) {
          view.classList.add('active');
        } else {
          view.classList.remove('active');
        }
      });

      // Render tab-specific view
      if (targetTab === 'resume') renderResume();
      else if (targetTab === 'courses') renderCourses();
      else if (targetTab === 'workspaces') renderWorkspaces();
    });
  });
}

// Check if active tab is playing a video
async function checkActiveTabVideo() {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tabs.length === 0) return;
    activeTab = tabs[0];

    // Query content script of active tab
    chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PLAYBACK_STATE' }, async (response) => {
      if (chrome.runtime.lastError || !response || !response.exists) {
        // Fall back to background active tracking cache
        chrome.runtime.sendMessage({ type: 'GET_ACTIVE_VIDEO' }, async (bgResponse) => {
          if (bgResponse && bgResponse.active) {
            setupActiveTracker(bgResponse.active.url, bgResponse.active.title, bgResponse.active.channel, bgResponse.active.lastPosition);
          } else {
            document.getElementById('current-session-panel').classList.add('hidden');
            document.getElementById('active-status').classList.remove('active');
            document.getElementById('active-status').querySelector('.status-text').textContent = 'Idle';
          }
        });
        return;
      }

      setupActiveTracker(activeTab.url, activeTab.title, getChannelFromTitle(activeTab.title, activeTab.url), response.currentTime);
      
      // Start polling for real-time video playback time to keep note timestamp in sync
      if (notePollingInterval) clearInterval(notePollingInterval);
      notePollingInterval = setInterval(() => {
        chrome.tabs.sendMessage(activeTab.id, { type: 'GET_PLAYBACK_STATE' }, (pollResponse) => {
          if (pollResponse && pollResponse.exists) {
            updateNoteTimestamp(pollResponse.currentTime, pollResponse.duration);
          } else {
            clearInterval(notePollingInterval);
          }
        });
      }, 1000);
    });
  } catch (err) {
    console.error('Error checking active tab video:', err);
  }
}

function getChannelFromTitle(title, url) {
  try {
    const domain = new URL(url).hostname;
    if (domain.includes('youtube.com')) {
      return 'YouTube';
    }
    return domain.replace('www.', '');
  } catch (e) {
    return 'Web Video';
  }
}

function setupActiveTracker(url, title, channel, position) {
  const normUrl = normalizeUrl(url);
  currentVideoState = { url: normUrl, title, channel, position };
  
  // UI update
  const panel = document.getElementById('current-session-panel');
  panel.classList.remove('hidden');
  
  document.getElementById('current-source').textContent = channel;
  document.getElementById('current-video-title').textContent = title;
  
  const statusEl = document.getElementById('active-status');
  statusEl.classList.add('active');
  statusEl.querySelector('.status-text').textContent = 'Tracking';

  updateNoteTimestamp(position);
  renderNotesList(normUrl);
}

function updateNoteTimestamp(currentTime, duration = 0) {
  if (currentVideoState) {
    currentVideoState.position = currentTime;
  }
  const timeStr = formatTime(currentTime);
  const durationStr = duration > 0 ? ` / ${formatTime(duration)}` : '';
  document.getElementById('current-video-time').textContent = `${timeStr}${durationStr}`;
  document.getElementById('note-input').placeholder = `Type a note at ${timeStr}... (Press Enter)`;
}

// Format seconds into H:MM:SS or MM:SS
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  
  const formattedSeconds = s < 10 ? `0${s}` : s;
  if (h > 0) {
    const formattedMinutes = m < 10 ? `0${m}` : m;
    return `${h}:${formattedMinutes}:${formattedSeconds}`;
  }
  return `${m}:${formattedSeconds}`;
}

// Add Note or Bookmark
async function saveNote(type = 'note') {
  const input = document.getElementById('note-input');
  const text = input.value.trim();
  if (!text || !currentVideoState) return;

  const note = {
    videoUrl: currentVideoState.url,
    timestamp: currentVideoState.position,
    text: text,
    type: type
  };

  await db.saveNote(note);
  input.value = '';
  await renderNotesList(currentVideoState.url);
}

// Render Notes List for active video
async function renderNotesList(videoUrl) {
  const listContainer = document.getElementById('session-notes-list');
  listContainer.innerHTML = '';
  
  const notes = await db.getNotesForVideo(videoUrl);
  if (notes.length === 0) {
    listContainer.innerHTML = `<div class="empty-state" style="padding:10px; font-size:10px;">No notes taken yet.</div>`;
    return;
  }

  notes.forEach(note => {
    const item = document.createElement('div');
    item.className = 'session-note-item';
    
    // Clicking a note triggers timestamp seek
    item.addEventListener('click', (e) => {
      if (e.target.closest('.delete-note-btn')) return;
      seekTo(note.timestamp);
    });

    const content = document.createElement('div');
    content.style.display = 'flex';
    content.style.alignItems = 'center';
    content.style.minWidth = '0';
    content.style.flexGrow = '1';

    const timestampSpan = document.createElement('span');
    timestampSpan.className = 'note-timestamp';
    if (note.type === 'bookmark') {
      timestampSpan.style.color = 'var(--warning)';
      timestampSpan.textContent = `🔖 ${formatTime(note.timestamp)}`;
    } else {
      timestampSpan.textContent = formatTime(note.timestamp);
    }

    const textSpan = document.createElement('span');
    textSpan.className = 'note-text-span';
    textSpan.textContent = note.text;
    textSpan.title = note.text;

    content.appendChild(timestampSpan);
    content.appendChild(textSpan);

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'delete-note-btn';
    deleteBtn.title = 'Delete Note';
    deleteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" width="12" height="12">
        <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
      </svg>
    `;
    deleteBtn.addEventListener('click', async () => {
      await db.deleteNote(note.id);
      renderNotesList(videoUrl);
    });

    item.appendChild(content);
    item.appendChild(deleteBtn);
    listContainer.appendChild(item);
  });
}

function seekTo(timestamp) {
  if (activeTab) {
    chrome.tabs.sendMessage(activeTab.id, { type: 'SEEK_TO', timestamp: timestamp }, (response) => {
      if (chrome.runtime.lastError) {
        chrome.runtime.sendMessage({ type: 'SEEK_TO', timestamp: timestamp });
      }
    });
  }
}

// === VIEW 1: RESUME ===
async function renderResume() {
  const heroContainer = document.getElementById('hero-resume-container');
  const listContainer = document.getElementById('recent-videos-list');
  
  heroContainer.innerHTML = '';
  listContainer.innerHTML = '';

  const recents = await db.getRecentVideos(15);
  
  if (recents.length === 0) {
    listContainer.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48">
          <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z"/>
        </svg>
        <p>No video tracking history found yet.<br>Start watching a video on YouTube, Udemy, or Coursera!</p>
      </div>
    `;
    return;
  }

  // Render Hero Card (most recent video)
  const heroVideo = recents[0];
  const progressPercent = Math.min(Math.round((heroVideo.lastPosition / heroVideo.duration) * 100) || 0, 100);
  
  const heroCard = document.createElement('div');
  heroCard.className = 'hero-card';
  
  const timeAgo = formatTimeAgo(heroVideo.lastWatched);
  const thumbUrl = heroVideo.thumbnailUrl || FALLBACK_THUMB;

  const heroThumbWrapper = document.createElement('div');
  heroThumbWrapper.className = 'hero-thumb-wrapper';
  heroThumbWrapper.appendChild(createThumb(thumbUrl, 'hero-thumb', 'Thumbnail'));
  const heroOverlay = document.createElement('div');
  heroOverlay.className = 'hero-overlay';
  const heroBadge = document.createElement('span');
  heroBadge.className = 'hero-badge';
  heroBadge.textContent = 'Last Watched';
  heroOverlay.appendChild(heroBadge);
  const heroPlayIcon = document.createElement('div');
  heroPlayIcon.className = 'hero-play-icon';
  heroPlayIcon.appendChild(createSvg('24', '24', PLAY_ICON));
  heroThumbWrapper.append(heroOverlay, heroPlayIcon);

  const heroDetails = document.createElement('div');
  heroDetails.className = 'hero-details';
  const heroTitle = document.createElement('h2');
  heroTitle.className = 'hero-title';
  heroTitle.title = heroVideo.title;
  heroTitle.textContent = heroVideo.title;
  const heroMeta = document.createElement('div');
  heroMeta.className = 'hero-meta';
  const heroChannel = document.createElement('span');
  heroChannel.className = 'hero-channel';
  heroChannel.textContent = heroVideo.channel;
  const heroTimeAgo = document.createElement('span');
  heroTimeAgo.textContent = timeAgo;
  heroMeta.append(heroChannel, heroTimeAgo);
  const progressContainer = document.createElement('div');
  progressContainer.className = 'progress-container';
  const progressWrapper = document.createElement('div');
  progressWrapper.className = 'progress-bar-wrapper';
  const progressBar = document.createElement('div');
  progressBar.className = 'progress-bar';
  progressBar.style.width = `${progressPercent}%`;
  progressWrapper.appendChild(progressBar);
  const progressText = document.createElement('div');
  progressText.className = 'progress-text';
  const progressTime = document.createElement('span');
  progressTime.textContent = `${formatTime(heroVideo.lastPosition)} / ${formatTime(heroVideo.duration)}`;
  const progressPct = document.createElement('span');
  progressPct.textContent = `${progressPercent}% completed`;
  progressText.append(progressTime, progressPct);
  progressContainer.append(progressWrapper, progressText);
  const heroResumeBtn = document.createElement('button');
  heroResumeBtn.className = 'resume-btn';
  heroResumeBtn.id = 'hero-resume-btn';
  heroResumeBtn.append(createSvg('16', '16', 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 14.5v-9l6 4.5-6 4.5z'), 'Resume Watching');
  heroDetails.append(heroTitle, heroMeta, progressContainer, heroResumeBtn);
  heroCard.append(heroThumbWrapper, heroDetails);
  
  heroCard.querySelector('.hero-thumb-wrapper').addEventListener('click', () => {
    resumeVideoUrl(heroVideo.url, heroVideo.lastPosition, heroVideo);
  });
  heroCard.querySelector('#hero-resume-btn').addEventListener('click', () => {
    resumeVideoUrl(heroVideo.url, heroVideo.lastPosition, heroVideo);
  });

  heroContainer.appendChild(heroCard);

  // Render list of remaining videos
  const remaining = recents.slice(1);
  if (remaining.length > 0) {
    remaining.forEach(video => {
      const rowProgress = Math.min(Math.round((video.lastPosition / video.duration) * 100) || 0, 100);
      const rowCard = document.createElement('div');
      rowCard.className = 'video-row-card';
      
      const rowThumbWrapper = document.createElement('div');
      rowThumbWrapper.className = 'video-row-thumb-wrapper';
      rowThumbWrapper.appendChild(createThumb(video.thumbnailUrl, 'video-row-thumb', 'Thumb'));
      const rowProgressMini = document.createElement('div');
      rowProgressMini.className = 'video-row-progress-mini';
      const rowProgressBar = document.createElement('div');
      rowProgressBar.className = 'video-row-progress-mini-bar';
      rowProgressBar.style.width = `${rowProgress}%`;
      rowProgressMini.appendChild(rowProgressBar);
      rowThumbWrapper.appendChild(rowProgressMini);

      const rowDetails = document.createElement('div');
      rowDetails.className = 'video-row-details';
      const rowTitle = document.createElement('h4');
      rowTitle.className = 'video-row-title';
      rowTitle.title = video.title;
      rowTitle.textContent = video.title;
      const rowMeta = document.createElement('div');
      rowMeta.className = 'video-row-meta';
      const rowChannel = document.createElement('span');
      rowChannel.className = 'video-row-channel';
      rowChannel.textContent = video.channel;
      const rowTime = document.createElement('span');
      rowTime.textContent = `${formatTime(video.lastPosition)} / ${formatTime(video.duration)} (${rowProgress}%)`;
      rowMeta.append(rowChannel, rowTime);
      rowDetails.append(rowTitle, rowMeta);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'video-delete-row-btn';
      deleteBtn.title = 'Delete from history';
      deleteBtn.appendChild(createSvg('14', '14', DELETE_ICON));
      rowCard.append(rowThumbWrapper, rowDetails, deleteBtn);

      rowCard.addEventListener('click', (e) => {
        if (e.target.closest('.video-delete-row-btn')) return;
        resumeVideoUrl(video.url, video.lastPosition, video);
      });

      rowCard.querySelector('.video-delete-row-btn').addEventListener('click', async () => {
        await db.deleteVideo(video.url);
        renderResume();
      });

      listContainer.appendChild(rowCard);
    });
  }
}

function resumeVideoUrl(baseUrl, position, videoMeta = null) {
  const context = videoMeta ? {
    playlistId: videoMeta.playlistId || null,
    playlistIndex: videoMeta.playlistIndex || 0
  } : {};
  const url = videoMeta?.sourceUrl || baseUrl;
  chrome.tabs.create({ url: buildResumeUrl(url, position, context) });
}

function formatTimeAgo(timestamp) {
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
}

// Watch History view code removed

// === VIEW 2: COURSES & PLAYLISTS ===
async function renderCourses() {
  const container = document.getElementById('courses-list');
  container.innerHTML = '';

  const playlists = await db.getAllPlaylists();
  const allVideos = await db.getAllVideos();

  if (playlists.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48">
          <path fill="currentColor" d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z"/>
        </svg>
        <p>No playlists or courses tracked yet.<br>Watch a video inside a playlist/course to see them here.</p>
      </div>
    `;
    return;
  }

  // Render each course
  for (const playlist of playlists) {
    const { completedCount, total, progressPercent, currentIndex } = getPlaylistProgress(playlist, allVideos);
    const currentVideo = getCurrentPlaylistVideo(playlist, allVideos);
    const nextVideo = getNextPlaylistVideo(playlist, allVideos);

    const card = document.createElement('div');
    card.className = 'course-card';

    const badgeClass = playlist.type === 'youtube' ? 'youtube' : (playlist.type === 'auto' ? 'auto' : '');
    const badgeText = playlist.type === 'youtube' ? 'YouTube Playlist' : (playlist.type === 'auto' ? 'Auto Course' : 'Course');

    const header = document.createElement('div');
    header.className = 'course-card-header';
    const headerText = document.createElement('div');
    const badge = document.createElement('span');
    badge.className = `course-badge ${badgeClass}`;
    badge.textContent = badgeText;
    const title = document.createElement('h4');
    title.className = 'course-title';
    title.style.marginTop = '6px';
    title.textContent = playlist.title;
    headerText.append(badge, title);
    const deleteCourseBtn = document.createElement('button');
    deleteCourseBtn.className = 'workspace-delete-btn';
    deleteCourseBtn.style.padding = '4px';
    deleteCourseBtn.title = 'Delete Course Folder';
    deleteCourseBtn.appendChild(createSvg('14', '14', DELETE_ICON));
    header.append(headerText, deleteCourseBtn);
    card.appendChild(header);

    if (currentIndex > 0) {
      const currentTitle = currentVideo?.title || `Video ${currentIndex}`;
      const currentLabel = document.createElement('div');
      currentLabel.className = 'course-current-label';
      currentLabel.style.fontSize = '11px';
      currentLabel.style.color = 'var(--text-sub)';
      currentLabel.style.marginBottom = '8px';
      currentLabel.append('Currently: ');
      const currentStrong = document.createElement('strong');
      currentStrong.style.color = 'var(--text-main)';
      currentStrong.textContent = currentTitle;
      const currentMeta = document.createElement('span');
      currentMeta.style.color = 'var(--text-muted)';
      currentMeta.textContent = ` (${currentIndex} / ${total || '?'})`;
      currentLabel.append(currentStrong, currentMeta);
      card.appendChild(currentLabel);
    }

    const progressBlock = document.createElement('div');
    const progressWrapper = document.createElement('div');
    progressWrapper.className = 'progress-bar-wrapper';
    progressWrapper.style.height = '5px';
    progressWrapper.style.marginBottom = '6px';
    const progressBar = document.createElement('div');
    progressBar.className = 'progress-bar';
    progressBar.style.width = `${progressPercent}%`;
    progressWrapper.appendChild(progressBar);
    const progressRow = document.createElement('div');
    progressRow.className = 'course-progress-row';
    progressRow.style.marginBottom = '12px';
    const completed = document.createElement('span');
    completed.textContent = `${completedCount} / ${total || playlist.videoIds?.length || '?'} completed`;
    const percent = document.createElement('span');
    percent.textContent = `${progressPercent}%`;
    progressRow.append(completed, percent);
    progressBlock.append(progressWrapper, progressRow);
    card.appendChild(progressBlock);

    const resumePlaylistBtn = document.createElement('button');
    resumePlaylistBtn.className = 'resume-btn resume-playlist-btn';
    resumePlaylistBtn.style.width = '100%';
    resumePlaylistBtn.style.marginBottom = '10px';
    resumePlaylistBtn.style.fontSize = '11.5px';
    resumePlaylistBtn.style.padding = '8px';
    resumePlaylistBtn.style.borderRadius = '8px';
    const resumeIcon = createSvg('14', '14', PLAY_ICON);
    resumeIcon.style.marginRight = '4px';
    resumeIcon.style.display = 'inline-block';
    resumeIcon.style.verticalAlign = 'middle';
    const resumeLabel = document.createElement('span');
    resumeLabel.style.verticalAlign = 'middle';
    resumeLabel.textContent = 'Resume Course Playback';
    resumePlaylistBtn.append(resumeIcon, resumeLabel);
    card.appendChild(resumePlaylistBtn);

    if (nextVideo) {
      const nextSuggestion = document.createElement('div');
      nextSuggestion.className = 'course-next-suggestion';
      const nextLabel = document.createElement('span');
      nextLabel.className = 'next-label';
      nextLabel.textContent = 'Next Up';
      const nextRow = document.createElement('div');
      nextRow.className = 'next-video-row';
      const nextTitle = document.createElement('span');
      nextTitle.className = 'next-video-title';
      nextTitle.title = nextVideo.title;
      nextTitle.textContent = nextVideo.title;
      const nextPlayBtn = document.createElement('button');
      nextPlayBtn.className = 'next-video-play-btn';
      nextPlayBtn.title = 'Watch Now';
      nextPlayBtn.dataset.url = nextVideo.url;
      nextPlayBtn.dataset.pos = nextVideo.position;
      nextPlayBtn.appendChild(createSvg('16', '16', PLAY_ICON));
      nextRow.append(nextTitle, nextPlayBtn);
      nextSuggestion.append(nextLabel, nextRow);
      card.appendChild(nextSuggestion);
    } else if (total > 0 && completedCount >= total) {
      const completeSuggestion = document.createElement('div');
      completeSuggestion.className = 'course-next-suggestion';
      completeSuggestion.style.textAlign = 'center';
      completeSuggestion.style.color = 'var(--success)';
      completeSuggestion.style.fontSize = '11px';
      completeSuggestion.textContent = 'All lectures completed!';
      card.appendChild(completeSuggestion);
    }

    const nextBox = card.querySelector('.course-next-suggestion');
    if (nextBox && nextVideo) {
      nextBox.addEventListener('click', () => {
        resumeVideoUrl(nextVideo.url, nextVideo.position, {
          playlistId: playlist.id,
          playlistIndex: nextVideo.index,
          sourceUrl: nextVideo.url
        });
      });
    }

    const playBtn = card.querySelector('.next-video-play-btn');
    if (playBtn && nextVideo) {
      playBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        resumeVideoUrl(nextVideo.url, parseFloat(playBtn.getAttribute('data-pos')), {
          playlistId: playlist.id,
          playlistIndex: nextVideo.index,
          sourceUrl: nextVideo.url
        });
      });
    }

    card.querySelector('.resume-playlist-btn').addEventListener('click', () => {
      const target = nextVideo || currentVideo;
      if (target) {
        resumeVideoUrl(target.url, target.position, {
          playlistId: playlist.id,
          playlistIndex: target.index,
          sourceUrl: target.url
        });
      }
    });

    card.querySelector('.workspace-delete-btn').addEventListener('click', async (e) => {
      e.stopPropagation();
      const playlistVideos = allVideos.filter(v =>
        v.playlistId === playlist.id || v.courseId === playlist.id
      );
      for (const v of playlistVideos) {
        if (playlist.type === 'auto') {
          v.courseId = null;
        } else {
          v.playlistId = null;
        }
        await db.saveVideo(v);
      }
      await db.deletePlaylist(playlist.id);
      renderCourses();
    });

    container.appendChild(card);
  }
}

// === VIEW 3: WORKSPACES ===
async function saveCurrentWorkspace() {
  const nameInput = document.getElementById('workspace-name-input');
  let name = nameInput.value.trim();
  if (!name) {
    name = `Workspace ${new Date().toLocaleDateString()}`;
  }

  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    if (tabs.length === 0) return;

    const workspaceTabs = tabs
      .filter(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('about:'))
      .map(t => ({
        url: t.url,
        title: t.title,
        favIconUrl: t.favIconUrl || ''
      }));

    if (workspaceTabs.length === 0) {
      alert('No saveable website tabs found in this window.');
      return;
    }

    await db.saveWorkspace({
      name: name,
      tabs: workspaceTabs
    });

    nameInput.value = '';
    renderWorkspaces();
  } catch (err) {
    console.error('Error saving workspace:', err);
  }
}

async function renderWorkspaces() {
  const container = document.getElementById('workspaces-list');
  container.innerHTML = '';

  const list = await db.getAllWorkspaces();

  if (list.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48">
          <path fill="currentColor" d="M4 11h5V5H4v6zm0 8h5v-6H4v6zm7 0h5v-6h-5v6zm0-14v6h5V5h-5z"/>
        </svg>
        <p>No saved workspaces found.<br>Create a learning state workspace above!</p>
      </div>
    `;
    return;
  }

  list.forEach(ws => {
    const card = document.createElement('div');
    card.className = 'workspace-card';

    const info = document.createElement('div');
    info.className = 'workspace-info';
    const title = document.createElement('span');
    title.className = 'workspace-title';
    title.textContent = ws.name;
    const meta = document.createElement('span');
    meta.className = 'workspace-meta';
    meta.textContent = `${ws.tabs.length} tabs • Created ${formatTimeAgo(ws.createdAt)}`;
    info.append(title, meta);

    const actions = document.createElement('div');
    actions.className = 'workspace-actions';
    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'workspace-restore-btn';
    restoreBtn.textContent = 'Restore';
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'workspace-delete-btn';
    deleteBtn.title = 'Delete Workspace';
    deleteBtn.appendChild(createSvg('14', '14', DELETE_ICON));
    actions.append(restoreBtn, deleteBtn);
    card.append(info, actions);

    card.querySelector('.workspace-restore-btn').addEventListener('click', () => {
      const urls = ws.tabs.map(t => t.url);
      chrome.runtime.sendMessage({ type: 'RESTORE_WORKSPACE', urls });
    });

    card.querySelector('.workspace-delete-btn').addEventListener('click', async () => {
      await db.deleteWorkspace(ws.id);
      renderWorkspaces();
    });

    container.appendChild(card);
  });
}
