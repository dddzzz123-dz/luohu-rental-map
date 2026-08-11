const baseData = window.RENTAL_DATA;
const latestData = window.RENTAL_LATEST || { rentals: [] };
const latestUrls = new Set(latestData.rentals.map(item => item.url));
const rentals = [...latestData.rentals, ...baseData.rentals.filter(item => !latestUrls.has(item.url))];
const { stations, research } = baseData;
const rentalImages = window.RENTAL_IMAGES || {};

const STORAGE_KEY = "luohu-rental-review-v1";
const state = {
  station: null,
  maxRent: 4500,
  query: "",
  mode: "absolute",
  limit: 18,
  favoritesOnly: false,
  photosOnly: false,
  sort: "recommend"
};
const review = loadReview();
const stationLayer = document.querySelector("#stationLayer");
const stationChips = document.querySelector("#stationChips");
const listingGrid = document.querySelector("#listingGrid");
const researchList = document.querySelector("#researchList");
const detailDialog = document.querySelector("#detailDialog");
const detailContent = document.querySelector("#detailContent");

document.querySelector("#totalCount").textContent = rentals.length;

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

function filteredRentals() {
  return rentals
    .filter(r => !state.station || r.station === state.station)
    .filter(r => r.rent <= state.maxRent)
    .filter(r => !state.query || r.name.toLowerCase().includes(state.query.toLowerCase()))
    .filter(r => !state.favoritesOnly || review.favorites[r.url])
    .filter(r => !state.photosOnly || (rentalImages[r.url] || []).length >= 2 || Number(r.photoCount) >= 2)
    .sort((a, b) => {
      if (state.sort === "rating") return ratingOf(b.url) - ratingOf(a.url) || Math.abs(a.rent - 3500) - Math.abs(b.rent - 3500);
      if (state.sort === "price") return a.rent - b.rent || b.area - a.area;
      if (state.mode === "target") return (a.rent - a.target) - (b.rent - b.target) || b.area - a.area;
      return Math.abs(a.rent - 3500) - Math.abs(b.rent - 3500) || b.area - a.area;
    });
}

