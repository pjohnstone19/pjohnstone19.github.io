import { Utils, Cache, AudioPlayer, TMDB, FocusLayer } from "./utils.js";

// one minute in milliseconds
let ONE_MINUTE = 60 * 1000;
let ONE_HOUR = 60 * ONE_MINUTE;
let ONE_DAY = 24 * ONE_HOUR;

let CACHE = new Cache();
if (document.location.search.includes("clear-cache")) {
  CACHE.clear();
}
let CACHE_TTL = ONE_HOUR;
const focusLayer = new FocusLayer();
window.focusLayer = focusLayer;

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

class Movie extends HTMLElement {
  constructor() {
    super();
    this.title = this.getAttribute("title");
    this.rating = this.getAttribute("rating");
    this.image = this.getAttribute("image");
    this.link = this.getAttribute("link");
    this.showTooltip = this.getAttribute("tooltip") !== "false";
    this.render();
  }
  render() {
    /*this.innerHTML = `
     
    <a href="${this.link}" target="_blank">
        <figure class="movie">
            <fig-tooltip text="${this.title} — ${
      this.rating
    }" position="top" delay="300">
            <div class="media media--movie">
              <img src="${this.image}" alt="${this.title}">
            </div>
            </fig-tooltip>
            <figcaption>
                <h3>${this.title}</h3>
                ${this.rating ? `<p>${this.rating}</p>` : ""}
            </figcaption>
        </figure>
    </a>
    
    `;*/
    const movieMarkup = `
      <div class="cover box" style="--cover: url(${this.image})">
        <div class="front"></div>
        <div class="back"></div>
        <div class="left"><div>${this.title}</div></div>
        <div class="right"></div>
        <div class="top"></div>
        <div class="bottom"></div>
        
        <div class="tape box">
          <div class="front"></div>
          <div class="back"></div>
          <div class="left"></div>
          <div class="right"></div>
          <div class="top"></div>
          <div class="bottom"></div>
        </div>
      </div>
    `;
    this.innerHTML = this.showTooltip
      ? `<fig-tooltip text="${this.title} — ${this.rating}" position="top" delay="300">${movieMarkup}</fig-tooltip>`
      : movieMarkup;
    this.querySelector(".cover").addEventListener("mouseenter", () => {
      this.title = "";
    });
    this.querySelector(".cover").addEventListener("mouseleave", () => {
      this.title = this.title;
    });
  }
}

customElements.define("rogie-movie", Movie);

class MovieList extends HTMLElement {
  constructor() {
    super();
    this.movies = [];
    this.loading = true;
    this.tmdb = new TMDB("7664ae5d990fb544f070d6a090befec5");
    this.selected = null;
  }
  async connectedCallback() {
    this.limit = this.getAttribute("limit") || 8;
    this.setAttribute("data-focus-container", "movies");
    this.setAttribute("loading", this.loading);
    await this.fetchMovies();
    this.loading = false;
    this.setAttribute("loading", this.loading);
    this.render();
  }
  async preloadMovies() {
    await Promise.all(this.movies.map(this.preloadMovie));
  }
  async preloadMovie(movie) {
    let img = new Image();
    img.src = movie.thumbnail;
    return new Promise((resolve, reject) => {
      img.onload = () => {
        movie.error = false;
        resolve(movie);
      };
      img.onerror = () => {
        movie.error = true;
        resolve(movie);
      };
    });
  }
  async #fillMovieData(movie) {
    let titleParts = movie.title.split(" - ");
    let title = titleParts[0];
    movie.rating = titleParts.length > 1 ? titleParts[1] : null;
    movie.thumbnail = movie.thumbnail;
    movie.year = title.match(/,\s*(\d{4})/)?.[1]; //the year is in the title like "Mickey 17, 2025"

    // Remove the year from the title
    if (movie.year) {
      title = title.replace(/,\s*\d{4}/, "").trim();
    }

