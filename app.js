// Render periodické tabulky + click panel s detailem + lazy-load obrázků z Wikipedie.

const tableEl = document.getElementById("periodic-table");
const panelEl = document.getElementById("tooltip"); // nazveno tooltip kvůli zachování CSS, ale jde o click panel
const legendEl = document.getElementById("legend");
const searchEl = document.getElementById("search");
const searchCountEl = document.getElementById("search-count");

const imageCache = new Map();
const inflight = new Map();
let activeTile = null;
let activeId = 0;

let searchQuery = "";
let legendCat = null;
const ELEMENTS_BY_Z = new Map(ELEMENTS.map(e => [e.z, e]));

function fmtMass(m) {
  if (m == null) return "—";
  return Number.isInteger(m) ? `(${m})` : m.toFixed(3);
}

function buildTile(el) {
  const tile = document.createElement("div");
  tile.className = "tile";
  tile.style.setProperty("--cat-color", CATEGORIES[el.category]?.color ?? "#888");
  tile.style.gridRow = el.row;
  tile.style.gridColumn = el.col;
  tile.dataset.z = el.z;
  tile.dataset.cat = el.category;

  tile.innerHTML = `
    <div class="z">${el.z}</div>
    <div class="symbol">${el.symbol}</div>
    <div class="name">${el.nameCs}</div>
    ${el.radioactive ? `<div class="radio-mark" title="Radioaktivní">☢</div>` : ""}
  `;

  tile.addEventListener("click", (e) => {
    e.stopPropagation();
    if (activeTile === tile) {
      closePanel();
    } else {
      openPanel(el, tile, e);
    }
  });
  tile.tabIndex = 0;
  tile.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      tile.click();
    }
  });

  return tile;
}

function buildPlaceholder(p) {
  const cell = document.createElement("div");
  cell.className = "placeholder";
  cell.style.gridRow = p.row;
  cell.style.gridColumn = p.col;
  cell.textContent = p.label;
  cell.title = p.target;
  return cell;
}

function render() {
  for (const el of ELEMENTS) tableEl.appendChild(buildTile(el));
  for (const p of PLACEHOLDERS) tableEl.appendChild(buildPlaceholder(p));

  for (const [key, cat] of Object.entries(CATEGORIES)) {
    if (key === "unknown" && !ELEMENTS.some(e => e.category === "unknown")) continue;
    const item = document.createElement("div");
    item.className = "legend-item";
    item.dataset.cat = key;
    item.innerHTML = `<span class="legend-swatch" style="background:${cat.color}"></span><span>${cat.label}</span>`;
    item.addEventListener("mouseenter", () => highlightCategory(key));
    item.addEventListener("mouseleave", clearHighlight);
    legendEl.appendChild(item);
  }
}

function highlightCategory(cat) {
  legendCat = cat;
  applyFilter();
}

function clearHighlight() {
  legendCat = null;
  applyFilter();
}

function matchesSearch(el, q) {
  if (!q) return false;
  const cs = el.nameCs.toLowerCase();
  const en = (el.nameEn || "").toLowerCase();
  const sym = el.symbol.toLowerCase();
  const z = String(el.z);
  return cs.startsWith(q) || en.startsWith(q) || sym.startsWith(q) || z === q;
}

function applyFilter() {
  const q = searchQuery.trim().toLowerCase();
  const cat = legendCat;
  const tiles = tableEl.querySelectorAll(".tile");

  // legenda hover má přednost (přepisuje search dočasně)
  if (cat) {
    let n = 0;
    for (const t of tiles) {
      const isMatch = t.dataset.cat === cat;
      t.classList.toggle("dimmed", !isMatch);
      t.classList.toggle("match", isMatch);
      t.classList.remove("search-hit");
      if (isMatch) n++;
    }
    return;
  }

  if (q) {
    let n = 0;
    for (const t of tiles) {
      const z = parseInt(t.dataset.z, 10);
      const el = ELEMENTS_BY_Z.get(z);
      const isMatch = el && matchesSearch(el, q);
      t.classList.toggle("dimmed", !isMatch);
      t.classList.toggle("match", isMatch);
      t.classList.toggle("search-hit", isMatch);
      if (isMatch) n++;
    }
    if (searchCountEl) {
      searchCountEl.textContent = n === 0
        ? "žádný prvek"
        : n === 1 ? "1 prvek" : `${n} prvků`;
    }
    return;
  }

  // bez filtru
  for (const t of tiles) {
    t.classList.remove("dimmed", "match", "search-hit");
  }
  if (searchCountEl) searchCountEl.textContent = "";
}

async function fetchWikipediaImage(nameEn) {
  if (imageCache.has(nameEn)) return imageCache.get(nameEn).url;
  if (inflight.has(nameEn)) return inflight.get(nameEn);

  const tryFetch = async (title) => {
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = await res.json();
      return data.originalimage?.source || data.thumbnail?.source || null;
    } catch { return null; }
  };

  const p = (async () => {
    let img = await tryFetch(`${nameEn} (element)`);
    if (!img) img = await tryFetch(nameEn);
    imageCache.set(nameEn, { url: img });
    return img;
  })();
  inflight.set(nameEn, p);
  const result = await p;
  inflight.delete(nameEn);
  return result;
}

function imageHTML(url, alt) {
  if (!url) {
    return `<div class="tt-image-fallback">Obrázek pro „${alt}“ není dostupný.</div>`;
  }
  return `<img src="${url}" alt="${alt}" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'tt-image-fallback\\'>Obrázek se nepodařilo načíst</div>'" />`;
}

function wikiUrlCs(nameCs) {
  return `https://cs.wikipedia.org/wiki/${encodeURIComponent(nameCs)}`;
}

