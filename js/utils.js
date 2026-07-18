/** True on iPhone/iPod/iPad, including iPadOS desktop-class UA. */
function needsGestureUnlock() {
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS 13+ can report as Macintosh with touch support.
  if (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1) {
    return true;
  }
  return false;
}

class Cache {
  constructor(prefix = "cache_") {
    this.prefix = prefix;
    this.ttlPrefix = `${prefix}ttl_`;
  }

  #storageAvailable() {
    try {
      const testKey = `${this.prefix}__storage_test__`;
      localStorage.setItem(testKey, "1");
      localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  // Set a value with optional TTL (time-to-live in milliseconds)
  set(key, value, ttl = null) {
    try {
      if (!this.#storageAvailable()) return;

      const fullKey = this.prefix + key;
      const data = {
        value: value,
        timestamp: Date.now(),
        ttl: ttl,
      };

      localStorage.setItem(fullKey, JSON.stringify(data));

      // If TTL is provided, store the expiration time
      if (ttl) {
        const ttlKey = this.ttlPrefix + key;
        const expirationTime = Date.now() + ttl;
        localStorage.setItem(ttlKey, expirationTime.toString());
      }
    } catch {
      // Caching is optional; ignore storage failures.
    }
  }

  // Get a value, returns null if expired, missing, or storage is blocked
  get(key) {
    try {
      const fullKey = this.prefix + key;
      const ttlKey = this.ttlPrefix + key;

      // Check if item exists
      const item = localStorage.getItem(fullKey);
      if (!item) return null;

      // Check TTL
      const ttlValue = localStorage.getItem(ttlKey);
      if (ttlValue) {
        const expirationTime = parseInt(ttlValue);
        if (Date.now() > expirationTime) {
          this.remove(key);
          return null;
        }
      }

      try {
        const data = JSON.parse(item);
        return data.value;
      } catch {
        return null;
      }
    } catch {
      return null;
    }
  }

  // Remove a specific key
  remove(key) {
    try {
      const fullKey = this.prefix + key;
      const ttlKey = this.ttlPrefix + key;

      localStorage.removeItem(fullKey);
      localStorage.removeItem(ttlKey);
    } catch {
      // Ignore storage failures.
    }
  }

  // Clear all cached items owned by this cache instance
  clear() {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach((key) => {
        if (key.startsWith(this.prefix) || key.startsWith(this.ttlPrefix)) {
          localStorage.removeItem(key);
        }
      });
    } catch {
      // Ignore storage failures.
    }
  }
}

class AudioPlayer {
  #primeId = 0;

  constructor(onEnded = null, onTimeUpdate = null, onPause = null) {
    this.currentUrl = null;
    this.audio = null;
    this.isPlaying = false;
    this.volume = 1;
    this.fadeOutInterval = null;
    this.fadeInInterval = null;
    this.onEnded = onEnded;
    this.onTimeUpdate = onTimeUpdate;
    this.onPause = onPause;
    this.playbackRate = 1;
    this.fadeDuration = 100;
    this.needsGestureUnlock = needsGestureUnlock();
    this.isIOS = this.needsGestureUnlock;
    this.hasUserGesture = false;
    this.pendingPlay = false;
  }

  setFadeDuration(duration = 500) {
    this.fadeDuration = duration;
  }

  setVolume(volume) {
    this.volume = volume;
    if (this.audio) {
      this.audio.volume = volume;
    }
  }
  setPlaybackRate(rate) {
    this.playbackRate = rate;
    if (this.audio) {
      this.audio.playbackRate = rate;
    }
  }

  #ensureAudioElement() {
    if (this.audio) return;
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.audio.setAttribute("playsinline", "");
    this.audio.setAttribute("webkit-playsinline", "");
    this.audio.playbackRate = this.playbackRate;
    this.audio.addEventListener("ended", () => {
      this.isPlaying = false;
      this.onEnded?.();
    });
    if (this.onTimeUpdate) {
      this.audio.addEventListener("timeupdate", this.onTimeUpdate);
    }
    if (this.onPause) {
      this.audio.addEventListener("pause", this.onPause);
    }
  }

