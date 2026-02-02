const mapContainer = document.getElementById("map")
const listContainer = document.getElementById("list")
const searchInput = document.getElementById("searchInput")
const suggestionsContainer = document.getElementById("searchSuggestions")
const searchButton = document.getElementById("searchButton")
const toggleButton = document.getElementById("toggleView")
const mapView = document.getElementById("mapView")
const listView = document.getElementById("listView")
const detailView = document.getElementById("detailView")
const backButton = document.getElementById("backButton")
const detailCard = document.getElementById("detailCard")
const detailMapContainer = document.getElementById("detailMap")

let map
let markersLayer
let allPlaces = []
let markersById = new Map()
let activeSuggestionIndex = -1
let pendingOpenPlaceId = null
let lastMainView = "map"

let detailMap
let detailMarker

const normalizeItem = (item) => {
  if (typeof item === "string") {
    return { name: item, price: null }
  }
  if (item && typeof item === "object") {
    return {
      name: String(item.name ?? ""),
      price: typeof item.price === "number" ? item.price : null
    }
  }
  return { name: "", price: null }
}

const setActiveView = (view) => {
  mapView.classList.remove("view--active")
  listView.classList.remove("view--active")
  detailView.classList.remove("view--active")
  view.classList.add("view--active")

  const isDetail = view === detailView
  toggleButton.style.display = isDetail ? "none" : ""
  if (!isDetail && view === mapView) {
    setTimeout(() => map.invalidateSize(), 200)
  }
}

const showMainView = (viewName) => {
  lastMainView = viewName
  setActiveView(viewName === "list" ? listView : mapView)
  toggleButton.textContent = viewName === "list" ? "Voir la carte" : "Voir la liste"
}

const getBasePlaces = () => {
  return allPlaces
}

const formatPrice = (price) => {
  if (typeof price !== "number") return ""
  return `${price.toFixed(2)} €`
}

const normalizeForSearch = (value) => {
  return String(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9\s'’-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

const levenshteinDistance = (a, b) => {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  const prev = new Array(b.length + 1)
  const curr = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j += 1) prev[j] = j

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i
    const ai = a.charCodeAt(i - 1)
    for (let j = 1; j <= b.length; j += 1) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j]
  }

  return prev[b.length]
}

const similarityScore = (query, candidate) => {
  const q = normalizeForSearch(query)
  const c = normalizeForSearch(candidate)
  if (!q || !c) return 0
  if (c.includes(q)) return 1

  const baseScore = (left, right) => {
    if (!left || !right) return 0
    const dist = levenshteinDistance(left, right)
    const denom = Math.max(left.length, right.length)
    if (denom === 0) return 0
    return Math.max(0, 1 - dist / denom)
  }

  let best = baseScore(q, c)

  const tokens = c.split(" ").filter(Boolean)
  for (const token of tokens) {
    best = Math.max(best, baseScore(q, token))
  }

  return best
}

const scorePlace = (query, place) => {
  const nameScore = similarityScore(query, place.name)
  const bestItem = place.glutenFreeItems
    .map(normalizeItem)
    .filter((it) => it.name)
    .reduce(
      (best, it) => {
        const score = similarityScore(query, it.name)
        if (score > best.score) return { score, item: it }
        return best
      },
      { score: 0, item: null }
    )

  const score = Math.max(nameScore, bestItem.score)
  return { score, nameScore, bestItem: bestItem.item, bestItemScore: bestItem.score }
}

const openSuggestions = () => {
  if (!suggestionsContainer) return
  suggestionsContainer.classList.add("suggestions--open")
}

const closeSuggestions = () => {
  if (!suggestionsContainer) return
  suggestionsContainer.classList.remove("suggestions--open")
  suggestionsContainer.innerHTML = ""
  activeSuggestionIndex = -1
}

