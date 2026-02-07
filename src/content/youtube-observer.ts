// YouTube SPA navigation detection
// YouTube fires "yt-navigate-finish" on SPA navigation and reuses the <video> element.

export interface YouTubeObserverCallbacks {
  onVideoFound(video: HTMLVideoElement): void;
  onNavigate(): void;
}

export class YouTubeObserver {
  private callbacks: YouTubeObserverCallbacks;
  private observer: MutationObserver | null = null;
  private currentVideo: HTMLVideoElement | null = null;

  constructor(callbacks: YouTubeObserverCallbacks) {
    this.callbacks = callbacks;
  }

  start(): void {
    // Listen for YouTube SPA navigation events
    document.addEventListener(
      "yt-navigate-finish",
      this.handleNavigate
    );

    // MutationObserver to detect video element insertion
    this.observer = new MutationObserver(this.handleMutation);
    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Initial check
    this.findVideo();
  }

  stop(): void {
    document.removeEventListener(
      "yt-navigate-finish",
      this.handleNavigate
    );
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    this.currentVideo = null;
  }

  private handleNavigate = (): void => {
    this.callbacks.onNavigate();
    this.findVideo();
  };

  private handleMutation = (): void => {
    if (!this.currentVideo || !document.contains(this.currentVideo)) {
      this.findVideo();
    }
  };

  private findVideo(): void {
    // Shorts pages have 2 video elements (active + empty preload placeholder).
    // Prefer the one with a src attribute (the active video).
    const videos = document.querySelectorAll<HTMLVideoElement>(
      "video.html5-main-video, video.video-stream"
    );
    const video = Array.from(videos).find((v) => v.src) ?? videos[0] ?? null;
    if (video && video !== this.currentVideo) {
      this.currentVideo = video;
      this.callbacks.onVideoFound(video);
    }
  }
}