    movie.title = title;
    movie.link = movie.link;
    if (!movie.thumbnail) {
      movie.thumbnail = movie.content.match(/<img src="([^"]+)"/)[1];
    }
    let search = await this.tmdb.search(movie.title);
    movie.tmdb = search.results;
    if (movie.tmdb.length > 0) {
      movie.tmdb = movie.tmdb[0];
      const posterPath = movie.tmdb.poster_path;
      const backdropPath = movie.tmdb.backdrop_path;
      movie.tmdb.images = {
        poster: {
          thumb: this.tmdb.getImageUrl(posterPath, "w342"),
          focus: this.tmdb.getImageUrl(posterPath, "w780"),
        },
        backdrop: {
          thumb: this.tmdb.getImageUrl(backdropPath, "w500"),
          focus: this.tmdb.getImageUrl(backdropPath, "w1280"),
        },
      };
      movie.thumbnail = movie.tmdb.images.poster.thumb || movie.thumbnail;
      movie.tmdb.poster_path = movie.tmdb.images.poster.thumb;
      movie.tmdb.backdrop_path = movie.tmdb.images.backdrop.thumb;
      movie.tmdb.release_date = new Date(movie.tmdb.release_date);
    }

    return movie;
  }

  async fetchMovies() {
    let cachedMovies = CACHE.get("movies");
    if (cachedMovies) {
      this.movies = cachedMovies;
    } else {
      let rssUrl = "https://letterboxd.com/rogieking/rss/";
      let f = await fetch(
        `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(
          rssUrl,
        )}`,
      );
      let data = await f.json();
      this.movies = data.items;
      this.movies = await Promise.all(
        this.movies.map(async (movie) => await this.#fillMovieData(movie)),
      );
      CACHE.set("movies", this.movies, CACHE_TTL);
    }
    await this.preloadMovies();
  }

  #setSelected(movie) {
    this.selected = movie;
    this.querySelectorAll("rogie-movie").forEach((node) => {
      if (node === movie) {
        node.classList.add("selected");
      } else {
        node.classList.remove("selected");
      }
    });
  }

  #clearSelected() {
    this.selected = null;
    this.querySelectorAll("rogie-movie").forEach((node) => {
      node.classList.remove("selected");
    });
  }

  #getMovieMeta(id) {
    return this.movies.find((movie) => String(movie?.tmdb?.id) === String(id));
  }

  #getMovieCoverImage(movieMeta, quality = "thumb") {
    if (!movieMeta) {
      return "";
    }
    return (
      movieMeta?.tmdb?.images?.poster?.[quality] ||
      movieMeta?.tmdb?.poster_path ||
      movieMeta?.thumbnail ||
      ""
    );
  }

  #getMovieBackdropImage(movieMeta, quality = "thumb") {
    if (!movieMeta) {
      return "";
    }
    return (
      movieMeta?.tmdb?.images?.backdrop?.[quality] ||
      movieMeta?.tmdb?.backdrop_path ||
      this.#getMovieCoverImage(movieMeta, quality)
    );
  }

  #getMovieImagePolicy(movieMeta) {
    return {
      thumb: this.#getMovieCoverImage(movieMeta, "thumb"),
      focus: this.#getMovieCoverImage(movieMeta, "focus"),
      apply: (target, imageUrl) => {
        const cover = target.querySelector(".cover");
        if (!cover || !imageUrl) {
          return;
        }
        cover.style.setProperty("--cover", `url(${imageUrl})`);
      },
      prefetchOnOpen: true,
    };
  }

  async #buildMoviePayload(movie) {
    const id = movie.getAttribute("id");
    const movieMeta = this.#getMovieMeta(id);

    let trailerUrl = "";
    try {
      const tmdbMovie = await this.tmdb.getMovie(id);
      const trailer =
        tmdbMovie?.results?.find(
          (result) =>
            result?.site === "YouTube" &&
            (result?.type === "Trailer" || result?.type === "Teaser"),
        ) || tmdbMovie?.results?.[0];
      if (trailer?.key) {
        trailerUrl = this.tmdb.getYoutubeUrl(trailer.key);
      }
    } catch (error) {
      console.warn("Unable to fetch trailer data", error);
    }

    const year =
      movieMeta?.year ||
      (movieMeta?.tmdb?.release_date
        ? new Date(movieMeta.tmdb.release_date).getFullYear()
        : "");
    const metaParts = [movieMeta?.rating, year].filter(Boolean).join(" • ");

    return {
      title: movieMeta?.title || movie.getAttribute("title") || "",
      meta: metaParts,
      overview:
        movieMeta?.tmdb?.overview || "No overview available for this one yet.",
      imageAlt: movieMeta?.title || movie.getAttribute("title") || "Movie",
      actions: [
        trailerUrl
          ? {
              label: "Watch Trailer",
              href: trailerUrl,
              target: "_blank",
            }
          : null,
        movieMeta?.link
          ? {
              label: "View on Letterboxd",
              href: movieMeta.link,
              target: "_blank",
            }
          : null,
      ].filter(Boolean),
    };
  }

  async #focusMovie(movie) {
    if (focusLayer.isTargetActive(movie)) {
      focusLayer.close();
      this.#clearSelected();
      return;
    }

    this.#setSelected(movie);
    const movieMeta = this.#getMovieMeta(movie.getAttribute("id"));
    const imagePolicy = this.#getMovieImagePolicy(movieMeta);
    const payload = await this.#buildMoviePayload(movie);

    await focusLayer.open(movie, {
      mode: "flip",
      scope: "page",
      payload,
      imagePolicy,
      payloadPlacement: "right",
      inset: 24,
      closeOnScroll: true,
      onClose: () => {
        this.#clearSelected();
      },
    });
  }

  render() {
    this.innerHTML = this.movies
      .slice(0, this.limit)
      .reverse()
      .map((movie) => {
        return `<rogie-movie 
        title="${movie.title}" 
        id="${movie.tmdb.id}"
        link="${movie.link}"
        ${movie.rating ? `rating="${movie.rating}"` : ""} 
        image="${movie.thumbnail}"></rogie-movie>`;
      })
      .join("");
    let domMovies = this.querySelectorAll("rogie-movie");
    let initMovies = () => {
      domMovies.forEach((movie, index) => {
        movie.style.setProperty("--scale", (index + 1) / domMovies.length);
      });
    };
    initMovies();
    Utils.hoverFx(
      this,
      (movieList, data) => {
        if (focusLayer.isOpen) {
          return;
        }
        domMovies.forEach((movie) => {
          let rect = movie.getBoundingClientRect();
          let xCenter = rect.left + rect.width / 2;
          let distFromXCenter = Math.abs(data.mouseX - xCenter);
          let scale = 1 - distFromXCenter / data.rect.width;
          movie.style.setProperty("--scale", scale);

          const posX = data.mouseX - rect.x;
          const posY = data.mouseY - rect.y;
          const ratioX = posX / rect.width;
          const ratioY = posY / rect.height;
          movie.style.setProperty("--ratio-x", ratioX);
          movie.style.setProperty("--ratio-y", ratioY);
        });
      },
      initMovies,
    );
    this.querySelectorAll("rogie-movie").forEach((movie) => {
      const movieMeta = this.#getMovieMeta(movie.getAttribute("id"));
      const imagePolicy = this.#getMovieImagePolicy(movieMeta);
      movie.addEventListener("mouseenter", () => {
        focusLayer.prefetch(movie, imagePolicy);
      });
      movie.addEventListener(
        "touchstart",
        () => {
          focusLayer.prefetch(movie, imagePolicy);
        },
        { passive: true },
      );
      movie.addEventListener("click", async () => {
        this.#focusMovie(movie);
      });
    });
  }
}

