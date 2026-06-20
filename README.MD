# Checkpoint

**Never lose your place in long-form video content again.**

Checkpoint is a browser extension that helps you track your progress in long-form video content. Whether you're watching YouTube, Udemy, Coursera, or any other platform, Checkpoint ensures you can always pick up right where you left off.

---

## Features

- **Automatic Tracking**: Saves video URL, title, channel, timestamp, duration, and last watched time while you watch.
- **Continue Watching**: Displays your most recent videos in the extension popup with one-click resume functionality.
- **Watch History**: Searchable history grouped by Today, Yesterday, Last Week, and Older.
- **Resume Anywhere**: Opens videos at the exact timestamp where you left off.
- **Playlist and Course Detection**: Tracks progress in playlists and courses, suggesting the next unwatched lecture.
- **Timestamp Notes**: Take notes tied to specific timestamps and jump back to them with a click.
- **Bookmarks**: Save important moments in videos for quick access later.
- **Workspace Snapshots**: Save all open tabs in a learning session and restore them with one click.
- **Cross-Site Support**: Works on YouTube, Udemy, Coursera, Khan Academy, edX, Vimeo, Twitch VODs, and generic HTML5 video players.

---

## Installation

### For Firefox

The extension is published on [Firefox Add-ons](https://addons.mozilla.org). You can install it directly from there.

### For Chrome

1. Clone this repository or download the source code.
2. Open Chrome and go to `chrome://extensions`.
3. Enable "Developer mode."
4. Click "Load unpacked" and select the project folder.

---

## Usage

1. Open a video on any supported platform.
2. The extension will automatically track your progress.
3. Click the Checkpoint icon in your browser toolbar to:
   - Resume your most recent video.
   - View your watch history.
   - Manage playlists and courses.
4. Use the options page to configure settings, export/import data, and view your full learning dashboard.

---

## Supported Platforms

| Platform      | Metadata                            | Resume Method         |
| ------------- | ----------------------------------- | --------------------- |
| YouTube       | Title, channel, playlist, thumbnail | `?t=` seconds         |
| Udemy         | Course + lecture title              | Hash + content script |
| Coursera      | Course + lecture title              | `?t=`                 |
| Khan Academy  | Video title                         | `?t=`                 |
| edX           | Course + video title                | `?t=`                 |
| Vimeo         | Title, channel                      | `#t=Ns`               |
| Twitch VODs   | Title, channel                      | `?t=`                 |
| Generic HTML5 | Page title, favicon                 | `?t=` + resume banner |

---

### Data Model (IndexedDB)

| Store       | Key fields                                                                 |
|-------------|---------------------------------------------------------------------------|
| `videos`    | url, title, channel, duration, lastPosition, lastWatched, thumbnailUrl    |
| `playlists` | id, title, videoIds, totalVideos, currentIndex                            |
| `notes`     | videoUrl, timestamp, text, type (note \| bookmark)                       |
| `sessions`  | videoUrl, date, watchTime                                                |
| `workspaces`| name, tabs[]                                                             |

### Build Instructions

1. Clone the repository.
2. Run the build script:
   ```bash
   node build.js
3. This will generate two builds:
 - dist/chrome/ — Chrome / Edge / Brave
 - dist/firefox/ — Firefox

### License
This project is licensed under the Mozilla Public License 2.0 (MPL 2.0). See the LICENSE file for details.
