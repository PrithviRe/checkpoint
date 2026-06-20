import { CheckpointDB, normalizeUrl } from '../storage/db.js';
import { buildResumeUrl } from '../utils/resume.js';

const db = new CheckpointDB();

// State
let allVideos = [];
let allPlaylists = [];
let allNotes = [];

document.addEventListener('DOMContentLoaded', async () => {
  await db.init();
  initNavigation();
  initPreferences();
  initBackupUtilities();
  
  // Initial render of memory tree
  await refreshKnowledgeTree();
  
  // Search bar listener
  document.getElementById('knowledge-search').addEventListener('input', handleSearch);
});

// Sidebar panel navigation
function initNavigation() {
  const navButtons = document.querySelectorAll('.nav-btn');
  navButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      navButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const targetPanel = btn.getAttribute('data-panel');
      const panels = document.querySelectorAll('.panel');
      panels.forEach(p => {
        if (p.id === `panel-${targetPanel}`) {
          p.classList.add('active');
        } else {
          p.classList.remove('active');
        }
      });

      if (targetPanel === 'knowledge') {
        await refreshKnowledgeTree();
      }
    });
  });
}

// User Preferences Management
function initPreferences() {
  const intervalSlider = document.getElementById('setting-interval');
  const intervalVal = document.getElementById('interval-val');
  const autocourseCheckbox = document.getElementById('setting-autocourse');
  const revisitCheckbox = document.getElementById('setting-revisit');

  // Load settings
  chrome.storage.local.get({
    trackingInterval: 5,
    autoCourseDetection: true,
    smartRevisit: true
  }, (items) => {
    intervalSlider.value = items.trackingInterval;
    intervalVal.textContent = `${items.trackingInterval}s`;
    autocourseCheckbox.checked = items.autoCourseDetection;
    revisitCheckbox.checked = items.smartRevisit;
  });

  // Listeners
  intervalSlider.addEventListener('input', (e) => {
    const val = e.target.value;
    intervalVal.textContent = `${val}s`;
    chrome.storage.local.set({ trackingInterval: parseInt(val, 10) });
  });

  autocourseCheckbox.addEventListener('change', (e) => {
    chrome.storage.local.set({ autoCourseDetection: e.target.checked });
  });

  revisitCheckbox.addEventListener('change', (e) => {
    chrome.storage.local.set({ smartRevisit: e.target.checked });
  });
}

// Hierarchical Knowledge Tree
async function refreshKnowledgeTree() {
  allVideos = await db.getAllVideos();
  allPlaylists = await db.getAllPlaylists();
  allNotes = await db.getAllNotes();

  renderTree(allPlaylists, allVideos, allNotes);
}

function createSvg(className, width, height, pathData, style = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (className) svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  if (style) svg.setAttribute('style', style);
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('fill', 'currentColor');
  path.setAttribute('d', pathData);
  svg.appendChild(path);
  return svg;
}

