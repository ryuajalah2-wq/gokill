const API_BASE = 'https://www.sankavollerei.com/anime';

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name) || '';
}

function buildHeaders() {
  return new Headers({
    Accept: 'application/json',
  });
}

function resolveSearchResults(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.data)) return data.data;
  if (Array.isArray(data.data?.animeList)) return data.data.animeList;
  if (Array.isArray(data.data?.ongoing?.animeList)) return data.data.ongoing.animeList;
  if (Array.isArray(data.data?.completed?.animeList)) return data.data.completed.animeList;
  if (Array.isArray(data.data?.recommendedAnimeList)) return data.data.recommendedAnimeList;
  if (Array.isArray(data.animeList)) return data.animeList;
  if (Array.isArray(data.ongoing?.animeList)) return data.ongoing.animeList;
  if (Array.isArray(data.completed?.animeList)) return data.completed.animeList;
  if (Array.isArray(data.list)) {
    return data.list.flatMap((group) => Array.isArray(group.animeList) ? group.animeList : []);
  }
  if (Array.isArray(data.data?.list)) {
    return data.data.list.flatMap((group) => Array.isArray(group.animeList) ? group.animeList : []);
  }
  return [];
}

function getTitle(item) {
  return item.title || item.name || item.title_english || item.title_japanese || 'Untitled Anime';
}

function getDescription(item) {
  if (!item) return 'Deskripsi tidak tersedia.';
  if (typeof item.synopsis === 'string') return item.synopsis;
  if (Array.isArray(item.synopsis?.paragraphs)) return item.synopsis.paragraphs.join(' ');
  return item.background || item.description || item.desc || item.detail || 'Deskripsi tidak tersedia.';
}

function getImage(item) {
  return item.poster || item.image_url || item.thumbnail || item.cover || item.thumb || null;
}

const pageState = {
  trending: 1,
  collection: 1,
  premium: 1,
};

function getLink(item) {
  if (item.animeId) return `anime.html?id=${encodeURIComponent(item.animeId)}`;
  if (item.href && item.href.startsWith('/anime/anime/')) {
    const slug = item.href.split('/').pop();
    return `anime.html?id=${encodeURIComponent(slug)}`;
  }
  return item.url || item.link || item.permalink || '#';
}