function selectStation(name) {
  state.station = state.station === name ? null : name;
  state.limit = 18;
  render();
  document.querySelector(".listing-shell").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderStations() {
  stationLayer.innerHTML = stations.map(s => {
    const active = state.station === s.name ? " active" : "";
    const filteredCount = rentals.filter(r => r.station === s.name && r.rent <= state.maxRent).length;
    const size = Math.max(44, Math.min(78, 42 + Math.sqrt(filteredCount) * 4.3));
    return `<button class="station${active}" style="left:${s.x}%;top:${s.y}%;--size:${size}px" data-station="${escapeHtml(s.name)}" aria-label="${escapeHtml(s.name)}，${filteredCount}套"><b>${filteredCount}</b></button>
      <div class="station-label" style="left:${s.x}%;top:${s.y}%">${escapeHtml(s.name)}<small>目标 ¥${money(s.target)}</small></div>`;
  }).join("");
  stationLayer.querySelectorAll(".station").forEach(el => el.addEventListener("click", () => selectStation(el.dataset.station)));
}

function renderChips() {
  const all = `<button class="chip ${!state.station ? "active" : ""}" data-station="">全部</button>`;
  stationChips.innerHTML = all + stations.map(s => `<button class="chip ${state.station === s.name ? "active" : ""}" data-station="${escapeHtml(s.name)}">${escapeHtml(s.name)} · ${rentals.filter(r => r.station === s.name).length}</button>`).join("");
  stationChips.querySelectorAll(".chip").forEach(el => el.addEventListener("click", () => {
    state.station = el.dataset.station || null;
    state.limit = 18;
    render();
  }));
}

function imageMarkup(rental) {
  const gallery = rentalImages[rental.url] || [];
  const image = gallery[0];
  if (image) return `<img src="${image}" alt="${escapeHtml(rental.name)}房源实拍封面" loading="lazy"><span class="photo-status live">乐有家实拍</span><span class="photo-count">▣ ${gallery.length}</span>`;
  const verified = Number(rental.photoCount) >= 2;
  return `<div class="photo-placeholder"><b>${escapeHtml(rental.station)}</b><span>${escapeHtml(rental.name)}</span><small>${verified ? `原站已核验 ${rental.photoCount} 张图` : "点击进入详情 · 原站查看完整相册"}</small></div><span class="photo-status ${verified ? "live" : ""}">${verified ? `原站 ${rental.photoCount} 图` : "待补图"}</span>`;
}

function renderListings() {
  const result = filteredRentals();
  document.querySelector("#visibleCount").textContent = result.length;
  document.querySelector("#listingTitle").textContent = state.station ? `${state.station}房源` : (state.favoritesOnly ? "我的收藏" : "全部房源");
  listingGrid.innerHTML = result.slice(0, state.limit).map((r, i) => {
    const delta = r.rent - r.target;
    const priceLabel = state.mode === "target" ? `${delta > 0 ? "+" : ""}${delta} vs目标` : `${r.rent <= 3500 ? "理想预算" : "可接受"}`;
    const isFavorite = Boolean(review.favorites[r.url]);
    const rating = ratingOf(r.url);
    return `<article class="listing-card" data-url="${r.url}" tabindex="0" style="animation-delay:${Math.min(i, 12) * 25}ms">
      <button class="card-photo" type="button" aria-label="打开${escapeHtml(r.name)}详情">${imageMarkup(r)}</button>
      <button class="heart ${isFavorite ? "active" : ""}" type="button" data-favorite="${r.url}" aria-label="${isFavorite ? "取消收藏" : "收藏"}">${isFavorite ? "♥" : "♡"}</button>
      <div class="card-body">
        <div class="card-top"><span class="card-station">${escapeHtml(r.station)}${r.distance ? ` · ${r.distance}m` : ""} / ${priceLabel}</span><span class="card-rec">${escapeHtml(r.rec)}</span></div>
        <h3>${escapeHtml(r.name)}</h3>
        <div class="card-facts"><span>${r.area || "—"}㎡</span><span>${escapeHtml(r.layout)}</span><span>${escapeHtml(r.propertyClass || r.direction || "类型待核")}</span><span>${escapeHtml(r.decor)}</span></div>
        <div class="card-bottom"><div class="card-rent"><strong>¥${money(r.rent)}</strong><span>/月</span></div><span class="mini-rating">${rating ? `★ ${rating.toFixed(1)}` : "未评分"}</span><button class="detail-link" type="button">看图评分 →</button></div>
      </div>
    </article>`;
  }).join("") || `<p class="empty-state">当前条件下没有房源。可以取消“只看收藏”、提高租金上限或清空搜索。</p>`;

  listingGrid.querySelectorAll(".listing-card").forEach(card => {
    card.addEventListener("click", event => {
      if (event.target.closest("[data-favorite]")) return;
      openDetail(card.dataset.url);
    });
    card.addEventListener("keydown", event => { if (event.key === "Enter") openDetail(card.dataset.url); });
  });
  listingGrid.querySelectorAll("[data-favorite]").forEach(button => button.addEventListener("click", () => toggleFavorite(button.dataset.favorite)));

  const more = document.querySelector("#showMore");
  more.hidden = result.length <= state.limit;
  more.textContent = `再显示 ${Math.min(18, result.length - state.limit)} 套`;
  renderCollectionState();
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
        <div class="gallery-caption"><span>${images.length ? `已接入 ${images.length} 张真实房源图片` : (rental.photoCount ? `乐有家原站已核验 ${rental.photoCount} 张图` : "图片待补充")}</span><a href="${rental.url}" target="_blank" rel="noreferrer">打开乐有家完整相册 ↗</a></div>
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
        <a class="source-button" href="${rental.url}" target="_blank" rel="noreferrer">去乐有家核实状态 / 看全部图片</a>
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
  document.querySelector("#photoFilter").classList.toggle("active", state.photosOnly);
}

function renderResearch() {
  researchList.innerHTML = research.map(item => `<a class="research-item" href="${item.url}" target="_blank" rel="noreferrer"><span class="research-tag">${escapeHtml(item.tag)}</span><div><h3>${escapeHtml(item.title)}</h3><p>${escapeHtml(item.note)}</p></div><span class="research-arrow">→</span></a>`).join("");
}

function render() {
  renderStations();
  renderChips();
  renderListings();
}

document.querySelector("#searchInput").addEventListener("input", event => { state.query = event.target.value.trim(); state.limit = 18; renderListings(); });
document.querySelector("#rentRange").addEventListener("input", event => { state.maxRent = Number(event.target.value); document.querySelector("#rentValue").textContent = `¥${money(state.maxRent)}`; state.limit = 18; render(); });
document.querySelectorAll(".toggle").forEach(el => el.addEventListener("click", () => { document.querySelectorAll(".toggle").forEach(button => button.classList.remove("active")); el.classList.add("active"); state.mode = el.dataset.mode; renderListings(); }));
document.querySelector("#favoriteFilter").addEventListener("click", () => { state.favoritesOnly = !state.favoritesOnly; state.limit = 18; renderListings(); });
document.querySelector("#photoFilter").addEventListener("click", () => { state.photosOnly = !state.photosOnly; state.limit = 18; renderListings(); });
document.querySelector("#sortSelect").addEventListener("change", event => { state.sort = event.target.value; renderListings(); });
document.querySelector("#resetStation").addEventListener("click", () => { state.station = null; state.limit = 18; render(); });
document.querySelector("#showMore").addEventListener("click", () => { state.limit += 18; renderListings(); });
detailDialog.addEventListener("click", event => { if (event.target === detailDialog) detailDialog.close(); });

renderResearch();
render();