const renderSuggestions = (query, scoredPlaces) => {
  if (!suggestionsContainer) return
  const q = query.trim()
  if (!q) {
    closeSuggestions()
    return
  }

  const suggestions = []
  for (const sp of scoredPlaces) {
    const place = sp.place
    const typeLabel = "Restaurant"
    suggestions.push({
      key: `place:${place.id}`,
      kind: "place",
      title: place.name,
      meta: typeLabel,
      score: sp.score,
      value: place.name,
      placeId: place.id
    })

    if (sp.bestItem) {
      const price = formatPrice(sp.bestItem.price)
      suggestions.push({
        key: `item:${place.id}:${normalizeForSearch(sp.bestItem.name)}`,
        kind: "item",
        title: `${sp.bestItem.name}${price ? ` · ${price}` : ""}`,
        meta: `${place.name} · ${typeLabel}`,
        score: sp.bestItemScore,
        value: sp.bestItem.name,
        placeId: place.id
      })
    }
  }

  suggestions.sort((a, b) => b.score - a.score)
  const unique = []
  const seen = new Set()
  for (const s of suggestions) {
    if (seen.has(s.key)) continue
    seen.add(s.key)
    if (s.score < 0.35) continue
    unique.push(s)
    if (unique.length >= 7) break
  }

  if (unique.length === 0) {
    closeSuggestions()
    return
  }

  suggestionsContainer.innerHTML = ""
  unique.forEach((s, index) => {
    const el = document.createElement("div")
    el.className = "suggestion"
    el.setAttribute("role", "option")
    el.dataset.index = String(index)
    el.dataset.value = s.value
    el.dataset.placeId = String(s.placeId ?? "")

    const main = document.createElement("div")
    main.className = "suggestionMain"

    const titleRow = document.createElement("div")
    titleRow.className = "suggestionTitleRow"

    const title = document.createElement("div")
    title.className = "suggestionTitle"
    title.textContent = s.title

    const tag = document.createElement("div")
    tag.className = `suggestionTag ${s.kind === "place" ? "suggestionTag--place" : "suggestionTag--item"}`
    tag.textContent = s.kind === "place" ? "Resto" : "Plat"

    const meta = document.createElement("div")
    meta.className = "suggestionMeta"
    meta.textContent = s.meta

    const score = document.createElement("div")
    score.className = "suggestionScore"
    score.textContent = `${Math.round(s.score * 100)}%`

    titleRow.appendChild(title)
    titleRow.appendChild(tag)
    main.appendChild(titleRow)
    main.appendChild(meta)
    el.appendChild(main)
    el.appendChild(score)

    el.addEventListener("mousedown", (e) => {
      e.preventDefault()
      selectSuggestion(s)
    })

    suggestionsContainer.appendChild(el)
  })

  openSuggestions()
}

const highlightSuggestion = (index) => {
  if (!suggestionsContainer) return
  const items = Array.from(suggestionsContainer.querySelectorAll(".suggestion"))
  items.forEach((el) => el.classList.remove("suggestion--active"))
  if (index < 0 || index >= items.length) return
  items[index].classList.add("suggestion--active")
  activeSuggestionIndex = index
}

const selectSuggestion = (suggestion) => {
  searchInput.value = suggestion.value
  if (suggestion.placeId != null) {
    location.hash = `place/${suggestion.placeId}`
  } else {
    updateSearch()
  }
  closeSuggestions()
}

const icons = {
  restaurant: L.divIcon({
    className: "",
    html: '<div style="background:#1d4ed8;width:12px;height:12px;border-radius:999px;border:2px solid #fff;box-shadow:0 10px 18px rgba(15,23,42,0.22)"></div>'
  }),
}

const initMap = () => {
  map = L.map(mapContainer, {
    zoomControl: false
  })
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
    attribution: "© OpenStreetMap contributors © CARTO",
    subdomains: "abcd",
    maxZoom: 20
  }).addTo(map)
  L.control.zoom({ position: "bottomright" }).addTo(map)

  if (typeof L.markerClusterGroup === "function") {
    markersLayer = L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 56,
      spiderfyDistanceMultiplier: 1.35,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount()

        const size = count < 10 ? "s" : count < 50 ? "m" : "l"
        const dim = size === "s" ? 44 : size === "m" ? 50 : 56

        return L.divIcon({
          html: `<div class="cluster cluster--${size}"><div class="cluster__inner"><div class="cluster__count">${count}</div></div></div>`,
          className: "clusterIcon",
          iconSize: [dim, dim]
        })
      }
    }).addTo(map)
  } else {
    markersLayer = L.layerGroup().addTo(map)
  }

  map.on("popupopen", (e) => {
    const root = e.popup?.getElement?.()
    const btn = root?.querySelector?.(".popupAction")
    if (!btn) return
    btn.addEventListener(
      "click",
      () => {
        const id = Number(btn.dataset.placeId)
        if (Number.isFinite(id)) location.hash = `place/${id}`
      },
      { once: true }
    )
  })
}