function normalizeSearchText(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshteinDistance(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  matrix[0] = Array.from({ length: a.length + 1 }, (_, j) => j);

  for (let i = 1; i <= b.length; i += 1) {
    for (let j = 1; j <= a.length; j += 1) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[b.length][a.length];
}

function isSimilarTitle(title, keyword) {
  const normalizedTitle = normalizeSearchText(title);
  const normalizedKeyword = normalizeSearchText(keyword);
  if (!normalizedTitle || !normalizedKeyword) return false;
  if (normalizedTitle.includes(normalizedKeyword)) return true;

  const keywordTerms = normalizedKeyword.split(' ').filter(Boolean);
  const titleWords = normalizedTitle.split(' ').filter(Boolean);

  const distanceThreshold = (term) => Math.max(1, Math.floor(term.length * 0.25));

  return keywordTerms.every((term) => {
    if (!term) return false;
    if (titleWords.some((word) => word.includes(term))) return true;
    if (titleWords.some((word) => word.startsWith(term))) return true;
    return titleWords.some((word) => levenshteinDistance(word, term) <= distanceThreshold(term));
  });
}

function filterSearchResults(results, keyword) {
  if (!keyword) return results;
  return results.filter((item) => {
    const title = getTitle(item);
    return isSimilarTitle(title, keyword);
  });
}

function createPaginationControls(containerId, page, onPrev, onNext) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = `
    <div class="pagination-controls">
      <button type="button" class="button secondary pagination-button" data-action="prev" ${page <= 1 ? 'disabled' : ''}>Sebelumnya</button>
      <span class="pagination-label">Halaman ${page}</span>
      <button type="button" class="button primary pagination-button" data-action="next">Selanjutnya</button>
    </div>
  `;

  const prevButton = container.querySelector('[data-action="prev"]');
  const nextButton = container.querySelector('[data-action="next"]');
  if (prevButton) prevButton.addEventListener('click', onPrev);
  if (nextButton) nextButton.addEventListener('click', onNext);
}

async function loadPaginatedGrid(pageKey, endpoint, containerId, paginationId) {
  try {
    const page = pageState[pageKey] || 1;
    const json = await fetchJson(`${endpoint}?page=${page}`);
    const results = resolveSearchResults(json.data);
    renderGrid(containerId, results);

    createPaginationControls(
      paginationId,
      page,
      () => {
        if (page > 1) {
          pageState[pageKey] = page - 1;
          loadPaginatedGrid(pageKey, endpoint, containerId, paginationId);
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      },
      () => {
        pageState[pageKey] = page + 1;
        loadPaginatedGrid(pageKey, endpoint, containerId, paginationId);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    );
  } catch (error) {
    console.error(error);
  }
}

function parseServerEntry(raw) {
  if (!raw) return null;
  if (typeof raw === 'object' && raw !== null) {
    return {
      title: raw.title || raw.server || 'Server',
      serverId: raw.serverId || raw.id || '',
      href: raw.href || raw.url || '',
    };
  }

  const content = String(raw).trim().replace(/^@\{/, '').replace(/\}$/, '');
  const entry = {};
  content.split(';').forEach((part) => {
    const [key, ...valueParts] = part.split('=');
    if (!key || !valueParts.length) return;
    entry[key.trim()] = valueParts.join('=').trim();
  });

  return {
    title: entry.title || entry.server || 'Server',
    serverId: entry.serverId || '',
    href: entry.href || '',
  };
}

function createAnimeCard(item) {
  const card = document.createElement('article');
  card.className = 'anime-card';

  const thumb = document.createElement('div');
  thumb.className = 'anime-thumb';
  const image = getImage(item);
  if (image) {
    const img = document.createElement('img');
    img.src = image;
    img.alt = getTitle(item);
    thumb.appendChild(img);
  } else {
    thumb.style.background = 'linear-gradient(135deg, rgba(231, 192, 121, 0.3), rgba(70, 60, 110, 0.72))';
  }

  const content = document.createElement('div');
  content.className = 'anime-content';

  const title = document.createElement('h3');
  title.textContent = getTitle(item);

  const description = document.createElement('p');
  description.textContent = getDescription(item);

  const actionLink = document.createElement('a');
  actionLink.href = getLink(item);
  actionLink.textContent = 'Lihat Detail';
  actionLink.className = 'view-all';
  actionLink.style.display = 'inline-block';
  actionLink.style.marginTop = '12px';

  content.appendChild(title);
  content.appendChild(description);
  content.appendChild(actionLink);

  card.appendChild(thumb);
  card.appendChild(content);
  return card;
}

function renderGrid(containerId, results) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  grid.innerHTML = '';

  if (!results.length) {
    grid.innerHTML = '<p class="search-status">Tidak ada data anime tersedia.</p>';
    return;
  }

  results.forEach(item => {
    grid.appendChild(createAnimeCard(item));
  });
}

async function fetchJson(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(),
  });

  if (!response.ok) {
    throw new Error(`API error ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

async function loadHomePage() {
  try {
    const json = await fetchJson(`${API_BASE}/home`);
    const results = resolveSearchResults(json.data);
    renderGrid('home-trending-grid', results.slice(0, 6));

    const heroSource = json.data?.ongoing?.animeList?.[0] || results[0];
    if (heroSource) {
      const heroImage = document.getElementById('home-hero-image');
      const heroTitle = document.getElementById('home-hero-title');
      const heroDesc = document.getElementById('home-hero-desc');
      if (heroImage) heroImage.style.backgroundImage = `linear-gradient(135deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02)), url('${getImage(heroSource)}')`;
      if (heroTitle) heroTitle.textContent = getTitle(heroSource);
      if (heroDesc) heroDesc.textContent = getDescription(heroSource);
    }
  } catch (error) {
    console.error(error);
  }
}

async function loadTrendingPage() {
  await loadPaginatedGrid('trending', `${API_BASE}/ongoing-anime`, 'trending-grid', 'trending-pagination');
}

async function loadCollectionPage() {
  await loadPaginatedGrid('collection', `${API_BASE}/complete-anime`, 'collection-grid', 'collection-pagination');
}

async function loadPremiumPage() {
  await loadPaginatedGrid('premium', `${API_BASE}/complete-anime`, 'premium-grid', 'premium-pagination');
}

async function loadAnimePage() {
  const id = getQueryParam('id').trim();
  const poster = document.getElementById('anime-poster');
  const title = document.getElementById('anime-title');
  const type = document.getElementById('anime-type');
  const score = document.getElementById('anime-score');
  const episodes = document.getElementById('anime-episodes');
  const synopsis = document.getElementById('anime-synopsis');
  const characters = document.getElementById('anime-characters');
  const watchButton = document.getElementById('watch-button');

  if (!id) {
    if (title) title.textContent = 'Anime tidak ditemukan.';
    if (synopsis) synopsis.textContent = 'ID anime tidak tersedia.';
    return;
  }

  try {
    const detailJson = await fetchJson(`${API_BASE}/anime/${encodeURIComponent(id)}`);
    const anime = detailJson.data;

    const posterImage = getImage(anime);
    const posterImg = document.getElementById('anime-poster-img');
    if (poster) {
      poster.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.08), rgba(0,0,0,0.4))';
      if (posterImage && posterImg) {
        posterImg.src = posterImage;
        posterImg.alt = getTitle(anime);
        posterImg.style.display = 'block';
      } else if (posterImg) {
        posterImg.style.display = 'none';
        poster.style.backgroundColor = '#1b1726';
      }
    }
    if (title) title.textContent = getTitle(anime);
    if (type) type.textContent = anime.type ? anime.type : anime.status || 'Anime Detail';
    if (score) score.textContent = anime.score ? `Skor: ${anime.score}` : 'Skor: -';
    if (episodes) episodes.textContent = anime.episodes ? `${anime.episodes} eps` : anime.status || 'Episode tidak tersedia';
    if (synopsis) synopsis.textContent = getDescription(anime);
    if (watchButton) watchButton.href = `watch.html?id=${encodeURIComponent(id)}`;

    if (characters) {
      const genres = Array.isArray(anime.genreList) ? anime.genreList : [];
      characters.innerHTML = '<h3>Genre</h3>' +
        `<div class="character-list">${genres.slice(0, 6).map(g => `<span>${g.title}</span>`).join('')}</div>`;
    }
  } catch (error) {
    console.error(error);
    if (title) title.textContent = 'Gagal memuat detail anime.';
    if (synopsis) synopsis.textContent = error.message;
  }
}

async function loadWatchPage() {
  const id = getQueryParam('id').trim();
  const watchTitle = document.getElementById('watch-anime-title');
  const watchType = document.getElementById('watch-anime-type');
  const watchPlayer = document.getElementById('watch-player');
  const watchCurrent = document.getElementById('watch-current-title');
  const watchDescription = document.getElementById('watch-current-desc');
  const episodeList = document.getElementById('episode-list');
  const serverList = document.getElementById('watch-server-list');

  if (!id) {
    if (watchPlayer) watchPlayer.innerHTML = '<p class="search-status">ID anime tidak tersedia.</p>';
    return;
  }

  const setPlayerLoading = (message = 'Memuat episode...') => {
    if (watchPlayer) {
      watchPlayer.innerHTML = `<div class="watch-video-loading"><p>${message}</p></div>`;
    }
  };

  const renderEmbedPlayer = (embedUrl) => {
    if (!watchPlayer) return;
    watchPlayer.innerHTML = `
      <div class="watch-video-screen">
        <iframe src="${embedUrl}" allowfullscreen sandbox="allow-scripts allow-same-origin allow-popups allow-top-navigation"></iframe>
      </div>
    `;
  };

  const renderStreamFallback = (url) => {
    if (!watchPlayer) return;
    watchPlayer.innerHTML = `
      <div class="watch-video-screen">
        <p>Tidak dapat menampilkan video secara langsung.</p>
        <a href="${url}" target="_blank" rel="noopener noreferrer">Buka video di tab baru</a>
      </div>
    `;
  };

  const loadEpisodeStream = async (episode) => {
    if (!episode || !episode.episodeId) {
      if (watchPlayer) watchPlayer.innerHTML = '<p class="search-status">Data episode tidak valid.</p>';
      return;
    }

    setPlayerLoading();
    if (serverList) serverList.innerHTML = '';

    try {
      const episodeJson = await fetchJson(`${API_BASE}/episode/${encodeURIComponent(episode.episodeId)}`);
      const episodeData = episodeJson.data;
      const serverQualities = Array.isArray(episodeData?.server?.qualities) ? episodeData.server.qualities : [];

      const servers = serverQualities.flatMap((qualityItem) => {
        const items = Array.isArray(qualityItem.serverList) ? qualityItem.serverList : [];
        return items
          .map(parseServerEntry)
          .filter(Boolean)
          .map((entry) => ({ ...entry, quality: qualityItem.title || '' }));
      });

      const getServerEndpoint = (entry) => {
        if (!entry) return null;
        if (entry.href && entry.href.startsWith('http')) return entry.href;
        if (entry.href) {
          const normalized = entry.href.startsWith('/anime') ? entry.href.replace(/^\/anime/, '') : entry.href;
          return `${API_BASE}${normalized}`;
        }
        if (entry.serverId) return `${API_BASE}/server/${encodeURIComponent(entry.serverId)}`;
        return null;
      };

      const loadServerUrl = async (entry) => {
        const endpoint = getServerEndpoint(entry);
        if (!endpoint) return null;
        const serverJson = await fetchJson(endpoint);
        return serverJson?.data?.url || null;
      };

      if (servers.length && serverList) {
        serverList.innerHTML = servers.map((server, index) => `
          <button type="button" class="episode-button server-button" data-server="${index}">
            ${server.quality ? `${server.quality} • ` : ''}${server.title || 'Server'}
          </button>
        `).join('');

        const buttons = serverList.querySelectorAll('button');
        const selectServer = async (selectedIndex) => {
          const serverEntry = servers[selectedIndex];
          if (!serverEntry) return;
          buttons.forEach((button, idx) => button.classList.toggle('active', idx === selectedIndex));
          const serverUrl = await loadServerUrl(serverEntry);
          if (serverUrl) {
            renderEmbedPlayer(serverUrl);
          } else if (episodeData.defaultStreamingUrl) {
            renderStreamFallback(episodeData.defaultStreamingUrl);
          } else {
            watchPlayer.innerHTML = '<p class="search-status">Video tidak tersedia untuk episode ini.</p>';
          }
        };

        buttons.forEach((button) => {
          button.addEventListener('click', () => selectServer(Number(button.dataset.server)));
        });

        await selectServer(0);
        return;
      }

      if (episodeData.defaultStreamingUrl) {
        renderEmbedPlayer(episodeData.defaultStreamingUrl);
      } else {
        watchPlayer.innerHTML = '<p class="search-status">Video tidak tersedia untuk episode ini.</p>';
      }
    } catch (error) {
      console.error(error);
      if (watchPlayer) watchPlayer.innerHTML = `<p class="search-status">Gagal memuat episode: ${error.message}</p>`;
    }
  };

  try {
    const detailJson = await fetchJson(`${API_BASE}/anime/${encodeURIComponent(id)}`);
    const anime = detailJson.data;
    const episodes = Array.isArray(anime.episodeList) ? anime.episodeList : [];

    if (watchTitle) watchTitle.textContent = getTitle(anime);
    if (watchType) watchType.textContent = anime.type || 'Anime';

    if (!episodeList) return;

    if (!episodes.length) {
      episodeList.innerHTML = '<p class="search-status">Episode tidak tersedia.</p>';
      return;
    }

    episodeList.innerHTML = episodes.map((episode, index) => `
      <button type="button" class="episode-button" data-episode="${index}">
        Episode ${episode.eps || index + 1}${episode.title ? ` — ${episode.title}` : ''}
      </button>
    `).join('');

    const buttons = episodeList.querySelectorAll('button');
    const selectEpisode = (selectedIndex) => {
      const episode = episodes[selectedIndex];
      if (!episode) return;
      buttons.forEach((button, idx) => {
        button.classList.toggle('active', idx === selectedIndex);
      });
      if (watchCurrent) watchCurrent.textContent = `Episode ${episode.eps || (selectedIndex + 1)}`;
      if (watchDescription) {
        watchDescription.textContent = episode.title_japanese || episode.title || 'Judul episode tidak tersedia.';
      }
      loadEpisodeStream(episode);
    };

    buttons.forEach((button) => {
      button.addEventListener('click', () => selectEpisode(Number(button.dataset.episode)));
    });

    selectEpisode(0);
  } catch (error) {
    console.error(error);
    if (watchPlayer) watchPlayer.innerHTML = `<p class="search-status">Gagal memuat halaman tonton: ${error.message}</p>`;
  }
}

async function loadSearchPage() {
  const keyword = getQueryParam('q').trim();
  const searchKey = document.getElementById('search-keyword');
  const heading = document.getElementById('search-heading');
  const status = document.getElementById('search-status');

  if (!keyword) {
    if (searchKey) searchKey.textContent = '...';
    if (heading) heading.textContent = 'Masukkan kata kunci pencarian di atas.';
    if (status) status.textContent = 'Gunakan nama anime, genre, atau kata kunci lain.';
    return;
  }

  if (searchKey) searchKey.textContent = keyword;
  if (heading) heading.textContent = 'Memuat hasil pencarian...';
  if (status) status.textContent = '';

  try {
    let json;
    try {
      json = await fetchJson(`${API_BASE}/search/${encodeURIComponent(keyword)}`);
    } catch (primaryError) {
      json = await fetchJson(`${API_BASE}/anime?search=${encodeURIComponent(keyword)}`);
    }

    const results = filterSearchResults(resolveSearchResults(json.data), keyword);
    renderGrid('search-grid', results);
    if (!results.length && heading) {
      heading.textContent = 'Tidak ada hasil ditemukan.';
      if (status) status.textContent = 'Coba kata kunci lain atau periksa kembali penulisan Anda.';
    }
  } catch (error) {
    if (heading) heading.textContent = 'Terjadi kesalahan koneksi.';
    if (status) status.textContent = error.message;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('home-trending-grid')) loadHomePage();
  if (document.getElementById('trending-grid')) loadTrendingPage();
  if (document.getElementById('collection-grid')) loadCollectionPage();
  if (document.getElementById('premium-grid')) loadPremiumPage();
  if (window.location.pathname.endsWith('search.html')) loadSearchPage();
  if (window.location.pathname.endsWith('anime.html') || document.getElementById('anime-title')) loadAnimePage();
  if (window.location.pathname.endsWith('watch.html') || document.getElementById('episode-list')) loadWatchPage();
});