function radioBlockHTML(el) {
  if (!el.radioactive) {
    return `<div class="tt-not-radio"><span>✓</span><span>Stabilní (žádné měřitelné záření)</span></div>`;
  }
  const r = RADIOACTIVITY[el.z];
  if (!r) {
    return `<div class="tt-radio"><div class="tt-radio-head"><span class="icon">☢</span><span>Radioaktivní</span></div></div>`;
  }
  const intensityLabel = INTENSITY_LABELS[r.intensity] ?? "?";
  const color = INTENSITY_COLORS[r.intensity] ?? "#888";
  let segs = "";
  for (let i = 1; i <= 5; i++) {
    segs += `<span class="seg${i <= r.intensity ? " active" : ""}"></span>`;
  }
  return `
    <div class="tt-radio" style="--intensity-color:${color}">
      <div class="tt-radio-head">
        <span class="icon">☢</span>
        <span>RADIOAKTIVNÍ</span>
        <span class="intensity-label">${intensityLabel}</span>
      </div>
      <div class="tt-radio-bar" aria-label="Intenzita ${r.intensity} z 5">${segs}</div>
      <div class="tt-radio-half"><b>Poločas rozpadu:</b> ${r.halfLife} (${r.isotope})</div>
    </div>
  `;
}

function panelHTML(el) {
  const cat = CATEGORIES[el.category]?.label ?? "?";
  const color = CATEGORIES[el.category]?.color ?? "#888";
  return `
    <button class="tt-close" aria-label="Zavřít" type="button">×</button>

    <div class="tt-header">
      <div class="tt-symbol" style="background:${color}">${el.symbol}</div>
      <div class="tt-title">
        <div class="tt-name">${el.nameCs}</div>
        <div class="tt-meta">Protonové číslo ${el.z} · ${cat}</div>
      </div>
    </div>

    <div class="tt-image-wrap" data-img-slot>
      <div class="tt-loading">Načítám obrázek z Wikipedie…</div>
    </div>

    ${radioBlockHTML(el)}

    <div class="tt-desc">${el.description}</div>

    <div class="tt-props">
      <div><b>Symbol:</b> ${el.symbol}</div>
      <div><b>Atomová hmotnost:</b> ${fmtMass(el.mass)}</div>
      <div><b>Perioda:</b> ${el.period}</div>
      <div><b>Skupina:</b> ${el.group ?? "f-blok"}</div>
    </div>

    <a class="tt-wiki" href="${wikiUrlCs(el.nameCs)}" target="_blank" rel="noopener noreferrer">
      <span>Otevřít na české Wikipedii</span><span class="ext">↗</span>
    </a>
  `;
}

async function openPanel(el, tile, e) {
  if (activeTile) activeTile.classList.remove("active");
  activeTile = tile;
  tile.classList.add("active");

  activeId++;
  const my = activeId;

  panelEl.innerHTML = panelHTML(el);
  panelEl.classList.add("visible");
  panelEl.setAttribute("aria-hidden", "false");
  positionPanel(tile);

  panelEl.querySelector(".tt-close")?.addEventListener("click", (ev) => {
    ev.stopPropagation();
    closePanel();
  });

  const slot = panelEl.querySelector("[data-img-slot]");
  if (!slot) return;

  if (imageCache.has(el.nameEn)) {
    const url = imageCache.get(el.nameEn).url;
    if (my !== activeId) return;
    slot.innerHTML = imageHTML(url, el.nameCs);
    return;
  }

  try {
    const url = await fetchWikipediaImage(el.nameEn);
    if (my !== activeId) return;
    slot.innerHTML = imageHTML(url, el.nameCs);
  } catch {
    if (my !== activeId) return;
    slot.innerHTML = `<div class="tt-image-fallback">Obrázek se nepodařilo načíst.</div>`;
  }
}

function positionPanel(tile) {
  const pad = 12;
  const rect = tile.getBoundingClientRect();
  // change visibility na chvíli na visible, ať změříme rozměry
  panelEl.style.visibility = "visible";
  const w = panelEl.offsetWidth || 360;
  const h = panelEl.offsetHeight || 320;

  // preferuj pozici vpravo od dlaždice; fallback vlevo; pak nad/pod; nakonec center
  let x = rect.right + pad;
  let y = rect.top;

  if (x + w + pad > window.innerWidth) {
    x = rect.left - w - pad; // vlevo
  }
  if (x < pad) {
    x = Math.max(pad, (window.innerWidth - w) / 2);
  }
  if (y + h + pad > window.innerHeight) {
    y = window.innerHeight - h - pad;
  }
  if (y < pad) y = pad;

  panelEl.style.left = `${x}px`;
  panelEl.style.top = `${y}px`;
}

function closePanel() {
  activeId++;
  panelEl.classList.remove("visible");
  panelEl.setAttribute("aria-hidden", "true");
  if (activeTile) {
    activeTile.classList.remove("active");
    activeTile = null;
  }
}

// klik mimo panel zavře
document.addEventListener("click", (e) => {
  if (!activeTile) return;
  if (panelEl.contains(e.target)) return;
  if (e.target.closest(".tile")) return;
  closePanel();
});

// Esc zavře
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && activeTile) closePanel();
});

// reposition při scrollu/resize
window.addEventListener("resize", () => { if (activeTile) positionPanel(activeTile); });
window.addEventListener("scroll", () => { if (activeTile) positionPanel(activeTile); }, { passive: true });

// search
searchEl?.addEventListener("input", (e) => {
  searchQuery = e.target.value || "";
  applyFilter();
});
searchEl?.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    e.target.value = "";
    searchQuery = "";
    applyFilter();
    e.target.blur();
  }
});

render();