const renderList = (places) => {
  listContainer.innerHTML = ""
  if (places.length === 0) {
    listContainer.innerHTML = '<div class="empty">Aucun établissement ne correspond à votre recherche.</div>'
    return
  }

  const fragment = document.createDocumentFragment()
  places.forEach((place) => {
    const card = document.createElement("div")
    card.className = "card"
    card.tabIndex = 0
    card.addEventListener("click", () => {
      location.hash = `place/${place.id}`
    })
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter") location.hash = `place/${place.id}`
    })

    const badgeClass = "badge--restaurant"
    const header = document.createElement("div")
    header.className = "card__header"

    const title = document.createElement("div")
    title.className = "card__title"
    title.textContent = place.name

    const badge = document.createElement("div")
    badge.className = `badge ${badgeClass}`
    badge.textContent = "Restaurant"

    header.appendChild(title)
    header.appendChild(badge)

    const items = document.createElement("div")
    items.className = "items"
    place.glutenFreeItems
      .map(normalizeItem)
      .filter((it) => it.name)
      .slice(0, 4)
      .forEach((it) => {
        const row = document.createElement("div")
        row.className = "itemRow"

        const name = document.createElement("div")
        name.className = "itemName"
        name.textContent = it.name

        const price = document.createElement("div")
        price.className = "itemPrice"
        price.textContent = formatPrice(it.price)

        row.appendChild(name)
        row.appendChild(price)
        items.appendChild(row)
      })

    card.appendChild(header)
    card.appendChild(items)
    fragment.appendChild(card)
  })

  listContainer.appendChild(fragment)
}

const popupHtml = (place) => {
  const badgeClass = "popupBadge--restaurant"
  const badgeText = "Restaurant"

  const items = place.glutenFreeItems
    .map(normalizeItem)
    .filter((it) => it.name)
    .map((it) => {
      const price = formatPrice(it.price)
      return `<li><div class="popupItem"><div>${it.name}</div><div class="popupItemPrice">${price}</div></div></li>`
    })
    .join("")

  return `<div class="popup"><div class="popupHeader"><div class="popupTitle">${place.name}</div><div class="popupBadge ${badgeClass}">${badgeText}</div></div><ul class="popupList">${items}</ul><button class="popupAction" data-place-id="${place.id}" type="button">Voir la fiche</button></div>`
}

const popupHtmlDetail = (place) => {
  const badgeClass = "popupBadge--restaurant"
  const badgeText = "Restaurant"

  const items = place.glutenFreeItems
    .map(normalizeItem)
    .filter((it) => it.name)
    .map((it) => {
      const price = formatPrice(it.price)
      return `<li><div class="popupItem"><div>${it.name}</div><div class="popupItemPrice">${price}</div></div></li>`
    })
    .join("")

  return `<div class="popup"><div class="popupHeader"><div class="popupTitle">${place.name}</div><div class="popupBadge ${badgeClass}">${badgeText}</div></div><ul class="popupList">${items}</ul></div>`
}

