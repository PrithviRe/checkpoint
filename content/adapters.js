// Site adapters to extract metadata for specific video platforms

class BaseAdapter {
  match(url) {
    return false;
  }

  getMetadata() {
    return {
      title: document.title,
      channel: window.location.hostname,
      thumbnailUrl: this.getFavicon(),
      playlistId: null,
      playlistTitle: null,
      playlistTotal: 0,
      courseId: null
    };
  }

  getFavicon() {
    const link = document.querySelector("link[rel*='icon']");
    return link ? link.href : `${window.location.origin}/favicon.ico`;
  }

  getPlaylistUrls() {
    return [];
  }
}

class YouTubeAdapter extends BaseAdapter {
  match(url) {
    return url.hostname.includes('youtube.com') && url.pathname.includes('/watch');
  }

  getMetadata() {
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('v');
    const playlistId = urlParams.get('list');
    const urlIndex = parseInt(urlParams.get('index') || '0', 10);

    let title = '';
    const titleEl = document.querySelector(
      'h1.ytd-watch-metadata yt-formatted-string, .ytd-watch-metadata #title h1, ytd-watch-metadata h1, h1.ytd-watch-metadata, #title h1'
    );
    if (titleEl) {
      title = titleEl.textContent.trim();
    }
    if (!title) {
      title = document.title.replace(' - YouTube', '').trim();
    }

    let channel = 'YouTube';
    const channelEl = document.querySelector(
      '.ytd-watch-metadata #channel-name a, #upload-info #channel-name a, .ytp-title-channel-name, ytd-channel-name a'
    );
    if (channelEl) {
      channel = channelEl.textContent.trim();
    }

    let playlistTitle = null;
    let playlistTotal = 0;
    let playlistIndex = urlIndex || 0;

    if (playlistId) {
      const titleSelectors = [
        'ytd-playlist-panel-renderer #title-text a',
        'ytd-playlist-panel-renderer .title a',
        'ytd-playlist-panel-renderer h3 a',
        'ytd-playlist-panel-renderer #title',
        'ytd-playlist-panel-renderer #header-description a',
        '#playlist-title'
      ];
      let playlistEl = null;
      for (const sel of titleSelectors) {
        const el = document.querySelector(sel);
        if (el && el.textContent.trim()) {
          playlistEl = el;
          break;
        }
      }
      playlistTitle = playlistEl ? playlistEl.textContent.trim() : 'YouTube Playlist';

      const indexSelectors = [
        'ytd-playlist-panel-renderer .index-status-text',
        'ytd-playlist-panel-renderer .ytp-playlist-index',
        '.ytp-playlist-index'
      ];
      for (const sel of indexSelectors) {
        const el = document.querySelector(sel);
        if (el) {
          const match = el.textContent.match(/(\d+)\s*\/\s*(\d+)/);
          if (match) {
            playlistIndex = parseInt(match[1], 10);
            playlistTotal = parseInt(match[2], 10);
            break;
          }
        }
      }
    }

    const thumbnailUrl = videoId
      ? `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`
      : this.getFavicon();

    return {
      title,
      channel,
      thumbnailUrl,
      playlistId,
      playlistTitle,
      playlistTotal,
      playlistIndex
    };
  }

  getPlaylistUrls() {
    const entries = [];
    const seen = new Set();

    const renderers = document.querySelectorAll(
      'ytd-playlist-panel-video-renderer, ytd-playlist-video-renderer'
    );

    renderers.forEach((renderer, domOffset) => {
      const link = renderer.querySelector('a#video-title, a#thumbnail, a.ytd-playlist-video-renderer');
      if (!link || !link.href) return;

      const norm = link.href.split('&t=')[0];
      if (seen.has(norm)) return;
      seen.add(norm);

      let index = domOffset + 1;
      const indexEl = renderer.querySelector('.index, span.style-scope.ytd-playlist-panel-video-index');
      if (indexEl) {
        const parsed = parseInt(indexEl.textContent.trim(), 10);
        if (!isNaN(parsed)) index = parsed;
      }

      const titleEl = renderer.querySelector('#video-title, .ytd-playlist-video-renderer');
      entries.push({
        url: norm,
        index,
        title: titleEl ? titleEl.textContent.trim() : null
      });
    });

    return entries;
  }
}

class UdemyAdapter extends BaseAdapter {
  match(url) {
    return url.hostname.includes('udemy.com') && url.pathname.includes('/learn/');
  }

  getMetadata() {
    // URL structure: /course/[course-slug]/learn/lecture/[lecture-id]
    const pathParts = window.location.pathname.split('/');
    const courseIndex = pathParts.indexOf('course');
    let courseSlug = '';
    if (courseIndex !== -1 && pathParts[courseIndex + 1]) {
      courseSlug = pathParts[courseIndex + 1];
    }

    // Format Course Title from Slug
    const courseTitle = courseSlug
      ? courseSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      : 'Udemy Course';

    // Scrape Lecture Title
    let lectureTitle = '';
    const titleEl = document.querySelector('[class*="video-viewer--title"], [data-purpose="item-title"], h1[class*="title"]');
    if (titleEl) {
      lectureTitle = titleEl.textContent.trim();
    } else {
      lectureTitle = document.title.replace(' | Udemy', '');
    }

    return {
      title: lectureTitle,
      channel: 'Udemy',
      courseId: courseSlug ? `udemy_${courseSlug}` : null,
      playlistId: courseSlug ? `udemy_${courseSlug}` : null,
      playlistTitle: courseTitle,
      thumbnailUrl: this.getFavicon()
    };
  }

  getPlaylistUrls() {
    const urls = [];
    const links = document.querySelectorAll('a[href*="/learn/lecture/"]');
    links.forEach(a => {
      if (a.href) {
        urls.push(a.href);
      }
    });
    return urls;
  }
}