function createCourseShell(title, metaText, iconPath, iconStyle = '') {
  const courseNode = document.createElement('div');
  courseNode.className = 'tree-node-course';

  const summary = document.createElement('div');
  summary.className = 'course-summary';
  const info = document.createElement('div');
  info.className = 'course-info-col';
  info.appendChild(createSvg('course-chevron', '16', '16', 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z'));
  info.appendChild(createSvg('course-node-icon', '20', '20', iconPath, iconStyle));

  const titleSpan = document.createElement('span');
  titleSpan.className = 'course-node-title';
  titleSpan.title = title;
  titleSpan.textContent = title;
  const metaSpan = document.createElement('span');
  metaSpan.className = 'course-node-meta';
  metaSpan.textContent = metaText;

  info.append(titleSpan, metaSpan);
  summary.appendChild(info);
  const children = document.createElement('div');
  children.className = 'course-children';
  courseNode.append(summary, children);
  return courseNode;
}

function renderTree(playlists, videos, notes, searchQuery = '') {
  const container = document.getElementById('knowledge-tree');
  container.innerHTML = '';

  if (videos.length === 0 && playlists.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48">
          <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.53c-.26-.81-1-1.4-1.9-1.4h-1v-3c0-.55-.45-1-1-1h-6v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.4z"/>
        </svg>
        <p>Your Knowledge Graph is empty. Start watching videos and taking notes to build your library!</p>
      </div>
    `;
    return;
  }

  // 1. Group videos by playlistId / courseId
  const courseGroups = {};
  playlists.forEach(p => {
    courseGroups[p.id] = {
      playlist: p,
      videos: []
    };
  });

  const uncategorizedVideos = [];

  videos.forEach(v => {
    const parentId = v.courseId || v.playlistId;
    if (parentId && courseGroups[parentId]) {
      courseGroups[parentId].videos.push(v);
    } else {
      uncategorizedVideos.push(v);
    }
  });

  // Group notes by video URL for quick lookup
  const notesMap = {};
  notes.forEach(n => {
    if (!notesMap[n.videoUrl]) notesMap[n.videoUrl] = [];
    notesMap[n.videoUrl].push(n);
  });

  // Sort notes in each video by timestamp
  Object.keys(notesMap).forEach(url => {
    notesMap[url].sort((a, b) => a.timestamp - b.timestamp);
  });

  // Helper filter matching function
  const query = searchQuery.toLowerCase().trim();
  function matchesQuery(itemText) {
    return !query || itemText.toLowerCase().includes(query);
  }

  // Helper check if video or its notes match search
  function filterVideo(video) {
    if (matchesQuery(video.title) || matchesQuery(video.channel)) return true;
    const videoNotes = notesMap[video.url] || [];
    return videoNotes.some(n => matchesQuery(n.text));
  }

  // Helper check if course matches search (itself or any of its videos)
  function filterCourse(group) {
    if (matchesQuery(group.playlist.title)) return true;
    return group.videos.some(filterVideo);
  }

  // 2. Render Courses
  Object.keys(courseGroups).forEach(id => {
    const group = courseGroups[id];
    if (query && !filterCourse(group)) return; // skip if doesn't match query

    // Sort videos in course if possible (e.g. for course indexes or lastWatched)
    group.videos.sort((a, b) => a.title.localeCompare(b.title));

    // Count completions
    const completedCount = group.videos.filter(v => v.completed).length;
    const totalCount = group.playlist.totalVideos || group.videos.length;
    let progressStr = '';
    if (totalCount > 0) {
      const pct = Math.min(Math.round((completedCount / totalCount) * 100), 100);
      progressStr = ` • ${completedCount}/${totalCount} completed (${pct}%)`;
    }

    // Note count
    let noteCount = 0;
    group.videos.forEach(v => {
      noteCount += (notesMap[v.url] || []).length;
    });
    const noteStr = noteCount > 0 ? ` • ${noteCount} notes` : '';

    const badgeText = group.playlist.type === 'youtube' ? 'YouTube Playlist' : (group.playlist.type === 'auto' ? 'Auto Course' : 'Course');

    const courseNode = createCourseShell(
      group.playlist.title,
      `(${badgeText}${progressStr}${noteStr})`,
      'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v-2H7v-2h7V9H7V7h7V5h5v12h-5z'
    );

    // Children area
    const childrenContainer = courseNode.querySelector('.course-children');
    group.videos.forEach(v => {
      if (query && !filterVideo(v)) return;
      const videoNode = createVideoNode(v, notesMap[v.url] || [], query);
      childrenContainer.appendChild(videoNode);
    });

    // Toggle expand
    const summary = courseNode.querySelector('.course-summary');
    summary.addEventListener('click', () => {
      courseNode.classList.toggle('expanded');
    });

    if (query) {
      courseNode.classList.add('expanded');
    }

    container.appendChild(courseNode);
  });

  // 3. Render Uncategorized Videos
  const filteredUncat = uncategorizedVideos.filter(v => !query || filterVideo(v));
  if (filteredUncat.length > 0) {
    let noteCount = 0;
    filteredUncat.forEach(v => {
      noteCount += (notesMap[v.url] || []).length;
    });
    const noteStr = noteCount > 0 ? ` • ${noteCount} notes` : '';

    const uncatNode = createCourseShell(
      'Uncategorized Videos',
      `(${filteredUncat.length} videos${noteStr})`,
      'M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6zm16-4H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H8V4h12v12z',
      'color: var(--text-muted);'
    );

    const childrenContainer = uncatNode.querySelector('.course-children');
    filteredUncat.forEach(v => {
      const videoNode = createVideoNode(v, notesMap[v.url] || [], query);
      childrenContainer.appendChild(videoNode);
    });

    uncatNode.querySelector('.course-summary').addEventListener('click', () => {
      uncatNode.classList.toggle('expanded');
    });

    if (query) {
      uncatNode.classList.add('expanded');
    }

    container.appendChild(uncatNode);
  }
}

function createVideoNode(video, videoNotes, query) {
  const node = document.createElement('div');
  node.className = 'tree-node-video';

  const progress = Math.min(Math.round((video.lastPosition / video.duration) * 100) || 0, 100);
  const timeStr = `${formatTime(video.lastPosition)} / ${formatTime(video.duration)}`;

  const summary = document.createElement('div');
  summary.className = 'video-summary';
  const title = document.createElement('span');
  title.className = 'video-node-title';
  title.title = video.title;
  title.textContent = video.title;
  const progressContainer = document.createElement('div');
  progressContainer.className = 'video-node-progress';
  const progressText = document.createElement('span');
  progressText.textContent = `${timeStr} (${progress}%)`;
  const progressWrapper = document.createElement('div');
  progressWrapper.className = 'progress-bar-wrapper';
  progressWrapper.style.width = '80px';
  progressWrapper.style.height = '4px';
  const progressBar = document.createElement('div');
  progressBar.className = 'progress-bar';
  progressBar.style.width = `${progress}%`;
  progressWrapper.appendChild(progressBar);
  progressContainer.append(progressText, progressWrapper, createSvg('video-node-chevron', '14', '14', 'M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z'));
  summary.append(title, progressContainer);
  const children = document.createElement('div');
  children.className = 'video-children';
  node.append(summary, children);

  const childrenContainer = node.querySelector('.video-children');
  
  if (videoNotes.length === 0) {
    childrenContainer.innerHTML = `<div class="empty-state" style="padding:6px 0; font-size:11px;">No notes taken for this video.</div>`;
  } else {
    videoNotes.forEach(note => {
      // Filter note leaves
      if (query && !note.text.toLowerCase().includes(query)) return;

      const noteNode = document.createElement('div');
      noteNode.className = 'tree-node-note';

      const noteContent = document.createElement('div');
      noteContent.style.display = 'flex';
      noteContent.style.alignItems = 'center';
      noteContent.style.minWidth = '0';
      noteContent.style.flexGrow = '1';
      const noteTimestamp = document.createElement('span');
      noteTimestamp.className = 'note-node-timestamp';
      noteTimestamp.textContent = formatTime(note.timestamp);
      const noteText = document.createElement('span');
      noteText.className = 'note-node-text';
      noteText.title = note.text;
      noteText.textContent = note.text;
      noteContent.append(noteTimestamp, noteText);
      const deleteButton = document.createElement('button');
      deleteButton.className = 'note-node-delete';
      deleteButton.title = 'Delete Note';
      deleteButton.appendChild(createSvg('', '12', '12', 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z'));
      noteNode.append(noteContent, deleteButton);

      // Jump to note timestamp
      noteNode.addEventListener('click', (e) => {
        if (e.target.closest('.note-node-delete')) return;
        resumeVideoUrl(video.url, note.timestamp);
      });

      // Delete note
      noteNode.querySelector('.note-node-delete').addEventListener('click', async () => {
        await db.deleteNote(note.id);
        // Refresh this video parent nodes
        await refreshKnowledgeTree();
      });

      childrenContainer.appendChild(noteNode);
    });
  }

  node.querySelector('.video-summary').addEventListener('click', (e) => {
    if (e.target.closest('.progress-bar-wrapper')) return;
    node.classList.toggle('expanded');
  });

  if (query) {
    node.classList.add('expanded');
  }

  return node;
}

function handleSearch(e) {
  const query = e.target.value;
  renderTree(allPlaylists, allVideos, allNotes, query);
}

// Resume Video URL Helper
function resumeVideoUrl(baseUrl, position, videoMeta = null) {
  const context = videoMeta ? {
    playlistId: videoMeta.playlistId,
    playlistIndex: videoMeta.playlistIndex
  } : {};
  chrome.tabs.create({ url: buildResumeUrl(videoMeta?.sourceUrl || baseUrl, position, context) });
}

// Time formating
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

// === BACKUP & RESET SERVICES ===
function initBackupUtilities() {
  const btnExport = document.getElementById('btn-export-db');
  const btnImportTrigger = document.getElementById('btn-import-trigger');
  const fileImport = document.getElementById('file-import-db');
  const btnClear = document.getElementById('btn-clear-db');

  // Export
  btnExport.addEventListener('click', async () => {
    try {
      const data = {
        version: 1,
        generator: 'Checkpoint Extension',
        timestamp: Date.now(),
        videos: await db.getAllVideos(),
        playlists: await db.getAllPlaylists(),
        notes: await db.getAllNotes(),
        sessions: await db.getAllSessions(),
        workspaces: await db.getAllWorkspaces()
      };

      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `checkpoint_backup_${new Date().toLocaleDateString('sv')}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      alert(`Export failed: ${e.message}`);
    }
  });

  // Import Trigger
  btnImportTrigger.addEventListener('click', () => {
    fileImport.click();
  });

  // Import Handler
  fileImport.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const data = JSON.parse(event.target.result);
        
        // Validation check
        if (!data.videos || !data.playlists || !data.notes) {
          alert('Invalid backup file structure. Missing critical stores.');
          return;
        }

        const confirmRestore = confirm('Importing this file will overwrite all your current Checkpoint database records. Do you want to proceed?');
        if (!confirmRestore) return;

        // Reset database
        await db.clearAllData();

        // Write videos
        for (const v of data.videos) {
          await db.saveVideo(v);
        }
        // Write playlists
        for (const p of data.playlists) {
          await db.savePlaylist(p);
        }
        // Write notes
        for (const n of data.notes) {
          await db.saveNote(n);
        }
        // Write sessions
        if (data.sessions) {
          for (const s of data.sessions) {
            await db.saveSession(s);
          }
        }
        // Write workspaces
        if (data.workspaces) {
          for (const ws of data.workspaces) {
            await db.saveWorkspace(ws);
          }
        }

        alert('Backup successfully imported! Refreshing learning dashboard...');
        fileImport.value = '';
        await refreshKnowledgeTree();
      } catch (err) {
        alert(`Failed to parse backup file: ${err.message}`);
      }
    };
    reader.readAsText(file);
  });

  // Clear Database
  btnClear.addEventListener('click', async () => {
    const check1 = confirm('🚨 WARNING: You are about to delete all Checkpoint history, bookmarks, notes, courses, and workspaces! This cannot be undone. Are you sure?');
    if (!check1) return;
    
    const check2 = confirm('Please confirm one more time: Do you really want to delete EVERYTHING?');
    if (!check2) return;

    try {
      await db.clearAllData();
      await chrome.storage.local.clear();
      
      // Reset inputs
      initPreferences();
      alert('Checkpoint database successfully purged.');
      await refreshKnowledgeTree();
    } catch (e) {
      alert(`Failed to clear database: ${e.message}`);
    }
  });
}