const renderMap = (places) => {
  markersLayer.clearLayers()
  markersById = new Map()
  const bounds = []

  places.forEach((place) => {
    const marker = L.marker([place.latitude, place.longitude], {
      icon: icons[place.type]
    })
    marker.bindPopup(popupHtml(place), { closeButton: false, className: "glutapp-popup" })
    markersLayer.addLayer(marker)
    markersById.set(place.id, marker)
    bounds.push([place.latitude, place.longitude])
  })

  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [50, 50] })
  } else {
    map.setView([48.8566, 2.3522], 12)
  }

  if (pendingOpenPlaceId != null) {
    const marker = markersById.get(pendingOpenPlaceId)
    pendingOpenPlaceId = null
    if (marker && mapView.classList.contains("view--active")) {
      map.setView(marker.getLatLng(), Math.max(map.getZoom(), 14), { animate: true })
      marker.openPopup()
    }
  }
}

const renderDetail = (place) => {
  if (!place) return
  setActiveView(detailView)
  closeSuggestions()

  const typeLabel = "Restaurant"
  const badgeClass = "badge--restaurant"
  const hours = place.openingHours && typeof place.openingHours === "object" ? place.openingHours : {}

  const rawPhone = String(place.phone ?? "").trim()
  const phoneDigits = rawPhone.replace(/[\s.\-()]/g, "")
  const phoneHtml = rawPhone
    ? `<a class="detailLink" href="tel:${phoneDigits}">${rawPhone}</a>`
    : "—"

  const infoRows = [
    { key: "Ville", value: String(place.city ?? "").trim() || "—" },
    { key: "Adresse", value: String(place.address ?? "").trim() || "—" },
    { key: "Téléphone", value: phoneHtml, isHtml: true }
  ]
    .map((r) => {
      const value = r.isHtml ? r.value : String(r.value)
      return `<div class="detailMetaRow"><div class="detailMetaKey">${r.key}</div><div class="detailMetaValue">${value}</div></div>`
    })
    .join("")

  const hoursRows = Object.entries(hours)
    .map(
      ([k, v]) =>
        `<div class="detailMetaRow"><div class="detailMetaKey">${k}</div><div class="detailMetaValue">${v}</div></div>`
    )
    .join("")

  const itemsRows = place.glutenFreeItems
    .map(normalizeItem)
    .filter((it) => it.name)
    .map((it) => {
      return `<div class="itemRow"><div class="itemName">${it.name}</div><div class="itemPrice">${formatPrice(it.price)}</div></div>`
    })
    .join("")

  const menuBlock = itemsRows
    ? `<div class="items items--menu">${itemsRows}</div>`
    : '<div class="detailEmpty">Menu indisponible</div>'

  detailCard.innerHTML = `
    <div class="detailHeader">
      <div>
        <div class="detailTitle">${place.name}</div>
        <div class="detailMeta">${typeLabel}</div>
      </div>
      <div class="badge ${badgeClass}">${typeLabel}</div>
    </div>
    <div class="detailSections">
      <div class="detailSectionCard">
        <div class="detailSectionTitle">Infos</div>
        <div class="detailSectionBody">
          ${infoRows}
        </div>
      </div>
      <div class="detailSectionCard">
        <div class="detailSectionTitle">Horaires d'ouverture</div>
        <div class="detailSectionBody">
          ${hoursRows || '<div class="detailMetaRow"><div class="detailMetaKey">Horaires</div><div class="detailMetaValue">—</div></div>'}
        </div>
      </div>
      <div class="detailSectionCard detailSectionCard--menu">
        <div class="detailSectionTitle">Plats sans gluten</div>
        <div class="detailSectionBody">
          ${menuBlock}
        </div>
      </div>
    </div>
  `.trim()

  if (!detailMap) {
    detailMap = L.map(detailMapContainer, {
      zoomControl: false,
      attributionControl: false
    })
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution: "© OpenStreetMap contributors © CARTO",
      subdomains: "abcd",
      maxZoom: 20
    }).addTo(detailMap)
    L.control.zoom({ position: "bottomright" }).addTo(detailMap)
  }

  if (detailMarker) {
    detailMap.removeLayer(detailMarker)
  }

  detailMarker = L.marker([place.latitude, place.longitude], { icon: icons[place.type] }).addTo(detailMap)
  detailMarker.bindPopup(popupHtmlDetail(place), { closeButton: false, className: "glutapp-popup" })
  detailMap.setView([place.latitude, place.longitude], 15)
  setTimeout(() => {
    detailMap.invalidateSize()
    detailMarker.openPopup()
  }, 200)
}