customElements.define("rogie-movie-list", MovieList);

class Music extends HTMLElement {
  constructor() {
    super();
    this.track = null;
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
      () => {
        this.playing = false;
        this.setAttribute("playing", "false");
      },
    );
    this.player.setVolume(0.5);
    this.playing = false;
    this.setAttribute("playing", "false");
    this.render();
  }
  //a web component that has figure, an image, an a movie title and a rating
  render() {
    this.innerHTML = `
      <figure class="music-track">
        <div class="media media--music">
          <img src="${this.image}" alt="${this.title}">
        </div>
        <figcaption>
          <a href="${this.link}" target="_blank"><h3>${this.title}</h3></a>
          <p>${this.artist}</p>
          
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
    const proxyUrl = "https://cors.memer.workers.dev/?";
    const targetUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(
      term,
    )}&media=music&entity=song&limit=8`;
    let f = await fetch(proxyUrl + encodeURIComponent(targetUrl), {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; WebApp/1.0)",
        "X-Requested-With": "XMLHttpRequest",
      },
    });
    let data = await f.json();
    if (data.results && data.results.length > 0) {
      const title = (this.title || "").toLowerCase();
      const artist = (this.artist || "").toLowerCase();
      this.track =
        data.results.find(
          (r) =>
            r.trackName?.toLowerCase().includes(title) &&
            r.artistName?.toLowerCase().includes(artist.split(" ")[0] || artist),
        ) || data.results[0];
      this.setAttribute("file", this.track.previewUrl);
    } else {
      console.warn(`No music found for: ${term}`);
      this.track = null;
    }
  }

  //emit an event to the parent when audio hits the end of the track
  onEnded() {
    this.playing = false;
    this.player.pause();
    this.setAttribute("playing", "false");
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

  async playTrack() {
    if (!this.track) {
      await this.fetchMusic();
    }
    if (!this.track) {
      // No track available, show error message on iOS
      if (this.isIOS) {
        this.showError("Track not available");
      }
      return;
    }

    try {
      if (
        this.player.currentUrl !== this.track.previewUrl ||
        !this.player.isPlaying
      ) {
        await this.player.play(this.track.previewUrl);
        this.playing = true;
        this.hideError();
      } else {
        this.player.pause();
        this.playing = false;
      }
    } catch (error) {
      console.warn("Track playback failed:", error);
      if (this.isIOS) {
        this.showError("Tap to retry");
      }
      this.playing = false;
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
    // Initialize audio on iOS with user gesture
    if (this.isIOS) {
      this.player.initializeAudio();
    }

    await this.playTrack();
    if (this.playing) {
      this.dispatchEvent(new CustomEvent("playing"));
      this.classList.add("playing");
    } else {
      this.dispatchEvent(new CustomEvent("paused"));
      this.classList.remove("playing");
    }
  }
  //set the attributes to observe playing
  static get observedAttributes() {
    return ["playing", "current"];
  }
  attributeChangedCallback(name, oldValue, newValue) {
    if (name === "playing") {
      if (newValue === "true") {
        this.playing = true;
        this.playTrack();
      } else {
        this.playing = false;
        this.player.pause();
      }

      // Update button text
      const button = this.querySelector("fig-button.play");
      if (button) {
        button.textContent = this.playing ? "Pause" : "Play";
      }
    } else if (name === "current") {
      // Handle current track indication if needed
      // This attribute is used for styling the current track
    }
  }
}

customElements.define("rogie-music", Music);

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

    const cacheKey = "playlist-favorites-v5-expanded";
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
      const proxyUrl = "https://cors.memer.workers.dev/?";
      const targetUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(
        `${title} ${artist}`,
      )}&media=music&entity=song&limit=5`;
      const response = await fetch(proxyUrl + encodeURIComponent(targetUrl));
      const data = await response.json();
      const match =
        data.results?.find(
          (r) =>
            r.trackName?.toLowerCase().includes(title.toLowerCase()) &&
            r.artistName?.toLowerCase().includes(artist.toLowerCase().split(" ")[0]),
        ) || data.results?.[0];
      return (
        match?.artworkUrl100?.replace("100x100bb", "600x600bb") || ""
      );
    } catch (error) {
      console.warn("Artwork fetch failed:", error);
      return "";
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
        return `<rogie-music 
        image="${track.imageSrc}" 
        title="${track.name}"
        current="${index === this.currentTrack}"
        artist="${track.artistName}"
        delay="${this.delay}"
        link="${track.url}"></rogie-music>`;
      })
      .join("")}`;
    this.querySelectorAll("rogie-music").forEach((musicElement) => {
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
    this.querySelectorAll("rogie-music").forEach((musicElement, index) => {
      musicElement.addEventListener("ended", () => {
        // Auto-advance to next track when current track ends
        if (index === this.currentTrack) {
          const renderedTracks = this.querySelectorAll("rogie-music");
          this.currentTrack++;
          if (this.currentTrack >= renderedTracks.length) {
            this.currentTrack = 0;
          }
          let previous = this.querySelector("rogie-music[current='true']");
          previous.setAttribute("current", "false");
          let current = renderedTracks[this.currentTrack];
          current.setAttribute("current", "true");
          this.style.setProperty("--percent", 0);

          previous.player.pause();
          current.play();
        }
      });
    });

    this.querySelector("fig-button.next").addEventListener("click", () => {
      const renderedTracks = this.querySelectorAll("rogie-music");
      this.currentTrack++;
      if (this.currentTrack >= renderedTracks.length) {
        this.currentTrack = 0;
      }
      let previous = this.querySelector("rogie-music[current='true']");
      previous.setAttribute("current", "false");
      let current = renderedTracks[this.currentTrack];
      current.setAttribute("current", "true");

      if (previous?.playing) {
        previous.player.pause();
        current.play();
      }
    });
    this.querySelector("input.turntable-needle").addEventListener(
      "click",
      () => {
        //play the current track
        let current = this.querySelector("rogie-music[current='true']");
        current.play();
      },
    );

    this.querySelector("fig-switch").addEventListener("change", (e) => {
      const switchEl = e.currentTarget;
      this.playbackRate = switchEl.checked ? 45 : 33;
      this.style.setProperty("--playback-rate", this.playbackRate);
      this.querySelectorAll("rogie-music").forEach((musicElement) => {
        musicElement.player.setPlaybackRate(this.playbackRate / 33);
      });
    });
  }
}

