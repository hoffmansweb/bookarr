<div align="center">
  <img src="logo.png" alt="Bookarr Logo" width="200"/>

  <h1>Bookarr</h1>
  
  <p><strong>The ultimate self-hosted Ebook and Audiobook Library Manager.</strong></p>

  <p>
    <a href="https://github.com/hoffmansweb/bookarr/releases"><img src="https://img.shields.io/github/v/release/hoffmansweb/bookarr?style=flat-square" alt="Latest Release"></a>
    <a href="https://hub.docker.com/r/hoffmansweb/bookarr"><img src="https://img.shields.io/docker/pulls/hoffmansweb/bookarr?style=flat-square" alt="Docker Pulls"></a>
    <a href="https://github.com/hoffmansweb/bookarr/blob/master/LICENSE"><img src="https://img.shields.io/github/license/hoffmansweb/bookarr?style=flat-square" alt="License"></a>
  </p>
</div>

---

**Bookarr** is an automated Ebook and Audiobook manager, designed specifically for self-hosters and readers who want to own their libraries. Built with a sleek, responsive React interface and a powerful Node.js backend, Bookarr handles everything from tracking author releases to synthesizing audiobooks on the fly!

## ✨ Features

- 📚 **Automated Discovery** - Search across Google Books, Open Library, and Goodreads.
- 👤 **Author Monitoring** - Track your favorite authors and get notified the minute a new book drops.
- 🎧 **Built-in AI Narrator** - No audiobook available? Bookarr uses a lightweight local Kokoro TTS model to automatically synthesize hyper-realistic audiobooks from EPUB files in the background!
- 📖 **Web Reader & Player** - Read your Ebooks and listen to Audiobooks directly in your browser with the built-in reader and player.
- 📡 **Cross-Sync Progress** - Seamlessly switch between reading an Ebook and listening to the Audiobook. Bookarr syncs your progress automatically.
- 🔗 **Indexer & Downloader Support** - Automatically grab books using Prowlarr/Jackett, SABnzbd, qBittorrent, and more.
- 📊 **Detailed Analytics** - Track your reading habits, lifetime pages read, and audio hours listened.
- 📱 **PWA Ready** - Install Bookarr directly to your phone's home screen for a native app experience.

---

## 🐳 Installation (Docker)

The absolute best way to run Bookarr is via Docker. We provide pre-built, optimized images on the GitHub Container Registry.

### `docker-compose.yml`

Create a `docker-compose.yml` file and run `docker-compose up -d`:

```yaml
version: '3.8'

services:
  bookarr:
    image: ghcr.io/hoffmansweb/bookarr:latest
    container_name: bookarr
    restart: unless-stopped
    ports:
      - 5000:5000
    environment:
      - PUID=1000
      - PGID=1000
      - TZ=America/New_York
    volumes:
      # Bookarr Configuration and Database
      - /path/to/appdata/config:/app/data
      
      # Downloads folder (Where SABnzbd/qBittorrent drop files)
      - /path/to/downloads:/downloads
      
      # Final Library destination
      - /path/to/library:/library
```

> **Note on Volumes:** We highly recommend using hardlink-compatible paths (e.g., keeping `/downloads` and `/library` on the same physical drive) to prevent Bookarr from having to physically copy gigabytes of audiobooks!

---

## 🖥️ Manual Installation (Windows / Linux)

If you prefer to run Bookarr bare-metal:

1. Install **Node.js 22+**, **Python 3**, and **FFmpeg**.
2. Clone this repository.
3. Run `npm run install` to install dependencies for both the frontend and backend.
4. Run `npm run build` in the `frontend/` directory.
5. Start the backend with `node backend/src/server.js`.

Bookarr will be accessible at `http://localhost:5000`.

---

## 🤝 Getting Help & Support

- **Found a bug?** Open an [Issue](https://github.com/hoffmansweb/bookarr/issues) on GitHub.
- **Have a feature request?** Start a discussion in the [Discussions](https://github.com/hoffmansweb/bookarr/discussions) tab.
- **Discord:** Join our community on Discord (Coming Soon!) to chat about setups and feature ideas.

## 🛠️ Contributing

We welcome pull requests! Bookarr is built entirely in Javascript (React + Node.js). 

1. Fork the project.
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request!

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.