const handleRoute = () => {
  const hash = String(location.hash || "").replace(/^#/, "")
  const match = hash.match(/^place\/(\d+)$/)
  if (!match) {
    showMainView(lastMainView)
    return
  }

  const id = Number(match[1])
  const place = allPlaces.find((p) => p.id === id)
  if (!place) {
    showMainView(lastMainView)
    return
  }
  renderDetail(place)
}

const updateSearch = () => {
  if (detailView.classList.contains("view--active")) {
    showMainView("map")
  }

  const rawQuery = searchInput.value
  const query = rawQuery.trim()
  const base = getBasePlaces()
  if (!query) {
    renderList(base)
    renderMap(base)
    closeSuggestions()
    return
  }

  const scored = base
    .map((place) => {
      const scoredPlace = scorePlace(query, place)
      return { place, ...scoredPlace }
    })
    .sort((a, b) => b.score - a.score)

  const filtered = scored.filter((sp) => sp.score >= 0.45).map((sp) => sp.place)
  renderList(filtered)
  renderMap(filtered)
  renderSuggestions(query, scored)
}

const executeSearch = () => {
  if (detailView.classList.contains("view--active")) {
    showMainView(lastMainView)
  }

  const rawQuery = searchInput.value
  const query = rawQuery.trim()
  const base = getBasePlaces()
  if (!query) {
    renderList(base)
    renderMap(base)
    closeSuggestions()
    return
  }

  const scored = base
    .map((place) => {
      const scoredPlace = scorePlace(query, place)
      return { place, ...scoredPlace }
    })
    .sort((a, b) => b.score - a.score)

  const filtered = scored.filter((sp) => sp.score >= 0.45).map((sp) => sp.place)
  renderList(filtered)
  renderMap(filtered)
  closeSuggestions()
}

const toggleView = () => {
  const isMapVisible = mapView.classList.contains("view--active")
  if (isMapVisible) {
    showMainView("list")
  } else {
    showMainView("map")
  }
}

const loadData = async () => {
  const response = await fetch("data.json")
  allPlaces = await response.json()
  const base = getBasePlaces()
  renderList(base)
  renderMap(base)
  handleRoute()
}

initMap()
loadData()
window.addEventListener("hashchange", handleRoute)
backButton.addEventListener("click", () => {
  location.hash = ""
})
searchInput.addEventListener("input", updateSearch)
searchInput.addEventListener("focus", updateSearch)
searchInput.addEventListener("blur", () => setTimeout(closeSuggestions, 120))
searchInput.addEventListener("keydown", (e) => {
  const isSuggestionsOpen = Boolean(suggestionsContainer?.classList.contains("suggestions--open"))

  if (e.key === "Escape") {
    closeSuggestions()
    return
  }

  if (e.key === "Enter") {
    if (!isSuggestionsOpen) {
      e.preventDefault()
      executeSearch()
      return
    }

    const items = Array.from(suggestionsContainer.querySelectorAll(".suggestion"))
    if (items.length === 0 || activeSuggestionIndex < 0) {
      e.preventDefault()
      executeSearch()
      return
    }

    e.preventDefault()
    const el = items[activeSuggestionIndex]
    const value = el.dataset.value
    const placeId = Number(el.dataset.placeId)
    selectSuggestion({ value, placeId: Number.isFinite(placeId) ? placeId : null })
    return
  }

  if (!isSuggestionsOpen) return
  const items = Array.from(suggestionsContainer.querySelectorAll(".suggestion"))
  if (items.length === 0) return

  if (e.key === "ArrowDown") {
    e.preventDefault()
    highlightSuggestion(Math.min(activeSuggestionIndex + 1, items.length - 1))
  } else if (e.key === "ArrowUp") {
    e.preventDefault()
    highlightSuggestion(Math.max(activeSuggestionIndex - 1, 0))
  }
})
searchButton?.addEventListener("click", () => {
  executeSearch()
})
toggleButton.addEventListener("click", toggleView)