  /**
   * Call synchronously from a tap/click handler so WebKit keeps user activation
   * for the eventual audible play(), even if setup continues in microtasks.
   */
  captureUserGesture() {
    this.#ensureAudioElement();
    this.hasUserGesture = true;
    if (!this.needsGestureUnlock) return;

    // Only empty-src primes need cleanup. If media is already loaded, a play()
    // here would start real audio and must not be paused by a late .then().
    const isEmptySrcPrime = !this.audio.getAttribute("src");
    if (!isEmptySrcPrime) return;

    const primeId = ++this.#primeId;
    const playPromise = this.audio.play();
    if (playPromise === undefined) return;

    playPromise
      .then(() => {
        // Abort if a real src was assigned (or priming was superseded) before
        // this empty-src promise settled.
        if (primeId !== this.#primeId) return;
        if (this.audio.getAttribute("src")) return;
        this.audio.pause();
        try {
          this.audio.currentTime = 0;
        } catch {
          // Ignore seek errors while priming.
        }
      })
      .catch(() => {});
  }

  async fadeOut() {
    if (!this.audio) return;

    // Clear any existing fade interval
    if (this.fadeOutInterval) {
      clearInterval(this.fadeOutInterval);
      this.fadeOutInterval = null;
    }

    // Instant pause on iOS so track changes stay inside the unlocked session.
    if (this.needsGestureUnlock) {
      this.audio.pause();
      return;
    }

    const startVolume = this.audio.volume;
    const steps = Math.max(1, Math.floor(this.fadeDuration / 50));
    let step = 0;
    const volumeStep = startVolume / steps;

    return new Promise((resolve) => {
      this.fadeOutInterval = setInterval(() => {
        step++;
        const newVolume = Math.max(0, startVolume - volumeStep * step);
        this.audio.volume = newVolume;

        if (step >= steps || newVolume <= 0) {
          clearInterval(this.fadeOutInterval);
          this.fadeOutInterval = null;
          this.audio.pause();
          resolve();
        }
      }, this.fadeDuration / steps);
    });
  }

  async fadeIn() {
    if (!this.audio) return;

    // Clear any existing fade interval
    if (this.fadeInInterval) {
      clearInterval(this.fadeInInterval);
      this.fadeInInterval = null;
    }

    const targetVolume = this.volume;

    // iOS: play at target volume immediately — fading from 0 is less reliable
    // and adds async work after the gesture.
    if (this.needsGestureUnlock) {
      this.audio.volume = targetVolume;
      await this.audio.play();
      return;
    }

    const steps = Math.max(1, Math.floor(this.fadeDuration / 50));
    let step = 0;
    const volumeStep = targetVolume / steps;

    this.audio.volume = 0;

    try {
      await this.audio.play();
    } catch (error) {
      console.warn("Audio play failed during fade in:", error);
      throw error;
    }

    return new Promise((resolve) => {
      this.fadeInInterval = setInterval(() => {
        step++;
        const newVolume = Math.min(targetVolume, volumeStep * step);
        this.audio.volume = newVolume;

        if (step >= steps || newVolume >= targetVolume) {
          clearInterval(this.fadeInInterval);
          this.fadeInInterval = null;
          resolve();
        }
      }, this.fadeDuration / steps);
    });
  }

  // Initialize audio with user gesture (call this on first user interaction)
  initializeAudio() {
    this.captureUserGesture();
  }

  async play(url = null) {
    // On iOS, ensure we have a user gesture
    if (this.needsGestureUnlock && !this.hasUserGesture) {
      this.initializeAudio();
    }

    if (url && url !== this.currentUrl) {
      // If there's a current track playing, fade it out first
      if (this.audio && this.isPlaying) {
        await this.fadeOut();
      }

      this.currentUrl = url;
      this.#ensureAudioElement();

      // Only allow https audio URLs
      if (url && !/^https:\/\//i.test(url)) {
        throw new Error("Invalid audio URL");
      }

      // Load the new URL. Invalidate any empty-src prime cleanup so it cannot
      // pause/seek this real playback when its promise settles late.
      this.#primeId++;
      this.audio.src = url;
      this.audio.volume = this.needsGestureUnlock ? this.volume : 0;

      try {
        // Preload on non-iOS devices
        if (!this.needsGestureUnlock) {
          this.audio.load();
        }
        await this.fadeIn();
        this.isPlaying = true;
      } catch (error) {
        console.warn("Audio playback failed:", error);
        this.isPlaying = false;
        // Fallback: try direct play for iOS
        if (this.needsGestureUnlock) {
          try {
            this.audio.volume = this.volume;
            await this.audio.play();
            this.isPlaying = true;
            return;
          } catch (iosError) {
            console.error("iOS audio playback failed:", iosError);
            this.isPlaying = false;
            throw iosError;
          }
        }
        throw error;
      }
    } else if (this.audio) {
      if (!this.isPlaying) {
        try {
          await this.fadeIn();
          this.isPlaying = true;
        } catch (error) {
          console.warn("Resume playback failed:", error);
          this.isPlaying = false;
          // Fallback for iOS
          if (this.needsGestureUnlock) {
            try {
              this.audio.volume = this.volume;
              await this.audio.play();
              this.isPlaying = true;
              return;
            } catch (iosError) {
              this.isPlaying = false;
              throw iosError;
            }
          }
          throw error;
        }
      }
    } else {
      this.isPlaying = false;
      throw new Error("No audio element available to play");
    }
  }

  async pause() {
    if (this.audio && this.isPlaying) {
      await this.fadeOut();
      this.isPlaying = false;
    }
  }

  /** Hard-stop audio even if a start is still in flight and isPlaying is false. */
  stop() {
    if (this.fadeInInterval) {
      clearInterval(this.fadeInInterval);
      this.fadeInInterval = null;
    }
    if (this.fadeOutInterval) {
      clearInterval(this.fadeOutInterval);
      this.fadeOutInterval = null;
    }
    if (this.audio) {
      this.audio.pause();
      try {
        this.audio.currentTime = 0;
      } catch {
        // Ignore if the media element rejects seeking while loading.
      }
    }
    this.isPlaying = false;
  }
}

export { Cache, AudioPlayer, needsGestureUnlock };