class CourseraAdapter extends BaseAdapter {
  match(url) {
    return url.hostname.includes('coursera.org') && url.pathname.includes('/learn/');
  }

  getMetadata() {
    // URL structure: /learn/[course-slug]/lecture/[lecture-id]
    const pathParts = window.location.pathname.split('/');
    const learnIndex = pathParts.indexOf('learn');
    let courseSlug = '';
    if (learnIndex !== -1 && pathParts[learnIndex + 1]) {
      courseSlug = pathParts[learnIndex + 1];
    }

    const courseTitle = courseSlug
      ? courseSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
      : 'Coursera Course';

    let lectureTitle = '';
    const titleEl = document.querySelector('.lecture-name, h1.video-title, [class*="lecture-title"]');
    if (titleEl) {
      lectureTitle = titleEl.textContent.trim();
    } else {
      lectureTitle = document.title.replace(' - Coursera', '');
    }

    return {
      title: lectureTitle,
      channel: 'Coursera',
      courseId: courseSlug ? `coursera_${courseSlug}` : null,
      playlistId: courseSlug ? `coursera_${courseSlug}` : null,
      playlistTitle: courseTitle,
      thumbnailUrl: this.getFavicon()
    };
  }

  getPlaylistUrls() {
    const urls = [];
    const links = document.querySelectorAll('a[href*="/lecture/"], a[href*="/learn/"]');
    links.forEach(a => {
      if (a.href && (a.href.includes('/lecture/') || a.href.includes('/item/'))) {
        urls.push(a.href);
      }
    });
    return urls;
  }
}

class VimeoAdapter extends BaseAdapter {
  match(url) {
    return url.hostname.includes('vimeo.com');
  }

  getMetadata() {
    let title = document.title;
    const titleEl = document.querySelector('.vimeo-title, h1.title');
    if (titleEl) {
      title = titleEl.textContent.trim();
    }

    let channel = 'Vimeo';
    const channelEl = document.querySelector('.vimeo-owner, a[rel="author"]');
    if (channelEl) {
      channel = channelEl.textContent.trim();
    }

    return {
      title,
      channel,
      thumbnailUrl: this.getFavicon(),
      playlistId: null,
      playlistTitle: null
    };
  }
}

class KhanAcademyAdapter extends BaseAdapter {
  match(url) {
    return url.hostname.includes('khanacademy.org') && url.pathname.includes('/v/');
  }

  getMetadata() {
    let title = document.title.replace(' | Khan Academy', '');
    const titleEl = document.querySelector('[data-test-id="video-title"], h1.title');
    if (titleEl) {
      title = titleEl.textContent.trim();
    }

    return {
      title,
      channel: 'Khan Academy',
      thumbnailUrl: this.getFavicon(),
      playlistId: null,
      playlistTitle: null
    };
  }
}

class EdXAdapter extends BaseAdapter {
  match(url) {
    return url.hostname.includes('edx.org') && (
      url.pathname.includes('/video/') ||
      url.pathname.includes('/xblock/') ||
      url.pathname.includes('/course-v1:')
    );
  }

  getMetadata() {
    const pathParts = window.location.pathname.split('/');
    let courseSlug = '';

    const courseIndex = pathParts.findIndex(p => p.startsWith('course-v1:'));
    if (courseIndex !== -1) {
      courseSlug = pathParts[courseIndex];
    } else {
      const learnIndex = pathParts.indexOf('learn');
      if (learnIndex !== -1 && pathParts[learnIndex + 1]) {
        courseSlug = pathParts[learnIndex + 1];
      }
    }

    const courseTitle = courseSlug
      ? courseSlug.split('+').slice(-1)[0].replace(/-/g, ' ')
      : 'edX Course';

    let lectureTitle = document.title.replace(' | edX', '');
    const titleEl = document.querySelector('.video-title, h2.unit-title, [class*="video-title"]');
    if (titleEl) {
      lectureTitle = titleEl.textContent.trim();
    }

    return {
      title: lectureTitle,
      channel: 'edX',
      courseId: courseSlug ? `edx_${courseSlug}` : null,
      playlistId: courseSlug ? `edx_${courseSlug}` : null,
      playlistTitle: courseTitle,
      thumbnailUrl: this.getFavicon()
    };
  }
}

class TwitchAdapter extends BaseAdapter {
  match(url) {
    return url.hostname.includes('twitch.tv') && url.pathname.includes('/videos/');
  }

  getMetadata() {
    let title = document.title.replace(' - Twitch', '');
    const titleEl = document.querySelector('[data-a-target="stream-title"]');
    if (titleEl) {
      title = titleEl.textContent.trim();
    }

    let channel = 'Twitch Channel';
    const channelEl = document.querySelector('.channel-info-bar__title-link, [data-a-target="channel-name"]');
    if (channelEl) {
      channel = channelEl.textContent.trim();
    }

    return {
      title,
      channel,
      thumbnailUrl: this.getFavicon(),
      playlistId: null,
      playlistTitle: null
    };
  }
}

// Global registry of adapters
const adapters = [
  new YouTubeAdapter(),
  new UdemyAdapter(),
  new CourseraAdapter(),
  new KhanAcademyAdapter(),
  new EdXAdapter(),
  new VimeoAdapter(),
  new TwitchAdapter(),
  new BaseAdapter() // Generic fallback
];

// Export to window so tracker.js can access it
window.getMetadataAdapter = function (urlStr) {
  try {
    const url = new URL(urlStr);
    for (const adapter of adapters) {
      if (adapter.match(url)) {
        return adapter;
      }
    }
  } catch (e) {
    console.error('Error matching adapter:', e);
  }
  return adapters[adapters.length - 1]; // return BaseAdapter
};
