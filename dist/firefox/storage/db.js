const DB_NAME = 'CheckpointDB';
const DB_VERSION = 1;

export function normalizeUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (url.hostname.includes('youtube.com') || url.hostname.includes('youtu.be')) {
      let videoId = '';
      if (url.hostname.includes('youtu.be')) {
        videoId = url.pathname.slice(1);
      } else {
        videoId = url.searchParams.get('v');
      }
      if (videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
      }
    }
    // General cleanup
    url.hash = '';
    url.searchParams.delete('t');
    url.searchParams.delete('time');
    return url.toString();
  } catch (e) {
    return urlString;
  }
}

export class CheckpointDB {
  constructor() {
    this.db = null;
  }

  async init() {
    if (this.db) return this.db;
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = (e) => {
        console.error('Database failed to open:', e);
        reject(e.target.error);
      };

      request.onsuccess = (e) => {
        this.db = e.target.result;
        resolve(this.db);
      };

      request.onupgradeneeded = (e) => {
        const db = e.target.result;

        // Videos Store
        if (!db.objectStoreNames.contains('videos')) {
          const videoStore = db.createObjectStore('videos', { keyPath: 'url' });
          videoStore.createIndex('lastWatched', 'lastWatched', { unique: false });
          videoStore.createIndex('playlistId', 'playlistId', { unique: false });
          videoStore.createIndex('courseId', 'courseId', { unique: false });
        }

        // Playlists Store
        if (!db.objectStoreNames.contains('playlists')) {
          db.createObjectStore('playlists', { keyPath: 'id' });
        }

        // Notes/Bookmarks Store
        if (!db.objectStoreNames.contains('notes')) {
          const noteStore = db.createObjectStore('notes', { keyPath: 'id', autoIncrement: true });
          noteStore.createIndex('videoUrl', 'videoUrl', { unique: false });
        }

        // Sessions Store
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionStore = db.createObjectStore('sessions', { keyPath: 'id', autoIncrement: true });
          sessionStore.createIndex('date', 'date', { unique: false });
          sessionStore.createIndex('videoUrl', 'videoUrl', { unique: false });
        }

        // Workspaces Store
        if (!db.objectStoreNames.contains('workspaces')) {
          db.createObjectStore('workspaces', { keyPath: 'id', autoIncrement: true });
        }
      };
    });
  }

  // Generic helper for transaction
  async transaction(storeNames, mode = 'readonly') {
    const db = await this.init();
    return db.transaction(storeNames, mode);
  }

  // === VIDEOS ===
  async saveVideo(video) {
    const tx = await this.transaction('videos', 'readwrite');
    const store = tx.objectStore('videos');
    return new Promise((resolve, reject) => {
      // Fetch existing video first to merge settings like tags, favorite, custom titles
      const getReq = store.get(video.url);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        const mergedVideo = {
          tags: [],
          favorite: false,
          completed: false,
          ...existing,
          ...video,
          lastWatched: Date.now()
        };
        // Preserve playlist association if this update lacks it (e.g. transient scrape miss)
        if (existing && !video.playlistId && existing.playlistId) {
          mergedVideo.playlistId = existing.playlistId;
          mergedVideo.playlistIndex = existing.playlistIndex || mergedVideo.playlistIndex;
        }
        if (existing && !video.sourceUrl && existing.sourceUrl) {
          mergedVideo.sourceUrl = existing.sourceUrl;
        }
        const putReq = store.put(mergedVideo);
        putReq.onsuccess = () => resolve(mergedVideo);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async getVideo(url) {
    const tx = await this.transaction('videos', 'readonly');
    const store = tx.objectStore('videos');
    return new Promise((resolve, reject) => {
      const request = store.get(url);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllVideos() {
    const tx = await this.transaction('videos', 'readonly');
    const store = tx.objectStore('videos');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getRecentVideos(limit = 20) {
    const tx = await this.transaction('videos', 'readonly');
    const store = tx.objectStore('videos');
    const index = store.index('lastWatched');
    return new Promise((resolve, reject) => {
      const results = [];
      const request = index.openCursor(null, 'prev'); // descending order
      request.onsuccess = (e) => {
        const cursor = e.target.result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteVideo(url) {
    const tx = await this.transaction('videos', 'readwrite');
    const store = tx.objectStore('videos');
    return new Promise((resolve, reject) => {
      const request = store.delete(url);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // === PLAYLISTS ===
  async savePlaylist(playlist) {
    const tx = await this.transaction('playlists', 'readwrite');
    const store = tx.objectStore('playlists');
    return new Promise((resolve, reject) => {
      const getReq = store.get(playlist.id);
      getReq.onsuccess = () => {
        const existing = getReq.result;
        const mergedPlaylist = {
          videoIds: [],
          videos: [],
          ...existing,
          ...playlist,
          lastUpdated: Date.now()
        };
        // Keep the highest known total and current index
        if (existing) {
          mergedPlaylist.totalVideos = Math.max(
            existing.totalVideos || 0,
            playlist.totalVideos || 0
          );
          mergedPlaylist.currentIndex = Math.max(
            existing.currentIndex || 0,
            playlist.currentIndex || 0
          );
        }
        const putReq = store.put(mergedPlaylist);
        putReq.onsuccess = () => resolve(mergedPlaylist);
        putReq.onerror = () => reject(putReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
    });
  }

  async getPlaylist(id) {
    const tx = await this.transaction('playlists', 'readonly');
    const store = tx.objectStore('playlists');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllPlaylists() {
    const tx = await this.transaction('playlists', 'readonly');
    const store = tx.objectStore('playlists');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async deletePlaylist(id) {
    const tx = await this.transaction('playlists', 'readwrite');
    const store = tx.objectStore('playlists');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  // === NOTES / BOOKMARKS ===
  async saveNote(note) {
    const tx = await this.transaction('notes', 'readwrite');
    const store = tx.objectStore('notes');
    return new Promise((resolve, reject) => {
      const item = {
        createdAt: Date.now(),
        type: 'note', // 'note' or 'bookmark'
        ...note
      };
      const request = store.put(item);
      request.onsuccess = (e) => {
        item.id = e.target.result;
        resolve(item);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteNote(id) {
    const tx = await this.transaction('notes', 'readwrite');
    const store = tx.objectStore('notes');
    return new Promise((resolve, reject) => {
      const request = store.delete(Number(id));
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getNotesForVideo(videoUrl) {
    const tx = await this.transaction('notes', 'readonly');
    const store = tx.objectStore('notes');
    const index = store.index('videoUrl');
    return new Promise((resolve, reject) => {
      const request = index.getAll(videoUrl);
      request.onsuccess = () => {
        // Sort by timestamp ascending
        const notes = request.result.sort((a, b) => a.timestamp - b.timestamp);
        resolve(notes);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getAllNotes() {
    const tx = await this.transaction('notes', 'readonly');
    const store = tx.objectStore('notes');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // === SESSIONS (Analytics) ===
  async saveSession(session) {
    const tx = await this.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    return new Promise((resolve, reject) => {
      const item = {
        lastUpdated: Date.now(),
        ...session
      };
      const request = store.put(item);
      request.onsuccess = (e) => {
        item.id = e.target.result;
        resolve(item);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async addWatchTime(videoUrl, date, seconds) {
    const tx = await this.transaction('sessions', 'readwrite');
    const store = tx.objectStore('sessions');
    const index = store.index('date');
    return new Promise((resolve, reject) => {
      const request = index.getAll(date);
      request.onsuccess = () => {
        const matches = request.result.filter(s => s.videoUrl === videoUrl);
        if (matches.length > 0) {
          const session = matches[0];
          session.watchTime = (session.watchTime || 0) + seconds;
          session.lastUpdated = Date.now();
          const putReq = store.put(session);
          putReq.onsuccess = () => resolve(session);
          putReq.onerror = () => reject(putReq.error);
        } else {
          const newSession = {
            videoUrl,
            date,
            watchTime: seconds,
            lastUpdated: Date.now()
          };
          const addReq = store.add(newSession);
          addReq.onsuccess = (e) => {
            newSession.id = e.target.result;
            resolve(newSession);
          };
          addReq.onerror = () => reject(addReq.error);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }

  async getSessionsForDateRange(startDate, endDate) {
    const tx = await this.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    const index = store.index('date');
    const range = IDBKeyRange.bound(startDate, endDate);
    return new Promise((resolve, reject) => {
      const request = index.getAll(range);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async getAllSessions() {
    const tx = await this.transaction('sessions', 'readonly');
    const store = tx.objectStore('sessions');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // === WORKSPACES ===
  async saveWorkspace(workspace) {
    const tx = await this.transaction('workspaces', 'readwrite');
    const store = tx.objectStore('workspaces');
    return new Promise((resolve, reject) => {
      const item = {
        createdAt: Date.now(),
        ...workspace
      };
      const request = store.put(item);
      request.onsuccess = (e) => {
        item.id = e.target.result;
        resolve(item);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async deleteWorkspace(id) {
    const tx = await this.transaction('workspaces', 'readwrite');
    const store = tx.objectStore('workspaces');
    return new Promise((resolve, reject) => {
      const request = store.delete(Number(id));
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getAllWorkspaces() {
    const tx = await this.transaction('workspaces', 'readonly');
    const store = tx.objectStore('workspaces');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Clear all data
  async clearAllData() {
    const stores = ['videos', 'playlists', 'notes', 'sessions', 'workspaces'];
    const db = await this.init();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(stores, 'readwrite');
      let completed = 0;
      stores.forEach(name => {
        const store = tx.objectStore(name);
        const req = store.clear();
        req.onsuccess = () => {
          completed++;
          if (completed === stores.length) resolve();
        };
        req.onerror = () => reject(req.error);
      });
    });
  }
}