customElements.define("peters-music-list", MusicList);

//rogie-footer
class Footer extends HTMLElement {
  constructor() {
    super();
    this.year = new Date().getFullYear();
  }
  connectedCallback() {
    this.render();
  }
  render() {
    this.innerHTML = `
    <footer>
        <fig-tooltip text="Rogie King"><a href="/"><img class="signature" src="/assets/signature.svg" alt="Rogie King"></a></fig-tooltip>
        <ul>
            <a href="https://www.figma.com/@rogie">
              <fig-tooltip text="Figma">
                <svg width="12" height="16" viewBox="0 0 12 16" fill="none" xmlns="http://www.w3.org/2000/svg">
<path fill-rule="evenodd" clip-rule="evenodd" d="M0.500001 3C0.500001 4.043 1.033 4.963 1.841 5.5C1.42858 5.77373 1.0903 6.14527 0.856316 6.58147C0.622335 7.01768 0.499925 7.505 0.500001 8C0.500001 9.043 1.033 9.963 1.841 10.5C1.40886 10.7868 1.05846 11.1808 0.824008 11.6434C0.589551 12.1061 0.479046 12.6216 0.503276 13.1397C0.527506 13.6578 0.685644 14.1608 0.962256 14.5995C1.23887 15.0382 1.6245 15.3978 2.08153 15.643C2.53855 15.8882 3.05134 16.0108 3.56987 15.9987C4.08839 15.9867 4.59492 15.8403 5.04003 15.5741C5.48514 15.3078 5.85361 14.9307 6.10949 14.4796C6.36538 14.0284 6.49992 13.5187 6.5 13V10.236C6.80725 10.5104 7.16772 10.7186 7.55894 10.8476C7.95016 10.9765 8.36376 11.0236 8.77395 10.9857C9.18415 10.9479 9.58215 10.826 9.94317 10.6276C10.3042 10.4292 10.6205 10.1585 10.8723 9.83256C11.1242 9.50658 11.3062 9.13222 11.407 8.73282C11.5079 8.33342 11.5254 7.91752 11.4585 7.51106C11.3915 7.10459 11.2416 6.71626 11.0181 6.37027C10.7945 6.02428 10.5021 5.72803 10.159 5.5C10.6961 5.14372 11.1042 4.62394 11.3228 4.01763C11.5415 3.41132 11.559 2.75071 11.3729 2.13365C11.1867 1.51658 10.8068 0.975864 10.2894 0.591573C9.77197 0.207283 9.14453 -0.000147673 8.5 7.88777e-08H3.5C2.70435 7.88777e-08 1.94129 0.316071 1.37868 0.87868C0.816071 1.44129 0.500001 2.20435 0.500001 3ZM8.5 5C9.03043 5 9.53914 4.78929 9.91421 4.41421C10.2893 4.03914 10.5 3.53043 10.5 3C10.5 2.46957 10.2893 1.96086 9.91421 1.58579C9.53914 1.21071 9.03043 1 8.5 1H6.5V5H8.5ZM6.5 8C6.5 8.53043 6.71071 9.03914 7.08579 9.41421C7.46086 9.78929 7.96957 10 8.5 10C9.03043 10 9.53914 9.78929 9.91421 9.41421C10.2893 9.03914 10.5 8.53043 10.5 8C10.5 7.46957 10.2893 6.96086 9.91421 6.58579C9.53914 6.21071 9.03043 6 8.5 6C7.96957 6 7.46086 6.21071 7.08579 6.58579C6.71071 6.96086 6.5 7.46957 6.5 8ZM5.5 10H3.5C2.96957 10 2.46086 9.78929 2.08579 9.41421C1.71071 9.03914 1.5 8.53043 1.5 8C1.5 7.46957 1.71071 6.96086 2.08579 6.58579C2.46086 6.21071 2.96957 6 3.5 6H5.5V10ZM3.5 11H5.5V13C5.5 13.3956 5.3827 13.7822 5.16294 14.1111C4.94318 14.44 4.63082 14.6964 4.26537 14.8478C3.89991 14.9991 3.49778 15.0387 3.10982 14.9616C2.72186 14.8844 2.36549 14.6939 2.08579 14.4142C1.80608 14.1345 1.6156 13.7781 1.53843 13.3902C1.46126 13.0022 1.50087 12.6001 1.65224 12.2346C1.80362 11.8692 2.05996 11.5568 2.38886 11.3371C2.71776 11.1173 3.10444 11 3.5 11ZM5.5 5H3.5C2.96957 5 2.46086 4.78929 2.08579 4.41421C1.71071 4.03914 1.5 3.53043 1.5 3C1.5 2.46957 1.71071 1.96086 2.08579 1.58579C2.46086 1.21071 2.96957 1 3.5 1H5.5V5Z" fill="black"/>
</svg>

              </fig-tooltip>
            </a>
            <a href="https://www.x.com/rogie">
              <fig-tooltip text="X.com">
                <svg width="22" height="20" viewBox="0 0 22 20" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M17.2439 0.25H20.5519L13.3249 8.51L21.8269 19.75H15.1699L9.95591 12.933L3.98991 19.75H0.679906L8.40991 10.915L0.253906 0.25H7.07991L11.7929 6.481L17.2439 0.25ZM16.0829 17.77H17.9159L6.08391 2.126H4.11691L16.0829 17.77Z" fill="black"/>
</svg>

              </fig-tooltip>
            </a>
            <a href="https://www.instagram.com/rogie">
            <fig-tooltip text="Instagram">
              <svg width="744" height="744" viewBox="0 0 744 744" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M372.202 0.402344C271.226 0.402344 258.553 0.84341 218.894 2.647C179.312 4.45815 152.294 10.7201 128.653 19.9081C104.199 29.3974 83.455 42.0913 62.789 62.7498C42.1074 83.4012 29.4036 104.129 19.8762 128.557C10.6583 152.189 4.38392 179.194 2.60263 218.731C0.828897 258.361 0.364014 271.032 0.364014 371.934C0.364014 472.836 0.813397 485.46 2.61018 525.09C4.43078 564.642 10.6972 591.64 19.8838 615.264C29.3881 639.7 42.0915 660.428 62.7655 681.079C83.4244 701.745 104.168 714.47 128.606 723.96C152.262 733.147 179.289 739.409 218.863 741.221C258.522 743.024 271.187 743.465 372.156 743.465C473.14 743.465 485.774 743.024 525.433 741.22C565.016 739.409 592.065 733.147 615.721 723.959C640.167 714.47 660.88 701.745 681.539 681.079C702.22 660.428 714.924 639.7 724.451 615.272C733.591 591.64 739.866 564.635 741.725 525.098C743.506 485.468 743.971 472.835 743.971 371.934C743.971 271.032 743.506 258.369 741.725 218.739C739.866 179.186 733.591 152.189 724.451 128.565C714.924 104.129 702.22 83.4008 681.539 62.7498C660.857 42.0834 640.175 29.3894 615.698 19.9077C591.995 10.7201 564.961 4.45815 525.379 2.647C485.72 0.84341 473.094 0.402344 372.086 0.402344H372.202ZM338.848 67.3555C348.748 67.34 359.793 67.3555 372.202 67.3555C471.475 67.3555 483.241 67.7116 522.443 69.4917C558.695 71.1483 578.369 77.2008 591.476 82.2862C608.827 89.0202 621.197 97.0702 634.203 110.074C647.216 123.078 655.272 135.462 662.026 152.8C667.116 165.881 673.18 185.541 674.83 221.766C676.612 260.931 676.999 272.696 676.999 371.849C676.999 471.001 676.612 482.767 674.83 521.932C673.173 558.156 667.116 577.816 662.026 590.897C655.287 608.236 647.216 620.581 634.203 633.577C621.19 646.581 608.834 654.63 591.476 661.364C578.385 666.473 558.695 672.51 522.443 674.167C483.249 675.947 471.475 676.334 372.202 676.334C272.922 676.334 261.156 675.947 221.961 674.167C185.71 672.495 166.035 666.442 152.921 661.357C135.57 654.623 123.176 646.573 110.163 633.569C97.1502 620.566 89.0945 608.212 82.3397 590.866C77.2506 577.785 71.1856 558.125 69.5358 521.901C67.7541 482.735 67.3977 470.97 67.3977 371.756C67.3977 272.542 67.7541 260.838 69.5358 221.673C71.1935 185.448 77.2506 165.788 82.3397 152.692C89.0786 135.353 97.1502 122.969 110.163 109.966C123.176 96.9617 135.57 88.9121 152.921 82.1626C166.028 77.0538 185.71 71.0168 221.961 69.3523C256.26 67.8042 269.553 67.3401 338.848 67.2622L338.848 67.3555ZM570.67 129.045C546.038 129.045 526.053 148.992 526.053 173.613C526.053 198.227 546.038 218.197 570.67 218.197C595.302 218.197 615.287 198.227 615.287 173.613C615.287 148.999 595.302 129.03 570.67 129.03L570.67 129.045ZM372.202 181.137C266.756 181.137 181.264 266.566 181.264 371.934C181.264 477.302 266.756 562.692 372.202 562.692C477.648 562.692 563.11 477.302 563.11 371.934C563.11 266.566 477.641 181.137 372.195 181.137H372.202ZM372.202 248.09C440.646 248.09 496.138 303.533 496.138 371.934C496.138 440.327 440.646 495.778 372.202 495.778C303.751 495.778 248.267 440.327 248.267 371.934C248.267 303.533 303.751 248.09 372.202 248.09Z" fill="black"/>
              </svg>
              </fig-tooltip>
            </a>
            <a href="https://www.npmjs.com/~rogieking">
            <fig-tooltip text="NPM">
              <svg width="125" height="41" viewBox="0 0 125 41" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M38.4615 40.9355H54.4872V32.9355H70.5128V0.935547H38.4615V40.9355ZM54.4872 8.93555H62.5V24.9355H54.4872V8.93555ZM76.9231 0.935547V32.9355H92.9487V8.93555H100.962V32.9355H108.974V8.93555H116.987V32.9355H125V0.935547H76.9231ZM0 32.9355H16.0256V8.93555H24.0385V32.9355H32.0513V0.935547H0V32.9355Z" fill="#231F20"/>
</svg>

              </fig-tooltip>
            </a>
            <a href="https://www.github.com/rogieking">
            <fig-tooltip text="GitHub">
              <svg width="60" height="58" viewBox="0 0 60 58" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M29.9998 0.0292969C13.7945 0.0292969 0.666504 13.1573 0.666504 29.3626C0.666504 42.3413 9.06384 53.3066 20.7225 57.192C22.1892 57.448 22.7385 56.5706 22.7385 55.8C22.7385 55.1013 22.7038 52.792 22.7038 50.336C15.3332 51.6933 13.4265 48.5386 12.8398 46.8906C12.5092 46.0453 11.0798 43.4426 9.8345 42.7466C8.80784 42.1946 7.3385 40.84 9.79717 40.8026C12.1065 40.7653 13.7572 42.928 14.3065 43.8106C16.9465 48.2453 21.1625 47 22.8505 46.2293C23.1065 44.3226 23.8772 43.04 24.7198 42.3066C18.1918 41.5733 11.3732 39.0426 11.3732 27.8213C11.3732 24.632 12.5092 21.992 14.3812 19.9386C14.0852 19.2053 13.0585 16.2 14.6745 12.1653C14.6745 12.1653 17.1305 11.3973 22.7385 15.1733C25.1264 14.5108 27.5937 14.1779 30.0718 14.184C32.5678 14.184 35.0612 14.512 37.4052 15.1733C43.0158 11.36 45.4718 12.1653 45.4718 12.1653C47.0852 16.2 46.0612 19.2053 45.7678 19.9386C47.6372 21.992 48.7732 24.5973 48.7732 27.8213C48.7732 39.08 41.9172 41.5733 35.3892 42.3066C36.4532 43.224 37.3705 44.984 37.3705 47.7333C37.3705 51.656 37.3332 54.8106 37.3332 55.8C37.3332 56.5706 37.8825 57.4853 39.3492 57.192C50.9358 53.3066 59.3332 42.3066 59.3332 29.3626C59.3332 13.1573 46.2078 0.0292969 29.9998 0.0292969Z" fill="black"/>
</svg>

            </a>
        </ul>
    </footer>
`;
  }
}

