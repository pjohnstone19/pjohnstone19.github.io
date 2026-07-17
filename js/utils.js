class Cache {
  constructor(prefix = "cache_") {
    this.prefix = prefix;
    this.ttlPrefix = `${prefix}ttl_`;
  }

  // Set a value with optional TTL (time-to-live in milliseconds)
  set(key, value, ttl = null) {
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
  }

  // Get a value, returns null if expired or not found
  get(key) {
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
    } catch (e) {
      return null;
    }
  }

  // Remove a specific key
  remove(key) {
    const fullKey = this.prefix + key;
    const ttlKey = this.ttlPrefix + key;

    localStorage.removeItem(fullKey);
    localStorage.removeItem(ttlKey);
  }

  // Clear all cached items owned by this cache instance
  clear() {
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.startsWith(this.prefix) || key.startsWith(this.ttlPrefix)) {
        localStorage.removeItem(key);
      }
    });
  }
}

class AudioPlayer {
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
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
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

  async fadeOut() {
    if (!this.audio) return;

    // Clear any existing fade interval
    if (this.fadeOutInterval) {
      clearInterval(this.fadeOutInterval);
      this.fadeOutInterval = null;
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
    const steps = Math.max(1, Math.floor(this.fadeDuration / 50));
    let step = 0;
    const volumeStep = targetVolume / steps;

    this.audio.volume = 0;

    try {
      await this.audio.play();
    } catch (error) {
      console.warn("Audio play failed during fade in:", error);
      // For iOS, set volume directly and throw error up
      if (this.isIOS) {
        this.audio.volume = targetVolume;
        throw error;
      }
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
    if (!this.audio && this.isIOS) {
      this.audio = new Audio();
      this.audio.volume = 0;
      this.audio.playbackRate = this.playbackRate;
      this.hasUserGesture = true;

      // Set up event listeners once
      if (this.onEnded) {
        this.audio.addEventListener("ended", this.onEnded);
      }
      if (this.onTimeUpdate) {
        this.audio.addEventListener("timeupdate", this.onTimeUpdate);
      }
      if (this.onPause) {
        this.audio.addEventListener("pause", this.onPause);
      }
    }
  }

  async play(url = null) {
    // On iOS, ensure we have a user gesture
    if (this.isIOS && !this.hasUserGesture) {
      this.initializeAudio();
    }

    if (url && url !== this.currentUrl) {
      // If there's a current track playing, fade it out first
      if (this.audio && this.isPlaying) {
        await this.fadeOut();
      }

      this.currentUrl = url;

      if (!this.audio) {
        this.audio = new Audio();
        this.audio.playbackRate = this.playbackRate;

        // Set up event listeners for new audio element
        if (this.onEnded) {
          this.audio.addEventListener("ended", this.onEnded);
        }
        if (this.onTimeUpdate) {
          this.audio.addEventListener("timeupdate", this.onTimeUpdate);
        }
        if (this.onPause) {
          this.audio.addEventListener("pause", this.onPause);
        }
      }

      // Only allow https audio URLs
      if (url && !/^https:\/\//i.test(url)) {
        throw new Error("Invalid audio URL");
      }

      // Load the new URL
      this.audio.src = url;
      this.audio.volume = 0;

      try {
        // Preload on non-iOS devices
        if (!this.isIOS) {
          await this.audio.load();
        }
        await this.fadeIn();
      } catch (error) {
        console.warn("Audio playback failed:", error);
        // Fallback: try direct play for iOS
        if (this.isIOS) {
          try {
            this.audio.volume = this.volume;
            await this.audio.play();
            this.isPlaying = true;
          } catch (iosError) {
            console.error("iOS audio playback failed:", iosError);
          }
        }
      }
    } else if (this.audio) {
      if (!this.isPlaying) {
        try {
          await this.fadeIn();
        } catch (error) {
          console.warn("Resume playback failed:", error);
          // Fallback for iOS
          if (this.isIOS) {
            this.audio.volume = this.volume;
            await this.audio.play();
            this.isPlaying = true;
          }
        }
      }
    }

    this.isPlaying = true;
  }

  async pause() {
    if (this.audio && this.isPlaying) {
      await this.fadeOut();
      this.isPlaying = false;
    }
  }
}

export { Cache, AudioPlayer };
