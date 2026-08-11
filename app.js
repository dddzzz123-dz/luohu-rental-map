const baseData = window.RENTAL_DATA;
const scanData = window.RENTAL_SCAN || { rentals: [], communities: [], stats: {} };
const photoData = window.RENTAL_PHOTO_COUNTS || { counts: {}, stats: {} };
const scanStations = new Set(["国贸", "老街", "大剧院"]);
const scannedRentals = scanData.rentals.map(item => ({ ...item, photoCount: Number(photoData.counts[item.url] ?? item.photoCount ?? 0) }));
const rentals = [...scannedRentals, ...baseData.rentals.filter(item => !scanStations.has(item.station))];
const { stations, research } = baseData;
const rentalImages = window.RENTAL_IMAGES || {};
const PAGE_SIZE = 8;
const mapStations = {
  "红岭": { x: 32.0, y: 45.3 },
  "老街": { x: 47.5, y: 58.0 },
  "晒布": { x: 54.4, y: 43.6 },
  "东门片区": { x: 49.4, y: 51.7, area: true },
  "大剧院": { x: 36.0, y: 60.4 },
  "湖贝": { x: 57.8, y: 54.8 },
  "黄贝岭": { x: 71.3, y: 50.7 },
  "国贸": { x: 49.6, y: 65.6 }
};

const STORAGE_KEY = "luohu-rental-review-v1";
const state = {
  station: null,
  maxRent: 4500,
  query: "",
  community: "",
  mode: "absolute",
  page: 1,
  favoritesOnly: false,
  photoMode: "all",
  sort: "recommend"
};
const review = loadReview();
const stationLayer = document.querySelector("#stationLayer");
const stationChips = document.querySelector("#stationChips");
const communityTabs = document.querySelector("#communityTabs");
const listingGrid = document.querySelector("#listingGrid");
const researchList = document.querySelector("#researchList");
const detailDialog = document.querySelector("#detailDialog");
const detailContent = document.querySelector("#detailContent");

document.querySelector("#totalCount").textContent = rentals.length;
if (scanData.stats?.amapUniqueCommunities) {
  document.querySelector("#dataPulse").innerHTML = `<i></i> 高德 ${scanData.stats.amapUniqueCommunities} 个候选 · 乐有家 ${scanData.stats.communitiesWithListings} 个命中小区 · ${scanData.stats.matchedRentals} 条新房源 · ${photoData.stats?.withImages || 0} 条有图`;
}

function loadReview() {
  try {
    return { favorites: {}, ratings: {}, notes: {}, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return { favorites: {}, ratings: {}, notes: {} };
  }
}

function saveReview() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(review));
  renderCollectionState();
}