customElements.define("rogie-footer", Footer);

//signup form
class SignupForm extends HTMLElement {
  constructor() {
    super();
    this.loading = false;
    this.valid = false;
  }

  connectedCallback() {
    this.render();
    this.form = this.querySelector("form");
    this.submitButton = this.querySelector('fig-button[type="submit"]');
    this.loadingSpinner = this.querySelector("fig-spinner");
    this.submitGo = this.submitButton.querySelector("span");
    this.message = this.querySelector(".message");
    this.loadingSpinner.style.display = "none";

    this.form.querySelectorAll("input[type='email']").forEach((input) => {
      input.addEventListener("input", () => this.validateForm());
    });
    this.form.addEventListener("submit", (e) => this.handleSubmit(e));
  }

  validateForm() {
    this.valid = this.form.querySelectorAll(":invalid").length === 0;
    this.submitButton.setAttribute("disabled", !this.valid);
  }

  async handleSubmit(e) {
    e.preventDefault();

    if (!this.valid || this.loading) return;

    this.loading = true;
    this.submitButton.disabled = true;
    this.loadingSpinner.style.display = "block";
    this.submitGo.style.display = "none";

    const data = new FormData(this.form);
    let sendBody = "";
    for (let [k, v] of data.entries()) {
      data[k] = v;
      sendBody += `&${k}=${encodeURIComponent(v)}`;
    }

    let response = await fetch(
      "https://app.loops.so/api/newsletter-form/clskpr4ah003ab8v9rnzzrjlg",
      {
        method: "POST",
        body: sendBody,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );
    let responseJson = await response.json();
    if (responseJson.success === true) {
      this.form.reset();
      this.message.innerHTML = "Thanks for signing up!";
    } else {
      this.message.innerHTML = responseJson.message;
    }
    this.loading = false;
    this.submitButton.disabled = false;
    this.loadingSpinner.style.display = "none";
    this.submitGo.style.display = "block";
  }

  render() {
    this.innerHTML = `
      <form class="mailing-list"  method="POST">
      <input type="hidden"
                    name="userGroup"
                    value="nt2" />
            <input type="hidden"
                    name="source"
                    value="Rog.ie" />
        <h2 class="message">Get emails about the plugin</h2>
        
        <fig-field>
            <fig-input-text name="firstName" placeholder="Name" required></fig-input-text>
                <div class="input-combo">
                    <input type="email"
                            name="email"
                            placeholder="the@thing.com"
                            class="input input--small input--full"
                            required />
                    <fig-button type="submit" icon="true" disabled>
                        <span>-></span>
                        <fig-spinner />
                    </fig-button>
                </div>
            </fig-field>
        </form>
    `;
  }
}

customElements.define("rogie-signup-form", SignupForm);

class Media extends HTMLElement {
  constructor() {
    super();
  }

