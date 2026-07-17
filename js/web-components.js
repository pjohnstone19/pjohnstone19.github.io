import { Cache, AudioPlayer } from "./utils.js";

// one minute in milliseconds
let ONE_MINUTE = 60 * 1000;
let ONE_HOUR = 60 * ONE_MINUTE;

let CACHE = new Cache();
if (document.location.search.includes("clear-cache")) {
  CACHE.clear();
}
let CACHE_TTL = ONE_HOUR;

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Only allow https media from Apple CDNs returned by the iTunes Search API. */
function isTrustedAppleMediaUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return (
      host === "apple.com" ||
      host.endsWith(".apple.com") ||
      host === "mzstatic.com" ||
      host.endsWith(".mzstatic.com")
    );
  } catch {
    return false;
  }
}

class FigButton extends HTMLElement {
  connectedCallback() {
    if (!this.hasAttribute("role")) this.setAttribute("role", "button");
    if (!this.hasAttribute("tabindex")) this.tabIndex = 0;
    this.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.click();
      }
    });
  }
}

customElements.define("fig-button", FigButton);

class FigSwitch extends HTMLElement {
  connectedCallback() {
    if (this.querySelector("input.switch")) return;
    const checkedAttr = this.getAttribute("checked");
    const checked = checkedAttr === "" || checkedAttr === "true";
    this.innerHTML = `<input type="checkbox" class="switch"${checked ? " checked" : ""}>`;
    const input = this.querySelector("input.switch");
    input.addEventListener("change", () => {
      this.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  get checked() {
    return Boolean(this.querySelector("input.switch")?.checked);
  }

  set checked(value) {
    const input = this.querySelector("input.switch");
    if (input) input.checked = Boolean(value);
  }
}

customElements.define("fig-switch", FigSwitch);

class Music extends HTMLElement {
  #playToken = 0;

  constructor() {
    super();
    this.track = null;
    this.playPending = false;
  }
  connectedCallback() {
    this.image = this.getAttribute("image");
    this.title = this.getAttribute("title");
    this.artist = this.getAttribute("artist");
    this.link = this.getAttribute("link");
    this.delay = Number(this.getAttribute("delay")) || 0;
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

    this.player = new AudioPlayer(
      () => this.onEnded(),
      (e) => this.onTimeUpdate(e),
      () => this.#syncStoppedUi(),
    );
    this.player.setVolume(0.5);
    this.playing = false;
    this.playPending = false;
    this.setAttribute("playing", "false");
    this.render();
  }

  #isPlayCurrent(token) {
    return token === this.#playToken;
  }

  /** Cancel in-flight lookup/start and stop any audio that already began. */
  cancel() {
    this.#playToken++;
    this.playPending = false;
    this.player.stop();
    this.#forceStoppedUi();
  }

  #forceStoppedUi() {
    const hadPlayingUi =
      this.playing || this.classList.contains("playing");
    this.playing = false;
    this.setAttribute("playing", "false");
    this.classList.remove("playing");
    const button = this.querySelector("fig-button.play");
    if (button) {
      button.textContent = "Play";
      button.style.fontSize = "";
    }
    if (hadPlayingUi) {
      this.dispatchEvent(new CustomEvent("paused"));
    }
  }

  #syncStoppedUi() {
    if (!this.playing && !this.classList.contains("playing")) {
      if (this.getAttribute("playing") !== "false") {
        this.setAttribute("playing", "false");
      }
      return;
    }
    this.#forceStoppedUi();
  }
  render() {
    this.innerHTML = `
      <figure class="music-track">
        <div class="media media--music">
          <img src="${escapeHtml(this.image)}" alt="${escapeHtml(this.title)}">
        </div>
        <figcaption>
          <a href="${escapeHtml(this.link)}" target="_blank" rel="noopener noreferrer"><h3>${escapeHtml(this.title)}</h3></a>
          <p>${escapeHtml(this.artist)}</p>
          
        </figcaption>
        <fig-button class="btn play">${
          this.playing ? "Pause" : "Play"
        }</fig-button>
      </figure>
    `;
    this.querySelector("fig-button.play").addEventListener("click", () => {
      this.play();
    });
  }
  #getSearchTerm() {
    let term = `${this.title} ${this.artist}`;
    return term;
  }
  async fetchMusic() {
    let term = this.#getSearchTerm();
    const targetUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(
      term,
    )}&media=music&entity=song&limit=8`;
    this.track = null;
    try {
      const response = await fetch(targetUrl);
      if (!response.ok) {
        throw new Error(`iTunes search failed (${response.status})`);
      }
      const data = await response.json();
      if (!data.results?.length) {
        console.warn(`No music found for: ${term}`);
        return;
      }
      const title = (this.title || "").toLowerCase();
      const artist = (this.artist || "").toLowerCase();
      const match =
        data.results.find(
          (r) =>
            r.trackName?.toLowerCase().includes(title) &&
            r.artistName?.toLowerCase().includes(artist.split(" ")[0] || artist),
        ) || data.results[0];
      if (!isTrustedAppleMediaUrl(match?.previewUrl)) {
        console.warn(`Untrusted preview URL for: ${term}`);
        return;
      }
      this.track = match;
      this.setAttribute("file", this.track.previewUrl);
    } catch (error) {
      console.warn(`iTunes lookup failed for: ${term}`, error);
      this.track = null;
    }
  }

  //emit an event to the parent when audio hits the end of the track
  onEnded() {
    this.#syncStoppedUi();
    this.dispatchEvent(new CustomEvent("ended"));
  }

  //time update event listener
  onTimeUpdate() {
    let percent = this.player.audio.currentTime / this.player.audio.duration;
    this.style.setProperty("--percent", percent);
    this.dispatchEvent(
      new CustomEvent("timeupdate", {
        detail: {
          currentTime: this.player.audio.currentTime,
          duration: this.player.audio.duration,
          percent: percent,
        },
      }),
    );
  }

  async playTrack(token = this.#playToken) {
    if (!this.track) {
      await this.fetchMusic();
      if (!this.#isPlayCurrent(token)) return;
    }
    if (!this.track) {
      if (this.#isPlayCurrent(token)) {
        this.showError("Tap to retry");
      }
      return;
    }

    try {
      if (
        this.player.currentUrl !== this.track.previewUrl ||
        !this.player.isPlaying
      ) {
        await this.player.play(this.track.previewUrl);
        if (!this.#isPlayCurrent(token)) {
          this.player.stop();
          this.#forceStoppedUi();
          return;
        }
        this.playing = true;
        this.setAttribute("playing", "true");
        this.hideError();
      } else {
        // pause() fires the audio "pause" event → #syncStoppedUi
        await this.player.pause();
      }
    } catch (error) {
      if (!this.#isPlayCurrent(token)) return;
      console.warn("Track playback failed:", error);
      this.#syncStoppedUi();
      this.showError("Tap to retry");
    }
  }

  showError(message) {
    const button = this.querySelector("fig-button.play");
    if (button) {
      button.textContent = message;
      button.style.fontSize = "0.6rem";
    }
  }

  hideError() {
    const button = this.querySelector("fig-button.play");
    if (button) {
      button.textContent = this.playing ? "Pause" : "Play";
      button.style.fontSize = "";
    }
  }

  async play() {
    const token = ++this.#playToken;
    this.playPending = true;

    // Initialize audio on iOS with user gesture
    if (this.isIOS) {
      this.player.initializeAudio();
    }

    try {
      await this.playTrack(token);
      if (!this.#isPlayCurrent(token)) return;
      if (this.playing) {
        this.classList.add("playing");
        this.dispatchEvent(new CustomEvent("playing"));
      }
    } finally {
      if (this.#isPlayCurrent(token)) {
        this.playPending = false;
      }
    }
  }
  static get observedAttributes() {
    return ["current"];
  }
}

customElements.define("peters-music", Music);

class MusicList extends HTMLElement {
  constructor() {
    super();
    this.playlist = [];
    this.playingTrack = null;
    this.playbackRate = 33;
    this.currentTrack = 0;
    this.limit = 10;
    this.loading = true;
    this.delay = Number(this.getAttribute("delay")) || 0;
  }
  async connectedCallback() {
    this.limit = this.getAttribute("limit") || 11;
    this.setAttribute("loading", this.loading);
    await this.fetchMusic();
    this.render();
    this.loading = false;
    this.setAttribute("loading", this.loading);
    this.style.setProperty("--playback-rate", this.playbackRate);

    // Initialize vinyl crackle sound
    this.isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    this.vinylCrackle = new Audio("assets/vinyl-crackle.m4a");
    this.vinylCrackle.volume = 0.5;
    this.vinylCrackle.loop = false;
    this.vinylCrackle.currentTime = 0;
    this.vinylCrackleReady = false;

    // Preload vinyl crackle on first user interaction for iOS
    if (this.isIOS) {
      this.vinylCrackle.load();
    }
  }
  //preload image
  async preloadTrack(track) {
    return new Promise((resolve, reject) => {
      let img = new Image();
      img.src = track.imageSrc;
      img.onload = () => {
        track.error = false;
        resolve(track);
      };
      img.onerror = () => {
        track.error = true;
        resolve(track);
      };
    });
  }
  async preloadPlaylist(limit = this.limit) {
    return Promise.all(this.playlist.slice(0, limit).map(this.preloadTrack));
  }
  async fetchMusic() {
    const favorites = [
      {
        name: "Next Levels",
        artistName: "King Geedorah",
        url: "https://music.apple.com/search?term=Next%20Levels%20King%20Geedorah",
      },
      {
        name: "Lady Brown",
        artistName: "Nujabes",
        url: "https://music.apple.com/search?term=Lady%20Brown%20Nujabes",
      },
      {
        name: "Sublime",
        artistName: "Sublime",
        url: "https://music.apple.com/search?term=Sublime%20album",
      },
      {
        name: "Renegade",
        artistName: "Styx",
        url: "https://music.apple.com/search?term=Renegade%20Styx",
      },
      {
        name: "What You Know",
        artistName: "Two Door Cinema Club",
        url: "https://music.apple.com/search?term=What%20You%20Know%20Two%20Door%20Cinema%20Club",
      },
      {
        name: "Rooster",
        artistName: "Alice In Chains",
        url: "https://music.apple.com/search?term=Rooster%20Alice%20In%20Chains",
      },
      {
        name: "Amber",
        artistName: "311",
        url: "https://music.apple.com/search?term=Amber%20311",
      },
      {
        name: "1979",
        artistName: "The Smashing Pumpkins",
        url: "https://music.apple.com/search?term=1979%20Smashing%20Pumpkins",
      },
      {
        name: "Day Dreaming",
        artistName: "Aretha Franklin",
        url: "https://music.apple.com/search?term=Day%20Dreaming%20Aretha%20Franklin",
      },
      {
        name: "Billie Jean",
        artistName: "Michael Jackson",
        url: "https://music.apple.com/search?term=Billie%20Jean%20Michael%20Jackson",
      },
      {
        name: "Do It Again",
        artistName: "Steely Dan",
        url: "https://music.apple.com/search?term=Do%20It%20Again%20Steely%20Dan",
      },
    ];

    const cacheKey = "playlist-favorites-v6";
    let cachedMusic = CACHE.get(cacheKey);
    if (cachedMusic) {
      this.playlist = cachedMusic;
    } else {
      this.playlist = await Promise.all(
        favorites.map(async (album) => {
          const artwork = await this.fetchArtwork(album.name, album.artistName);
          return {
            name: album.name,
            artistName: album.artistName,
            url: album.url,
            imageSrc: artwork,
          };
        }),
      );
      CACHE.set(cacheKey, this.playlist, CACHE_TTL);
    }
    await this.preloadPlaylist(this.limit);
  }

  async fetchArtwork(title, artist) {
    try {
      const targetUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(
        `${title} ${artist}`,
      )}&media=music&entity=song&limit=5`;
      const response = await fetch(targetUrl);
      if (!response.ok) {
        throw new Error(`iTunes artwork search failed (${response.status})`);
      }
      const data = await response.json();
      const match =
        data.results?.find(
          (r) =>
            r.trackName?.toLowerCase().includes(title.toLowerCase()) &&
            r.artistName?.toLowerCase().includes(artist.toLowerCase().split(" ")[0]),
        ) || data.results?.[0];
      const artwork = match?.artworkUrl100?.replace("100x100bb", "600x600bb") || "";
      return isTrustedAppleMediaUrl(artwork) ? artwork : "";
    } catch (error) {
      console.warn("Artwork fetch failed:", error);
      return "";
    }
  }

  #advanceTrack({ continuePlayback = false } = {}) {
    const renderedTracks = this.querySelectorAll("peters-music");
    if (!renderedTracks.length) return;

    const previous = this.querySelector("peters-music[current='true']");
    this.currentTrack++;
    if (this.currentTrack >= renderedTracks.length) {
      this.currentTrack = 0;
    }

    previous?.setAttribute("current", "false");
    // Always cancel in-flight starts, not only tracks already marked playing.
    previous?.cancel();

    const current = renderedTracks[this.currentTrack];
    current.setAttribute("current", "true");
    this.style.setProperty("--percent", 0);

    if (continuePlayback) {
      current.play();
    }
  }

  render() {
    this.innerHTML = `
    <span class="turntable-speed-control">
      <label>33</label>
      <fig-switch checked="${this.playbackRate === 45}"></fig-switch>
      <label>45</label>
    </span>
    <fig-button class="btn next">Next</fig-button>
    <input type="button" class="turntable-needle" />
    ${
      this.isIOS
        ? '<div class="ios-notice" style="position: absolute; top: 0.5rem; left: 0.5rem; font-size: 0.6rem; opacity: 0.7; max-width: 100px;">Tap play button to start music</div>'
        : ""
    }${this.playlist
      .filter((track) => !track.error)
      .slice(0, this.limit)
      .map((track, index) => {
        return `<peters-music 
        image="${escapeHtml(track.imageSrc)}" 
        title="${escapeHtml(track.name)}"
        current="${index === this.currentTrack}"
        artist="${escapeHtml(track.artistName)}"
        delay="${this.delay}"
        link="${escapeHtml(track.url)}"></peters-music>`;
      })
      .join("")}`;
    this.querySelectorAll("peters-music").forEach((musicElement) => {
      musicElement.addEventListener("timeupdate", (e) => {
        this.style.setProperty("--percent", e.detail.percent);
      });
      musicElement.addEventListener("playing", () => {
        // Initialize vinyl crackle on first play for iOS
        if (this.isIOS && !this.vinylCrackleReady) {
          this.vinylCrackleReady = true;
          // Don't play vinyl crackle on iOS to avoid gesture issues
          return;
        }

        // Play vinyl crackle only on non-iOS devices or if already initialized
        if (!this.isIOS || this.vinylCrackleReady) {
          try {
            this.vinylCrackle.volume = 0.3;
            this.vinylCrackle.loop = false;
            this.vinylCrackle.currentTime = 0;
            this.vinylCrackle.play().catch((error) => {
              console.warn("Vinyl crackle playback failed:", error);
            });

            let toInterval = setInterval(() => {
              this.vinylCrackle.volume = Math.max(
                Number(this.vinylCrackle.volume.toFixed(2)) - 0.01,
                0,
              );
              if (this.vinylCrackle.volume <= 0) {
                clearInterval(toInterval);
                this.vinylCrackle.pause();
              }
            }, 100);
          } catch (error) {
            console.warn("Vinyl crackle initialization failed:", error);
          }
        }
      });
      musicElement.addEventListener("paused", () => {
        this.vinylCrackle.pause();
      });
    });

    // Add event listeners after the DOM is updated
    this.querySelectorAll("peters-music").forEach((musicElement, index) => {
      musicElement.addEventListener("ended", () => {
        // Auto-advance to next track when current track ends
        if (index === this.currentTrack) {
          this.#advanceTrack({ continuePlayback: true });
        }
      });
    });

    this.querySelector("fig-button.next").addEventListener("click", () => {
      const previous = this.querySelector("peters-music[current='true']");
      const continuePlayback = Boolean(
        previous?.playing || previous?.playPending,
      );
      this.#advanceTrack({ continuePlayback });
    });
    this.querySelector("input.turntable-needle").addEventListener(
      "click",
      () => {
        //play the current track
        let current = this.querySelector("peters-music[current='true']");
        current.play();
      },
    );

    this.querySelector("fig-switch").addEventListener("change", (e) => {
      const switchEl = e.currentTarget;
      this.playbackRate = switchEl.checked ? 45 : 33;
      this.style.setProperty("--playback-rate", this.playbackRate);
      this.querySelectorAll("peters-music").forEach((musicElement) => {
        musicElement.player.setPlaybackRate(this.playbackRate / 33);
      });
    });
  }
}

customElements.define("peters-music-list", MusicList);