function money(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function ratingOf(url) {
  const values = Object.values(review.ratings[url] || {}).filter(Number);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function sourceUrl(url) {
  return `${url}${url.includes("?") ? "&" : "?"}utm_term=lyj_token_fks`;
}

function resetPage() {
  state.page = 1;
}

function filteredRentals() {
  return rentals
    .filter(r => !state.station || r.station === state.station)
    .filter(r => r.rent >= 2400)
    .filter(r => r.rent <= state.maxRent)
    .filter(r => !state.query || r.name.toLowerCase().includes(state.query.toLowerCase()))
    .filter(r => !state.community || r.name === state.community)
    .filter(r => !state.favoritesOnly || review.favorites[r.url])
    .filter(r => state.photoMode === "all" || (state.photoMode === "with" ? effectivePhotoCount(r) >= 2 : effectivePhotoCount(r) <= 1))
    .sort((a, b) => {
      if (state.sort === "rating") return ratingOf(b.url) - ratingOf(a.url) || Math.abs(a.rent - 3500) - Math.abs(b.rent - 3500);
      if (state.sort === "priceAsc") return a.rent - b.rent || b.area - a.area;
      if (state.sort === "priceDesc") return b.rent - a.rent || b.area - a.area;
      if (state.sort === "areaDesc") return (b.area || 0) - (a.area || 0) || a.rent - b.rent;
      if (state.sort === "distanceAsc") return (a.distance ?? 9999) - (b.distance ?? 9999) || a.rent - b.rent;
      if (state.sort === "photosDesc") return effectivePhotoCount(b) - effectivePhotoCount(a) || a.rent - b.rent;
      if (state.mode === "target") return (a.rent - a.target) - (b.rent - b.target) || b.area - a.area;
      return Math.abs(a.rent - 3500) - Math.abs(b.rent - 3500) || b.area - a.area;
    });
}

function selectStation(name) {
  state.station = state.station === name ? null : name;
  state.community = "";
  resetPage();
  render();
  document.querySelector(".listing-shell").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderStations() {
  stationLayer.innerHTML = stations.map(s => {
    const point = mapStations[s.name];
    if (!point) return "";
    const active = state.station === s.name ? " active" : "";
    const filteredCount = rentals.filter(r => r.station === s.name && r.rent >= 2400 && r.rent <= state.maxRent).length;
    return `<button class="map-station${active}${point.area ? " area" : ""}" style="left:${point.x}%;top:${point.y}%" data-station="${escapeHtml(s.name)}" aria-label="筛选${escapeHtml(s.name)}，当前${filteredCount}套"><span>${point.area ? "片区" : "地铁"}</span><b>${escapeHtml(s.name)}</b><small>${filteredCount}套</small></button>`;
  }).join("");
  stationLayer.querySelectorAll(".map-station").forEach(el => el.addEventListener("click", () => selectStation(el.dataset.station)));
}

function renderChips() {
  const all = `<button class="chip ${!state.station ? "active" : ""}" data-station="">全部</button>`;
  stationChips.innerHTML = all + stations.map(s => `<button class="chip ${state.station === s.name ? "active" : ""}" data-station="${escapeHtml(s.name)}">${escapeHtml(s.name)} · ${rentals.filter(r => r.station === s.name).length}</button>`).join("");
  stationChips.querySelectorAll(".chip").forEach(el => el.addEventListener("click", () => {
    state.station = el.dataset.station || null;
    state.community = "";
    resetPage();
    render();
  }));
}

function renderCommunityTabs() {
  if (!state.station) {
    communityTabs.innerHTML = `<p>先选择一个地铁站，这里会列出该站小区、当前均租和房源数。</p>`;
    communityTabs.classList.add("is-empty");
    return;
  }
  communityTabs.classList.remove("is-empty");
  const relevant = rentals.filter(r => r.station === state.station && r.rent >= 2400 && r.rent <= state.maxRent);
  const groups = new Map();
  relevant.forEach(r => {
    const bucket = groups.get(r.name) || { total: 0, count: 0 };
    bucket.total += r.rent;
    bucket.count += 1;
    groups.set(r.name, bucket);
  });
  const items = [...groups.entries()].map(([name, value]) => ({ name, count: value.count, average: Math.round(value.total / value.count) }))
    .sort((a, b) => a.average - b.average || b.count - a.count);
  communityTabs.innerHTML = `<button class="community-tab ${!state.community ? "active" : ""}" data-community=""><b>全部小区</b><span>${items.length}个 · ${relevant.length}套</span></button>` + items.map(item => `<button class="community-tab ${state.community === item.name ? "active" : ""}" data-community="${escapeHtml(item.name)}"><b>${escapeHtml(item.name)}</b><span>均租 ¥${money(item.average)} · ${item.count}套</span></button>`).join("");
  communityTabs.querySelectorAll("[data-community]").forEach(button => button.addEventListener("click", () => {
    state.community = button.dataset.community;
    document.querySelector("#communitySelect").value = state.community;
    resetPage();
    renderCommunityTabs();
    renderListings();
  }));
}

function effectivePhotoCount(rental) {
  const verified = Number(rental.photoCount);
  if (Number.isFinite(verified)) return verified;
  return (rentalImages[rental.url] || []).length;
}

function renderCommunityOptions() {
  const select = document.querySelector("#communitySelect");
  const relevant = rentals.filter(rental => (!state.station || rental.station === state.station) && rental.rent >= 2400 && rental.rent <= state.maxRent);
  const counts = new Map();
  relevant.forEach(rental => counts.set(rental.name, (counts.get(rental.name) || 0) + 1));
  const options = [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0], "zh-CN"));
  select.innerHTML = `<option value="">全部小区（${options.length}）</option>` + options.map(([name, count]) => `<option value="${escapeHtml(name)}" ${state.community === name ? "selected" : ""}>${escapeHtml(name)} · ${count}套</option>`).join("");
}

function imageMarkup(rental) {
  const gallery = rentalImages[rental.url] || [];
  const image = gallery[0];
  const count = effectivePhotoCount(rental);
  if (image) return `<img src="${image}" alt="${escapeHtml(rental.name)}房源实拍封面" loading="lazy"><span class="photo-status live">有图</span><span class="photo-count">▣ ${count}</span>`;
  const hasImages = count >= 2;
  return `<div class="photo-placeholder"><b>${escapeHtml(rental.station)}</b><span>${escapeHtml(rental.name)}</span><small>${hasImages ? `乐有家原站 ${count} 张图` : `${count} 张图 · 按无图处理`}</small></div><span class="photo-status ${hasImages ? "live" : "empty"}">${hasImages ? "有图" : "无图"}</span><span class="photo-count">▣ ${count}</span>`;
}

function renderListings() {
  const result = filteredRentals();
  const pageCount = Math.max(1, Math.ceil(result.length / PAGE_SIZE));
  state.page = Math.min(state.page, pageCount);
  const pageStart = (state.page - 1) * PAGE_SIZE;
  document.querySelector("#visibleCount").textContent = result.length;
  document.querySelector("#listingTitle").textContent = state.community ? `${state.community}全部房源` : state.station ? `${state.station}房源` : (state.favoritesOnly ? "我的收藏" : "全部房源");
  listingGrid.innerHTML = result.slice(pageStart, pageStart + PAGE_SIZE).map((r, i) => {
    const delta = r.rent - r.target;
    const priceLabel = state.mode === "target" ? `${delta > 0 ? "+" : ""}${delta} vs目标` : `${r.rent <= 3500 ? "理想预算" : "可接受"}`;
    const isFavorite = Boolean(review.favorites[r.url]);
    const rating = ratingOf(r.url);
    return `<article class="listing-card" data-url="${r.url}" style="animation-delay:${Math.min(i, 12) * 25}ms">
      <button class="card-photo" type="button" aria-label="打开${escapeHtml(r.name)}详情">${imageMarkup(r)}</button>
      <button class="heart ${isFavorite ? "active" : ""}" type="button" data-favorite="${r.url}" aria-label="${isFavorite ? "取消收藏" : "收藏"}">${isFavorite ? "♥" : "♡"}</button>
      <div class="card-body">
        <div class="card-top"><span class="card-station">${escapeHtml(r.station)}${r.distance ? ` · ${r.distance}m` : ""} / ${priceLabel}</span><span class="card-rec">${escapeHtml(r.rec)}</span></div>
        <h3>${escapeHtml(r.name)}</h3>
        <div class="card-facts"><span>${r.area || "—"}㎡</span><span>${escapeHtml(r.layout)}</span><span>${escapeHtml(r.propertyClass || r.direction || "类型待核")}</span><span>${escapeHtml(r.decor)}</span></div>
        <div class="card-bottom"><div class="card-rent"><strong>¥${money(r.rent)}</strong><span>/月</span></div><span class="mini-rating">${rating ? `★ ${rating.toFixed(1)}` : "未评分"}</span></div>
        <div class="card-actions"><a class="source-link" href="${sourceUrl(r.url)}" target="_blank" rel="noreferrer">打开乐有家房源 ↗</a><button class="detail-link" type="button">看图 / 评分 / 笔记</button></div>
      </div>
    </article>`;
  }).join("") || `<p class="empty-state">当前条件下没有房源。可以取消“只看收藏”、提高租金上限或清空搜索。</p>`;

  listingGrid.querySelectorAll(".card-photo, .detail-link").forEach(button => button.addEventListener("click", () => openDetail(button.closest(".listing-card").dataset.url)));
  listingGrid.querySelectorAll("[data-favorite]").forEach(button => button.addEventListener("click", () => toggleFavorite(button.dataset.favorite)));

  renderPagination(pageCount, result.length);
  renderCollectionState();
}

function renderPagination(pageCount, total) {
  const pagination = document.querySelector("#pagination");
  if (!total) { pagination.innerHTML = ""; return; }
  const windowStart = Math.max(1, Math.min(state.page - 2, pageCount - 4));
  const pages = Array.from({ length: Math.min(5, pageCount) }, (_, index) => windowStart + index);
  pagination.innerHTML = `<button data-page="${state.page - 1}" ${state.page === 1 ? "disabled" : ""}>← 上一页</button>${pages.map(page => `<button data-page="${page}" class="${page === state.page ? "active" : ""}">${page}</button>`).join("")}<button data-page="${state.page + 1}" ${state.page === pageCount ? "disabled" : ""}>下一页 →</button><span>第 ${state.page} / ${pageCount} 页 · 共 ${total} 套</span>`;
  pagination.querySelectorAll("button:not([disabled])").forEach(button => button.addEventListener("click", () => {
    state.page = Number(button.dataset.page);
    renderListings();
    document.querySelector(".listing-grid").scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

function toggleFavorite(url, keepDetailOpen = false) {
  review.favorites[url] = !review.favorites[url];
  if (!review.favorites[url]) delete review.favorites[url];
  saveReview();
  renderListings();
  if (keepDetailOpen) openDetail(url);
}

function starRow(url, key, label) {
  const current = review.ratings[url]?.[key] || 0;
  return `<div class="rating-row"><span>${label}</span><div class="stars" data-rating-key="${key}">${[1, 2, 3, 4, 5].map(value => `<button type="button" data-value="${value}" class="${value <= current ? "active" : ""}" aria-label="${label}${value}星">★</button>`).join("")}</div><b>${current || "—"}</b></div>`;
}

function openDetail(url) {
  const rental = rentals.find(item => item.url === url);
  if (!rental) return;
  const images = rentalImages[url] || [];
  const isFavorite = Boolean(review.favorites[url]);
  detailContent.innerHTML = `<div class="detail-topbar"><span>ROOM REVIEW / ${escapeHtml(rental.station)}</span><button id="closeDetail" type="button" aria-label="关闭">×</button></div>
    <div class="detail-layout">
      <section class="detail-gallery">
        ${images.length ? `<div class="detail-stage"><img id="detailHero" class="detail-hero" src="${images[0]}" alt="${escapeHtml(rental.name)}房源实拍"><span id="galleryIndex" class="gallery-index">01 / ${String(images.length).padStart(2, "0")}</span>${images.length > 1 ? `<button id="galleryPrev" class="gallery-nav prev" type="button" aria-label="上一张">←</button><button id="galleryNext" class="gallery-nav next" type="button" aria-label="下一张">→</button>` : ""}</div><div class="thumb-strip">${images.map((image, index) => `<button type="button" data-gallery-index="${index}" class="${index === 0 ? "active" : ""}"><img src="${image}" alt="第${index + 1}张"></button>`).join("")}</div>` : `<div class="detail-empty"><b>此套封面尚未抓取</b><p>乐有家详情页仍可查看完整照片和视频；你的评分与笔记可以先保存。</p></div>`}
        <div class="gallery-caption"><span>${effectivePhotoCount(rental) >= 2 ? `乐有家原站已核验 ${effectivePhotoCount(rental)} 张图` : `${effectivePhotoCount(rental)} 张图，按无图处理`}</span><a href="${sourceUrl(rental.url)}" target="_blank" rel="noreferrer">打开乐有家完整相册 ↗</a></div>
      </section>
      <aside class="detail-panel">
        <p class="detail-kicker">${escapeHtml(rental.station)} · ${escapeHtml(rental.rec)}</p>
        <h2>${escapeHtml(rental.name)}</h2>
        <div class="detail-price">¥${money(rental.rent)}<small>/月</small></div>
        <div class="detail-facts"><span>${rental.area || "—"}㎡</span><span>${escapeHtml(rental.layout)}</span><span>${escapeHtml(rental.propertyClass || rental.direction || "类型待核")}</span><span>${rental.distance ? `${rental.distance}m 至站` : escapeHtml(rental.decor)}</span></div>
        <button id="detailFavorite" class="detail-favorite ${isFavorite ? "active" : ""}" type="button">${isFavorite ? "♥ 已收藏" : "♡ 加入收藏"}</button>
        <div class="rating-box">
          <p>我的看房评分 <small>保存在这台电脑</small></p>
          ${starRow(url, "hard", "硬装")}
          ${starRow(url, "soft", "软装")}
          ${starRow(url, "light", "采光")}
        </div>
        <label class="note-box">看房笔记<textarea id="detailNote" placeholder="例如：床垫要换、窗外不压抑、厨房收纳少……">${escapeHtml(review.notes[url] || "")}</textarea><small id="noteStatus">输入后自动保存</small></label>
        <a class="source-button" href="${sourceUrl(rental.url)}" target="_blank" rel="noreferrer">去乐有家核实状态 / 看全部图片</a>
      </aside>
    </div>`;

  detailContent.querySelector("#closeDetail").addEventListener("click", () => detailDialog.close());
  if (images.length) {
    let activeImage = 0;
    const showImage = index => {
      activeImage = (index + images.length) % images.length;
      detailContent.querySelector("#detailHero").src = images[activeImage];
      detailContent.querySelector("#galleryIndex").textContent = `${String(activeImage + 1).padStart(2, "0")} / ${String(images.length).padStart(2, "0")}`;
      detailContent.querySelectorAll("[data-gallery-index]").forEach((thumb, thumbIndex) => thumb.classList.toggle("active", thumbIndex === activeImage));
      detailContent.querySelector(`[data-gallery-index="${activeImage}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    };
    detailContent.querySelectorAll("[data-gallery-index]").forEach(button => button.addEventListener("click", () => showImage(Number(button.dataset.galleryIndex))));
    detailContent.querySelector("#galleryPrev")?.addEventListener("click", () => showImage(activeImage - 1));
    detailContent.querySelector("#galleryNext")?.addEventListener("click", () => showImage(activeImage + 1));
  }
  detailContent.querySelector("#detailFavorite").addEventListener("click", () => toggleFavorite(url, true));
  detailContent.querySelectorAll("[data-rating-key] button").forEach(button => button.addEventListener("click", () => {
    const key = button.parentElement.dataset.ratingKey;
    review.ratings[url] ||= {};
    review.ratings[url][key] = Number(button.dataset.value);
    saveReview();
    openDetail(url);
  }));
  detailContent.querySelector("#detailNote").addEventListener("input", event => {
    review.notes[url] = event.target.value;
    saveReview();
    detailContent.querySelector("#noteStatus").textContent = "已保存";
  });
  if (!detailDialog.open) detailDialog.showModal();
}

function renderCollectionState() {
  const count = Object.keys(review.favorites).length;
  document.querySelector("#favoriteCount").textContent = count;
  document.querySelector("#favoriteFilter").classList.toggle("active", state.favoritesOnly);
}

function renderResearch() {
  researchList.innerHTML = research.map(item => `<a class="research-item" href="${item.url}" target="_blank" rel="noreferrer"><span class="research-tag">${escapeHtml(item.tag)}</span><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.note)}</p></div><span class="research-arrow">→</span></a>`).join("");
}

function render() {
  renderStations();
  renderChips();
  renderCommunityOptions();
  renderCommunityTabs();
  renderListings();
}

document.querySelector("#searchInput").addEventListener("input", event => { state.query = event.target.value.trim(); resetPage(); renderListings(); });
document.querySelector("#rentRange").addEventListener("input", event => { state.maxRent = Number(event.target.value); document.querySelector("#rentValue").textContent = `¥${money(state.maxRent)}`; resetPage(); render(); });
document.querySelectorAll(".toggle").forEach(el => el.addEventListener("click", () => { document.querySelectorAll(".toggle").forEach(button => button.classList.remove("active")); el.classList.add("active"); state.mode = el.dataset.mode; renderListings(); }));
document.querySelector("#favoriteFilter").addEventListener("click", () => { state.favoritesOnly = !state.favoritesOnly; resetPage(); renderListings(); });
document.querySelector("#photoSelect").addEventListener("change", event => { state.photoMode = event.target.value; resetPage(); renderListings(); });
document.querySelector("#communitySelect").addEventListener("change", event => { state.community = event.target.value; resetPage(); renderCommunityTabs(); renderListings(); });
document.querySelector("#sortSelect").addEventListener("change", event => { state.sort = event.target.value; resetPage(); renderListings(); });
document.querySelector("#resetStation").addEventListener("click", () => { state.station = null; state.community = ""; resetPage(); render(); });
detailDialog.addEventListener("click", event => { if (event.target === detailDialog) detailDialog.close(); });

renderResearch();
render();