  connectedCallback() {
    this.render();
  }

  render() {
    if (this.querySelector(":scope > .media")) return;

    const media = document.createElement("div");
    media.className = "media";

    while (this.firstChild) {
      media.append(this.firstChild);
    }

    this.append(media);
  }
}

customElements.define("rk-media", Media);

class Greeting extends HTMLElement {
  constructor() {
    super();
    this.duration = 300;
    this.greetings = [
      "Ayo",
      "Yo",
      "Sup",
      "Howdy",
      "G’day",
      "Hiya",
      "Heyyy",
      "Wassup",
      "Hey hey",
      "Top o’ the morning",
      "Well hello there",
      "Sup fam",
      "Ahoy",
      "Namaste",
      "Yooooo",
      "G’day",
      "Hallo",
      "Hey there",
      "Ello guv’na",
    ];
  }

  connectedCallback() {
    this.render();
    this.greeting = this.querySelector(".greeting");
    this.greeting.addEventListener("click", () => {
      this.randomize();
    });
    this.randomize();
  }
  randomize() {
    this.greeting.innerHTML = this.#getRandomGreeting()
      .split("")
      .map((letter) => `<span>${letter}</span>`)
      .join("")
      .replaceAll(" ", "&nbsp;");
    this.animate();
  }
  animate() {
    let letters = this.greeting.querySelectorAll("span");
    let delay = (this.duration / letters.length) * 0.75;
    letters.forEach((span, index) => {
      span.classList.add("wavy");
      span.style.animationDuration = `${this.duration}ms`;
      span.style.animationDelay = `${index * delay}ms`;
    });
  }

  #getRandomGreeting() {
    return this.greetings[Math.floor(Math.random() * this.greetings.length)];
  }

  render() {
    this.innerHTML = `<span class="greeting">${this.innerHTML}</span>`;
  }
}

customElements.define("rk-greeting", Greeting);

class ImageZoomer extends HTMLImageElement {
  constructor() {
    super();
  }

  connectedCallback() {
    this.style.cursor = "zoom-in";
    this.clone = null;
    this.addEventListener("click", this.#handleClick);
  }
  #positionCloneStart() {
    let imgRect = this.getBoundingClientRect();
    Object.assign(this.clone.style, {
      position: "fixed",
      willChange: "transform",
      objectFit: "contain",
      top: `${imgRect.top}px`,
      left: `${imgRect.left}px`,
      width: `${imgRect.width}px`,
      height: `${imgRect.height}px`,
    });
  }
  #positionCloneEnd() {
    Object.assign(this.clone.style, {
      inset: 0,
      width: "100vw",
      height: "100vh",
      objectFit: "contain",
      zIndex: 1000,
      cursor: "zoom-out",
    });
  }

  open() {
    this.clone = document.createElement(this.nodeName);
    for (let attr of this.attributes) {
      if (attr.name !== "is") {
        this.clone.setAttribute(attr.name, attr.value);
      }
    }
    this.clone.classList.add("img-zoomer");
    this.#positionCloneStart();
    this.clone.addEventListener("click", this.close.bind(this));
    document.body.appendChild(this.clone);
    document.addEventListener("scroll", this.close.bind(this));

    setTimeout(() => {
      this.#positionCloneEnd();
      this.clone.classList.add("zoomed");
    }, 1);
  }
  close() {
    if (this.clone) {
      this.clone.classList.remove("zoomed");
      this.clone.style.pointerEvents = "none";
      this.style.pointerEvents = "none";
      this.#positionCloneStart();
      let duration = getComputedStyle(this.clone).transitionDuration;
      let durationMs = duration.includes("s")
        ? parseFloat(duration) * 1000
        : parseFloat(duration);
      setTimeout(() => {
        this.clone.remove();
        this.style.pointerEvents = "auto";
      }, durationMs);
    }
    document.documentElement.classList.remove("image-zoomed");
    document.removeEventListener("keydown", this.#onKeyDown);
    document.removeEventListener("scroll", this.close.bind(this));
  }

  #handleClick() {
    this.open();
    document.addEventListener("keydown", this.#onKeyDown.bind(this));
  }

  #onKeyDown(e) {
    if (e.key === "Escape") {
      this.close();
    }
  }
}

class VideoZoomer extends ImageZoomer {
  constructor() {
    super();
  }
}

customElements.define("img-zoomer", ImageZoomer, { extends: "img" });
customElements.define("video-zoomer", VideoZoomer, { extends: "video" });

class HorrorText extends HTMLElement {
  constructor() {
    super();
  }
  connectedCallback() {
    this.innerHTML = `<a class="horror" href="https://letterboxd.com/rogieking/list/horror-3/"><b>H</b><b>o</b><b>r</b><b>r</b><b>o</b><b>r</b></a>
    <svg class="svgfx" xmlns="http://www.w3.org/2000/svg">
      <defs class="svgfx">
        <filter id="roughen-0" name="roughen" x="-20%" y="-20%" width="140%" height="140%" filterUnits="objectBoundingBox" color-interpolation-filters="sRGB">
        <feTurbulence type="fractalNoise" baseFrequency="0.2" seed="0" numOctaves="3" result="turbulence"/>
        <feDisplacementMap in="SourceGraphic" in2="turbulence" result="displaced" scale="8" xChannelSelector="R" yChannelSelector="G"/>
      </filter>
      </defs>
    </svg>`;
    this.filter = this.querySelector("filter");
    this.turbulence = this.filter.querySelector("feTurbulence");
    this.displacement = this.filter.querySelector("feDisplacementMap");
    this.addEventListener("mouseover", () => {
      this.turbulence.setAttribute(
        "baseFrequency",
        `${Math.random() * 0.05} ${Math.random() * 0.05}`,
      );
      this.displacement.setAttribute("scale", Math.random() * 10);
    });
  }
}

customElements.define("horror-text", HorrorText);

class Chat extends HTMLElement {
  constructor() {
    super();
  }
}

customElements.define("rk-chat", Chat);

class ChatMessage extends HTMLElement {
  constructor() {
    super();
  }
  connectedCallback() {
    this.render();
  }
  render() {
    this.innerHTML = `
     <fig-avatar size="large" name="Rogie King"></fig-avatar>
      <div class="rk-chat-message-content">
        <div>${this.innerHTML}</div>
      </div>
    `;
  }
}

customElements.define("rk-chat-message", ChatMessage);

var _gauges = _gauges || [];
(function () {
  var t = document.createElement("script");
  t.type = "text/javascript";
  t.async = true;
  t.id = "gauges-tracker";
  t.setAttribute("data-site-id", "4d596a1f6bb4ba2c48000001");
  t.setAttribute("data-track-path", "https://track.gaug.es/track.gif");
  t.src = "https://d2fuc4clr7gvcn.cloudfront.net/track.js";
  var s = document.getElementsByTagName("script")[0];
  s.parentNode.insertBefore(t, s);
})();
