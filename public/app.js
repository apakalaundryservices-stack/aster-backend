document.documentElement.classList.add("js");

const currency = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 });
const imageDirectory = "/images/";
let revealObserver = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function showMessage(element, message, kind = "info") {
  if (!element) return;
  element.textContent = message;
  element.dataset.kind = kind;
}

async function requestJson(url, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...headers },
    ...rest
  });
  const result = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(result?.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return result;
}

function setDefaultDates() {
  const today = new Date();
  const checkInDate = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  const checkOutDate = new Date(checkInDate.getTime() + 24 * 60 * 60 * 1000);
  const dateValue = (date) => date.toISOString().slice(0, 10);
  const earliest = dateValue(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())));
  document.querySelectorAll('input[type="date"][name="checkIn"]').forEach((input) => {
    input.min = earliest;
    if (!input.value) input.value = dateValue(checkInDate);
  });
  document.querySelectorAll('input[type="date"][name="checkOut"]').forEach((input) => {
    input.min = input.form?.elements.namedItem("checkIn")?.value
      ? dateValue(new Date(new Date(`${input.form.elements.namedItem("checkIn").value}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000))
      : dateValue(checkOutDate);
    if (!input.value) input.value = dateValue(checkOutDate);
  });
}

function roomImage(room) {
  return room.images?.[0]?.url || room.image?.url || `${imageDirectory}room-bedroom-01.jpg`;
}

function roomAlt(room) {
  return room.images?.[0]?.alt || room.image?.alt || `Bedroom photograph for ${room.name}`;
}

function renderRoomCard(room, action = "details", index = 0) {
  const image = escapeHtml(roomImage(room));
  const revealDirection = index % 2 === 0 ? "reveal-from-left" : "reveal-from-right";
  const details = [
    `${room.bedCount || 1} bed${room.bedCount === 1 ? "" : "s"} · ${room.bedType || "Bed details to confirm"}`,
    `${room.maxGuests} guest${room.maxGuests === 1 ? "" : "s"} max`,
    room.sizeSqm ? `${room.sizeSqm} m²` : "Size to confirm"
  ];
  const button = action === "book"
    ? `<button class="button button-small" type="button" data-book-room="${escapeHtml(room.id)}">Select room</button>`
    : `<a class="button button-small" href="/booking.html">View details</a>`;
  return `<article class="room-card reveal ${revealDirection}" data-room-type="${escapeHtml(room.roomType)}">
    <div class="room-card-image"><img src="${image}" alt="${escapeHtml(roomAlt(room))}" loading="lazy">${room.ownerConfirmed ? "" : '<span class="unverified-tag">Needs confirmation</span>'}</div>
    <div class="room-card-body">
      <h3>${escapeHtml(room.name)}</h3>
      <p>${escapeHtml(room.description)}</p>
      <div class="room-facts">${details.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>
      <div class="room-rate">${room.ownerConfirmed ? `${currency.format(room.nightlyRate)} <span>/ night</span>` : "Rate to be confirmed"}</div>
      ${button}
    </div>
  </article>`;
}

async function loadRooms() {
  const rooms = await requestJson("/api/rooms");
  const seasonalRate = document.querySelector("[data-seasonal-rate]");
  const confirmedRates = rooms
    .filter((room) => room.ownerConfirmed && Number.isFinite(Number(room.nightlyRate)) && Number(room.nightlyRate) > 0)
    .map((room) => Number(room.nightlyRate));
  if (seasonalRate && confirmedRates.length) {
    seasonalRate.textContent = `Confirmed room rates from ${currency.format(Math.min(...confirmedRates))} per night. Ask us for festive-date pricing.`;
  }
  const homeList = document.querySelector("#home-rooms");
  if (homeList) {
    homeList.innerHTML = rooms.length
      ? rooms.slice(0, 3).map((room, index) => renderRoomCard(room, "details", index)).join("")
      : '<p class="empty-state">Contact us to find a room option for your dates.</p>';
    revealElements(homeList);
  }
  const allList = document.querySelector("#all-rooms");
  if (allList) {
    allList.dataset.roomsLoaded = "true";
    allList.innerHTML = rooms.length
      ? rooms.map((room, index) => renderRoomCard(room, "details", index)).join("")
      : '<p class="empty-state">Contact us to find a room option for your dates.</p>';
    revealElements(allList);
  }
}

async function loadOffers() {
  const section = document.querySelector("#offers");
  const target = document.querySelector("#home-offers");
  if (!section || !target) return;
  try {
    const offers = await requestJson("/api/offers");
    if (!offers.length) {
      target.innerHTML = '<p class="data-note">No additional owner-confirmed offers are listed. Contact the property for current seasonal pricing.</p>';
      return;
    }
    const shortDate = (value) => new Date(`${value}T00:00:00`).toLocaleDateString("en-KE", { day: "numeric", month: "short" });
    target.innerHTML = offers.map((offer, index) => `<article class="offer-card reveal ${index % 2 === 0 ? "reveal-from-left" : "reveal-from-right"}">
      <span class="offer-discount">${offer.discountPercent}%</span>
      <div><h3>${escapeHtml(offer.title)}</h3><p>${escapeHtml(offer.description)}</p>
        <span class="offer-dates">${shortDate(offer.startDate)} – ${shortDate(offer.endDate)} · Eligible stays</span></div>
    </article>`).join("");
    section.hidden = false;
    revealElements(target);
  } catch (error) {
    target.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    section.hidden = false;
  }
}

function initHeroSlider() {
  const hero = document.querySelector(".hero");
  const slides = [...document.querySelectorAll(".hero-slide")];
  if (!hero || slides.length < 2) return;

  const dots = [...hero.querySelectorAll("[data-hero-slide]")];
  let activeIndex = 0;
  let timer = null;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  const showSlide = (index) => {
    activeIndex = (index + slides.length) % slides.length;
    slides.forEach((slide, slideIndex) => slide.classList.toggle("is-active", slideIndex === activeIndex));
    dots.forEach((dot, dotIndex) => dot.setAttribute("aria-current", String(dotIndex === activeIndex)));
  };
  const stop = () => {
    if (timer) window.clearInterval(timer);
    timer = null;
  };
  const start = () => {
    stop();
    if (!reducedMotion.matches && !document.hidden) {
      timer = window.setInterval(() => showSlide(activeIndex + 1), 6500);
    }
  };

  hero.querySelector("[data-hero-previous]")?.addEventListener("click", () => { showSlide(activeIndex - 1); start(); });
  hero.querySelector("[data-hero-next]")?.addEventListener("click", () => { showSlide(activeIndex + 1); start(); });
  dots.forEach((dot) => dot.addEventListener("click", () => {
    showSlide(Number(dot.dataset.heroSlide));
    start();
  }));
  hero.addEventListener("mouseenter", stop);
  hero.addEventListener("mouseleave", start);
  hero.addEventListener("focusin", stop);
  hero.addEventListener("focusout", (event) => {
    if (!hero.contains(event.relatedTarget)) start();
  });
  document.addEventListener("visibilitychange", () => document.hidden ? stop() : start());
  reducedMotion.addEventListener?.("change", start);
  start();
}

function initChristmasCountdown() {
  const countdown = document.querySelector("[data-christmas-countdown]");
  if (!countdown) return;
  const now = new Date();
  let year = now.getFullYear();
  if (now >= new Date(year, 11, 25)) year += 1;
  const christmas = new Date(year, 11, 25);
  const yearLabel = document.querySelector("[data-christmas-year]");
  if (yearLabel) yearLabel.textContent = String(year);
  countdown.setAttribute("aria-label", `Countdown to Christmas ${year}`);

  const fields = {
    days: countdown.querySelector("[data-countdown-days]"),
    hours: countdown.querySelector("[data-countdown-hours]"),
    minutes: countdown.querySelector("[data-countdown-minutes]"),
    seconds: countdown.querySelector("[data-countdown-seconds]")
  };
  const update = () => {
    const remaining = Math.max(0, christmas.getTime() - Date.now());
    const totalSeconds = Math.floor(remaining / 1000);
    fields.days.textContent = String(Math.floor(totalSeconds / 86400));
    fields.hours.textContent = String(Math.floor(totalSeconds % 86400 / 3600)).padStart(2, "0");
    fields.minutes.textContent = String(Math.floor(totalSeconds % 3600 / 60)).padStart(2, "0");
    fields.seconds.textContent = String(totalSeconds % 60).padStart(2, "0");
  };
  update();
  window.setInterval(update, 1000);
}

function initRoomFilters() {
  document.querySelectorAll("[data-room-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      const filter = button.dataset.roomFilter;
      document.querySelectorAll("[data-room-filter]").forEach((item) => {
        item.setAttribute("aria-pressed", String(item === button));
      });
      document.querySelectorAll("#all-rooms .room-card").forEach((card) => {
        card.hidden = filter !== "ALL" && card.dataset.roomType !== filter;
      });
    });
  });
}

function initQuickSearch() {
  const form = document.querySelector("#quick-search");
  if (!form) return;
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const query = new URLSearchParams({
      checkIn: data.get("checkIn"),
      checkOut: data.get("checkOut"),
      guests: data.get("guests")
    });
    window.location.href = `/booking.html?${query.toString()}`;
  });
}

function initLightbox() {
  const triggers = [...document.querySelectorAll("[data-lightbox]")];
  if (!triggers.length) return;
  let dialog = document.querySelector("#lightbox");
  if (!dialog) {
    dialog = document.createElement("dialog");
    dialog.id = "lightbox";
    dialog.className = "lightbox";
    dialog.setAttribute("aria-label", "Photo viewer");
    dialog.innerHTML = '<button class="lightbox-close" type="button" aria-label="Close photo">×</button><img alt="">';
    document.body.append(dialog);
  }
  const image = dialog.querySelector("img");
  const closeButton = dialog.querySelector(".lightbox-close");
  let currentIndex = 0;
  const show = (index) => {
    currentIndex = (index + triggers.length) % triggers.length;
    image.src = triggers[currentIndex].dataset.lightbox;
    image.alt = triggers[currentIndex].dataset.alt || "";
    if (!dialog.open) dialog.showModal();
  };
  triggers.forEach((trigger, index) => trigger.addEventListener("click", () => show(index)));
  closeButton.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      dialog.close();
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      show(currentIndex + 1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      show(currentIndex - 1);
    }
  });
}

async function initGoogleReviews() {
  const target = document.querySelector("#google-reviews-list");
  if (!target) return;
  try {
    const reviews = await requestJson("/api/reviews");
    const googleReviews = reviews.filter((review) => String(review.source || "").toLowerCase().includes("google"));
    target.innerHTML = googleReviews.length
      ? googleReviews.map((review, index) => {
        const rating = Math.min(5, Math.max(1, Number(review.rating) || 1));
        const direction = index % 2 === 0 ? "reveal-from-left" : "reveal-from-right";
        return `<article class="review-card reveal ${direction}">
          <p class="review-stars" aria-label="${rating} out of 5 stars">${"★".repeat(rating)}${"☆".repeat(5 - rating)}</p>
          <blockquote>${escapeHtml(review.text)}</blockquote>
          <p class="review-author">${escapeHtml(review.guestName)}</p>
          <p class="review-source">Google review</p>
        </article>`;
      }).join("")
      : '<p class="empty-state">No verified Google reviews have been published on this website yet.</p>';
    revealElements(target);
    initReviewCarousel(target);
  } catch (error) {
    target.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
  }
}

function initReviewCarousel(target) {
  const cards = [...target.querySelectorAll(".review-card")];
  const carousel = target.closest(".review-carousel");
  const controls = carousel?.querySelector(".review-controls");
  const dotsContainer = carousel?.querySelector("[data-review-dots]");
  const previous = carousel?.querySelector("[data-review-previous]");
  const next = carousel?.querySelector("[data-review-next]");
  const playback = carousel?.querySelector("[data-review-playback]");
  const announcement = carousel?.querySelector("#review-announcement");
  if (!carousel || !controls || !dotsContainer || !previous || !next || !playback || cards.length < 2) return;

  target.setAttribute("aria-live", "off");
  cards.forEach((card, index) => {
    card.setAttribute("role", "group");
    card.setAttribute("aria-roledescription", "slide");
    card.setAttribute("aria-label", `Review ${index + 1} of ${cards.length}`);
  });
  dotsContainer.innerHTML = cards.map((card, index) => `<button class="review-dot" type="button" aria-label="Show review ${index + 1}" aria-current="${index === 0}"></button>`).join("");
  const dots = [...dotsContainer.querySelectorAll(".review-dot")];
  controls.hidden = false;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let activeIndex = 0;
  let timer = null;
  let paused = reducedMotion.matches;
  const stop = () => {
    if (timer) window.clearInterval(timer);
    timer = null;
  };
  const show = (index, shouldAnnounce = false) => {
    activeIndex = (index + cards.length) % cards.length;
    target.style.transform = `translateX(-${activeIndex * 100}%)`;
    cards.forEach((card, cardIndex) => card.setAttribute("aria-hidden", String(cardIndex !== activeIndex)));
    dots.forEach((dot, dotIndex) => dot.setAttribute("aria-current", String(dotIndex === activeIndex)));
    if (shouldAnnounce && announcement) {
      const author = cards[activeIndex].querySelector(".review-author")?.textContent || "";
      announcement.textContent = `Review ${activeIndex + 1} of ${cards.length}${author ? ` by ${author}` : ""}.`;
    }
  };
  const start = () => {
    stop();
    if (!paused && !reducedMotion.matches && !document.hidden) {
      timer = window.setInterval(() => show(activeIndex + 1), 6500);
    }
  };
  const setPaused = (value) => {
    paused = value || reducedMotion.matches;
    playback.disabled = reducedMotion.matches;
    playback.textContent = reducedMotion.matches ? "Autoplay off" : paused ? "Play reviews" : "Pause reviews";
    playback.setAttribute("aria-pressed", String(paused));
    if (paused) stop();
    else start();
  };

  previous.addEventListener("click", () => { show(activeIndex - 1, true); start(); });
  next.addEventListener("click", () => { show(activeIndex + 1, true); start(); });
  dots.forEach((dot, index) => dot.addEventListener("click", () => { show(index, true); start(); }));
  playback.addEventListener("click", () => setPaused(!paused));
  carousel.addEventListener("mouseenter", stop);
  carousel.addEventListener("mouseleave", start);
  carousel.addEventListener("focusin", stop);
  carousel.addEventListener("focusout", (event) => {
    if (!carousel.contains(event.relatedTarget)) start();
  });
  document.addEventListener("visibilitychange", () => document.hidden ? stop() : start());
  reducedMotion.addEventListener?.("change", (event) => setPaused(event.matches));
  show(0);
  setPaused(paused);
}

function initNavigation() {
  const toggle = document.querySelector(".menu-toggle");
  const navigation = document.querySelector("#primary-nav");
  if (!toggle || !navigation) return;
  const backdrop = document.querySelector(".nav-backdrop");
  const mobileNavigation = window.matchMedia("(max-width: 720px)");

  const syncNavigationMode = () => {
    navigation.inert = mobileNavigation.matches && !navigation.classList.contains("is-open");
  };
  const closeMenu = () => {
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open menu");
    navigation.classList.remove("is-open");
    backdrop.hidden = true;
    document.body.classList.remove("nav-open");
    syncNavigationMode();
  };
  toggle.addEventListener("click", () => {
    const expanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!expanded));
    toggle.setAttribute("aria-label", expanded ? "Open menu" : "Close menu");
    navigation.classList.toggle("is-open", !expanded);
    backdrop.hidden = expanded;
    document.body.classList.toggle("nav-open", !expanded);
    syncNavigationMode();
  });
  backdrop?.addEventListener("click", closeMenu);
  navigation.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMenu();
  });
  mobileNavigation.addEventListener("change", closeMenu);
  syncNavigationMode();
}

function initTheme() {
  const toggle = document.querySelector("[data-theme-toggle]");
  if (!toggle) return;
  const label = toggle.querySelector("[data-theme-label]");
  const sync = () => {
    const darkMode = document.documentElement.dataset.theme === "dark";
    toggle.setAttribute("aria-pressed", String(darkMode));
    toggle.setAttribute("aria-label", `Switch to ${darkMode ? "light" : "dark"} mode`);
    if (label) label.textContent = darkMode ? "Light mode" : "Dark mode";
  };

  toggle.addEventListener("click", () => {
    const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem("aster-theme", theme);
    } catch (error) {
      console.error("Unable to save the theme preference.", error);
    }
    sync();
  });
  sync();
}

function initChatbot() {
  const widget = document.createElement("aside");
  widget.className = "guest-chat";
  widget.innerHTML = `
    <section class="chat-panel" id="guest-chat-panel" aria-label="Aster Suites assistant" hidden>
      <header class="chat-header">
        <div><h2>Aster Suites assistant</h2><p>Room options, prices and bookings</p></div>
        <button class="chat-close" type="button" aria-label="Close chat">×</button>
      </header>
      <div class="chat-messages" role="log" aria-live="polite" aria-relevant="additions text">
        <p class="chat-message chat-message-assistant">Hello! Ask me about room options, prices, offers or the property location.</p>
      </div>
      <div class="chat-prompts" aria-label="Common questions">
        <button type="button" data-chat-prompt="Do you have rooms available?">Room availability</button>
        <button type="button" data-chat-prompt="What are your room prices?">Room prices</button>
        <button type="button" data-chat-prompt="What offers do you have?">Offers</button>
      </div>
      <form class="chat-form">
        <label class="chat-visually-hidden" for="guest-chat-input">Ask Aster Suites a question</label>
        <input id="guest-chat-input" name="question" type="text" maxlength="300" placeholder="Ask about rooms or prices" required>
        <button class="button button-small" type="submit">Send</button>
      </form>
      <a class="chat-booking-link" href="/booking.html">Check dates and book</a>
    </section>
    <button class="chat-launcher" type="button" aria-expanded="false" aria-controls="guest-chat-panel">
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 3.5h14A2.5 2.5 0 0 1 21.5 6v8a2.5 2.5 0 0 1-2.5 2.5h-7.75L5 20v-3.5H5A2.5 2.5 0 0 1 2.5 14V6A2.5 2.5 0 0 1 5 3.5Zm0 1.5C4.17 5 3.5 5.67 3.5 6v8c0 .83.67 1.5 1.5 1.5h1.5v1.38l4.2-3.38H19c.83 0 1.5-.67 1.5-1.5V6c0-.83-.67-1.5-1.5-1.5H5Z"/><path d="M7 8h10v1.5H7zm0 3h7v1.5H7z"/></svg>
      <span>Ask us</span>
    </button>`;

  document.body.append(widget);
  const panel = widget.querySelector(".chat-panel");
  const launcher = widget.querySelector(".chat-launcher");
  const closeButton = widget.querySelector(".chat-close");
  const input = widget.querySelector("#guest-chat-input");
  const form = widget.querySelector(".chat-form");
  const sendButton = form.querySelector('button[type="submit"]');
  const messages = widget.querySelector(".chat-messages");
  let roomRequest;
  let offerRequest;

  const addMessage = (role, text) => {
    const message = document.createElement("p");
    message.className = `chat-message chat-message-${role}`;
    message.textContent = text;
    messages.append(message);
    messages.scrollTop = messages.scrollHeight;
  };
  const loadRooms = async () => {
    if (!roomRequest) roomRequest = requestJson("/api/rooms");
    try {
      return await roomRequest;
    } catch (error) {
      roomRequest = null;
      throw error;
    }
  };
  const loadOffers = async () => {
    if (!offerRequest) offerRequest = requestJson("/api/offers");
    try {
      return await offerRequest;
    } catch (error) {
      offerRequest = null;
      throw error;
    }
  };
  const answer = async (question) => {
    const text = question.toLowerCase();
    const dates = question.match(/\b(20\d{2}-\d{2}-\d{2})\s+(?:to|through|until|[-–])\s+(20\d{2}-\d{2}-\d{2})\b/i);
    if (dates) {
      const guestCount = text.match(/\b(\d{1,2})\s*(?:guests?|adults?)\b/);
      const query = new URLSearchParams({ checkIn: dates[1], checkOut: dates[2], guests: guestCount?.[1] || "1" });
      const availability = await requestJson(`/api/availability?${query}`);
      const rooms = availability.rooms.filter((room) => room.available > 0);
      if (!rooms.length) return `I couldn't find a confirmed room for ${dates[1]} to ${dates[2]}. Try different dates or contact the property to check other options.`;
      const rates = rooms.slice(0, 3).map((room) => `${room.name}: ${currency.format(room.nightlyRate)} per night${room.offer ? ` with ${room.offer.discountPercent}% off` : ""}`);
      return `Yes, these room options are available for ${dates[1]} to ${dates[2]}: ${rates.join("; ")}. Availability can change until your booking is confirmed.`;
    }
    if (/price|rate|cost|how much|pricing/.test(text)) {
      const rooms = await loadRooms();
      const pricedRooms = rooms.filter((room) => room.ownerConfirmed && Number.isInteger(room.nightlyRate));
      if (!pricedRooms.length) return "The property team is still confirming current room prices. I won't quote an unconfirmed rate. Please contact us for a current quote.";
      const rates = pricedRooms.map((room) => `${room.name}: ${currency.format(room.nightlyRate)} per night`);
      return `Confirmed room rates: ${rates.join("; ")}. Final availability and any date-specific offer are shown when you check your dates.`;
    }
    if (/offer|discount|deal/.test(text)) {
      const offers = await loadOffers();
      if (!offers.length) return "There are no current offers listed. Check back later or contact the property about your dates.";
      return `Current and upcoming offers: ${offers.map((offer) => `${offer.title} (${offer.discountPercent}% off, ${offer.startDate} to ${offer.endDate})`).join("; ")}.`;
    }
    if (/available|availability|vacan|room/.test(text)) {
      const rooms = await loadRooms();
      if (!rooms.length) return "I don't have any room listings to show right now. Please contact the property team for help.";
      if (rooms.some((room) => room.ownerConfirmed)) {
        return "Yes, there are room options listed. Exact availability depends on your dates; check them to see live availability and prices.";
      }
      return "Yes, there are room options to explore. The team is confirming the current room details; check your dates or contact us before booking.";
    }
    if (/location|address|where|directions/.test(text)) {
      return "Aster Suites is in Awasi, Kisumu. The supplied address is R3PG+6VQ, Awasi. Please confirm the exact pin with the property before travelling.";
    }
    if (/amenit|wifi|wi-fi|parking|breakfast|pool|facility/.test(text)) {
      return "The property team can confirm which amenities are available for your stay. Contact us so we don't promise an unverified service.";
    }
    if (/book|reservation|booking|date/.test(text)) {
      return "Use the booking page to choose your dates, see confirmed room options and current rates, and request a reservation.";
    }
    if (/hello|hi\b|hey\b|help/.test(text)) {
      return "Hello! I can help with room availability, confirmed rates, offers, location or booking.";
    }
    return "I can help with room availability, prices, offers, location or booking. Try one of the quick questions below.";
  };

  const sendQuestion = async (question) => {
    const trimmed = question.trim();
    if (!trimmed || sendButton.disabled) return;
    addMessage("guest", trimmed);
    input.value = "";
    input.disabled = true;
    sendButton.disabled = true;
    try {
      addMessage("assistant", await answer(trimmed));
    } catch (error) {
      const message = error.status === 400
        ? error.message
        : "I couldn't load current room information. Please check availability or contact the property directly.";
      addMessage("assistant", message);
    } finally {
      input.disabled = false;
      sendButton.disabled = false;
      input.focus();
    }
  };

  launcher.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    launcher.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) input.focus();
  });
  closeButton.addEventListener("click", () => {
    panel.hidden = true;
    launcher.setAttribute("aria-expanded", "false");
    launcher.focus();
  });
  widget.querySelectorAll("[data-chat-prompt]").forEach((button) => {
    button.addEventListener("click", () => sendQuestion(button.dataset.chatPrompt));
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    sendQuestion(input.value);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !panel.hidden) {
      panel.hidden = true;
      launcher.setAttribute("aria-expanded", "false");
      launcher.focus();
    }
  });
}

async function initCustomerAccount() {
  const account = document.querySelector("#customer-account");
  if (!account) return;

  const signInLink = document.querySelector("#google-sign-in");
  const message = document.querySelector("#customer-account-message");
  const details = document.querySelector("#customer-account-details");
  const query = new URLSearchParams(window.location.search);
  const signInResult = query.get("signin");
  if (signInResult) {
    const messages = {
      success: ["Google sign-in complete. Your guest account is ready.", "success"],
      setup: ["Google sign-in will be available once the property connects its Google account.", "info"],
      cancelled: ["Google sign-in was cancelled.", "info"],
      invalid: ["The sign-in link expired. Please start again.", "error"]
    };
    const [text, kind] = messages[signInResult] || ["Google sign-in could not be completed. Please try again.", "error"];
    showMessage(message, text, kind);
    window.history.replaceState({}, "", `${window.location.pathname}${window.location.hash}`);
  }

  try {
    let customer = null;
    try {
      customer = (await requestJson("/api/auth/customer")).user;
    } catch (error) {
      if (error.status !== 401) throw error;
    }

    const googleStatus = await requestJson("/api/auth/google/status");
    if (customer) {
      signInLink.hidden = true;
      if (!signInResult) showMessage(message, `Signed in as ${customer.email}.`, "success");
      const avatar = escapeHtml(customer.name.trim().charAt(0).toUpperCase() || "G");
      details.innerHTML = `<div class="customer-profile"><span class="customer-avatar" aria-hidden="true">${avatar}</span>
        <div><strong>${escapeHtml(customer.name)}</strong><br><small>${escapeHtml(customer.email)}</small></div></div>
        <button class="button button-outline button-small" type="button" id="customer-sign-out">Sign out</button>
        <div class="customer-bookings" id="customer-bookings"><p class="loading-note">Loading your reservations…</p></div>`;
      const guestName = document.querySelector("#guest-name");
      const guestEmail = document.querySelector("#guest-email");
      if (guestName && !guestName.value) guestName.value = customer.name;
      if (guestEmail && !guestEmail.value) guestEmail.value = customer.email;

      const bookings = await requestJson("/api/auth/customer/bookings");
      const bookingsTarget = document.querySelector("#customer-bookings");
      bookingsTarget.innerHTML = bookings.length
        ? bookings.map((booking) => `<div class="customer-booking-row">
            <div><strong>${escapeHtml(booking.reference)}</strong><br><small>${escapeHtml(booking.room)} · ${escapeHtml(booking.checkIn)} to ${escapeHtml(booking.checkOut)}</small></div>
            <span class="status-pill" data-status="${escapeHtml(booking.status)}">${escapeHtml(booking.status)}</span>
          </div>`).join("")
        : '<p class="data-note">Reservations made while signed in will appear here.</p>';
      details.querySelector("#customer-sign-out").addEventListener("click", async (event) => {
        event.currentTarget.disabled = true;
        try {
          await requestJson("/api/auth/customer/logout", { method: "POST" });
          window.location.reload();
        } catch (error) {
          event.currentTarget.disabled = false;
          showMessage(message, error.message, "error");
        }
      });
      return;
    }

    if (!googleStatus.configured) {
      signInLink.removeAttribute("href");
      signInLink.setAttribute("aria-disabled", "true");
      if (!signInResult) showMessage(message, "Google sign-in is being set up. You can still book without an account.", "info");
    } else if (!signInResult) {
      showMessage(message, "Sign in to save your guest details and reservations.", "info");
    }
  } catch (error) {
    showMessage(message, error.message, "error");
  }
}

function revealElements(root) {
  const elements = root.querySelectorAll(".reveal:not(.is-visible)");
  if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    elements.forEach((element) => element.classList.add("is-visible"));
    return;
  }
  elements.forEach((element) => revealObserver?.observe(element));
}

function initScrollReveal() {
  document.querySelectorAll(".gallery-grid .gallery-tile, .gallery-preview .gallery-tile").forEach((element, index) => {
    element.classList.add("reveal", index % 2 === 0 ? "reveal-from-left" : "reveal-from-right");
  });
  document.querySelectorAll(".image-frame.reveal:not(.reveal-from-left):not(.reveal-from-right)").forEach((element) => element.classList.add("reveal-from-right"));
  if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    document.querySelectorAll(".reveal").forEach((element) => element.classList.add("is-visible"));
    return;
  }
  revealObserver = new IntersectionObserver((entries, currentObserver) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("is-visible");
        currentObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  revealElements(document);
}

function initAvailability() {
  const form = document.querySelector("#availability-form");
  if (!form) return;
  const params = new URLSearchParams(window.location.search);
  for (const name of ["checkIn", "checkOut", "guests"]) {
    const value = params.get(name);
    const field = form.elements.namedItem(name);
    if (value && field) field.value = value;
  }
  const results = document.querySelector("#availability-results");
  const feedback = document.querySelector("#availability-message");
  const bookingForm = document.querySelector("#booking-form");
  const roomSelect = document.querySelector("#booking-room");
  const bookFeedback = document.querySelector("#booking-message");
  const bookingResult = document.querySelector("#booking-result");
  const paymentSelect = document.querySelector("#payment-method");
  let config = { paymentMode: "BOTH" };

  requestJson("/api/site-config").then((value) => {
    config = value;
    if (config.paymentMode === "CASH_ONLY") paymentSelect.querySelector('option[value="MPESA"]').disabled = true;
    if (config.paymentMode === "MPESA") {
      paymentSelect.querySelector('option[value="CASH"]').disabled = true;
      paymentSelect.value = "MPESA";
    }
  }).catch((error) => showMessage(feedback, error.message, "error"));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const query = new URLSearchParams({
      checkIn: data.get("checkIn"),
      checkOut: data.get("checkOut"),
      guests: data.get("guests")
    });
    showMessage(feedback, "Checking availability…");
    results.innerHTML = "";
    bookingForm.hidden = true;
    try {
      const availability = await requestJson(`/api/availability?${query}`);
      const availableRooms = availability.rooms.filter((room) => room.available > 0);
      if (!availableRooms.length) {
        showMessage(feedback, "No rooms are available for those dates and guest count. Contact the property to confirm.", "info");
        results.innerHTML = '<p class="empty-state">No confirmed room options are available for those dates.</p>';
        return;
      }
      showMessage(feedback, `${availability.nights} night${availability.nights === 1 ? "" : "s"} · ${availableRooms.length} room option${availableRooms.length === 1 ? "" : "s"} available.`, "success");
      results.innerHTML = availableRooms.map((room) => `
        <article class="booking-result">
          <div><h3>${escapeHtml(room.name)}</h3><p>${escapeHtml(room.bedType)} · up to ${room.maxGuests} guests · ${room.available} of ${room.total} rooms available</p>
            ${room.offer ? `<p class="booking-offer-note">${escapeHtml(room.offer.title)} · ${room.offer.discountPercent}% off</p>` : ""}</div>
          <div class="booking-result-actions">${room.offer ? `<del>${currency.format(room.originalNightlyRate)} / night</del>` : ""}
            <strong>${currency.format(room.nightlyRate)} / night</strong><button class="button button-small" type="button" data-book-room="${escapeHtml(room.id)}">Select</button></div>
        </article>`).join("");
      const checkIn = document.querySelector("#booking-checkin");
      const checkOut = document.querySelector("#booking-checkout");
      const guestCount = document.querySelector("#booking-guests");
      checkIn.value = data.get("checkIn");
      checkOut.value = data.get("checkOut");
      guestCount.value = data.get("guests");
      roomSelect.innerHTML = availableRooms.map((room) => `<option value="${escapeHtml(room.id)}">${escapeHtml(room.name)} · ${currency.format(room.nightlyRate)} / night${room.offer ? ` · ${room.offer.discountPercent}% off` : ""}</option>`).join("");
      bookingForm.hidden = false;
      results.querySelectorAll("[data-book-room]").forEach((button) => button.addEventListener("click", () => {
        roomSelect.value = button.dataset.bookRoom;
        bookingForm.scrollIntoView({ behavior: "smooth", block: "start" });
        document.querySelector("#guest-name").focus({ preventScroll: true });
      }));
    } catch (error) {
      showMessage(feedback, error.message, "error");
    }
  });

  bookingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(bookingForm);
    const payload = Object.fromEntries(formData.entries());
    payload.guests = Number(payload.guests);
    showMessage(bookFeedback, "Creating your reservation…");
    bookingResult.hidden = true;
    try {
      const booking = await requestJson("/api/bookings", { method: "POST", body: JSON.stringify(payload) });
      let paymentMessage = booking.paymentMethod === "CASH"
        ? "Reservation confirmed. Cash collection must be recorded by staff."
        : "Reservation held for 15 minutes while payment is pending.";
      if (booking.paymentMethod === "MPESA") {
        try {
          const payment = await requestJson("/api/payments/mpesa/stk-push", {
            method: "POST",
            body: JSON.stringify({ reference: booking.reference, phone: payload.phone })
          });
          paymentMessage = payment.message;
        } catch (error) {
          paymentMessage = `Reservation ${booking.reference} was created, but the sandbox payment prompt failed: ${error.message}`;
        }
      }
      bookingResult.innerHTML = `<h3>Reference: ${escapeHtml(booking.reference)}</h3>
        <p><strong>Status:</strong> <span class="status-pill" data-status="${escapeHtml(booking.status)}">${escapeHtml(booking.status)}</span></p>
        <p><strong>Room:</strong> ${escapeHtml(booking.room)}</p>
        <p><strong>Dates:</strong> ${escapeHtml(booking.checkIn)} to ${escapeHtml(booking.checkOut)} (${booking.nights} nights)</p>
        ${booking.offerTitle ? `<p><strong>Offer:</strong> ${escapeHtml(booking.offerTitle)} (${booking.offerDiscountPercent}% off)</p><p><strong>Before discount:</strong> ${currency.format(booking.subtotalAmount)} ${escapeHtml(booking.currency)}</p><p><strong>Discount:</strong> −${currency.format(booking.discountAmount)} ${escapeHtml(booking.currency)}</p>` : ""}
        <p><strong>Total:</strong> ${currency.format(booking.totalAmount)} ${escapeHtml(booking.currency)}</p>
        ${booking.customerLinked ? "<p>This reservation is linked to your guest account.</p>" : ""}
        <p>${escapeHtml(paymentMessage)}</p>
        <p>Save the reference and use the booking lookup form to check its status.</p>`;
      bookingResult.hidden = false;
      showMessage(bookFeedback, "Reservation response received.", "success");
    } catch (error) {
      showMessage(bookFeedback, error.message, "error");
    }
  });
}

function initBookingLookup() {
  const form = document.querySelector("#lookup-form");
  if (!form) return;
  const feedback = document.querySelector("#lookup-message");
  const result = document.querySelector("#lookup-result");
  let lastLookup = null;
  const lookup = async () => {
    const data = Object.fromEntries(new FormData(form).entries());
    showMessage(feedback, "Looking up your booking…");
    result.hidden = true;
    try {
      lastLookup = await requestJson("/api/bookings/lookup", { method: "POST", body: JSON.stringify(data) });
      const canCancel = ["PENDING", "CONFIRMED"].includes(lastLookup.status) && !lastLookup.payments.some((payment) => payment.status === "SUCCESS");
      result.innerHTML = `<h3>Booking ${escapeHtml(lastLookup.reference)}</h3>
        <p><strong>Guest:</strong> ${escapeHtml(lastLookup.guestName)}</p>
        <p><strong>Room:</strong> ${escapeHtml(lastLookup.room)}</p>
        <p><strong>Dates:</strong> ${escapeHtml(lastLookup.checkIn)} to ${escapeHtml(lastLookup.checkOut)}</p>
        <p><strong>Status:</strong> <span class="status-pill" data-status="${escapeHtml(lastLookup.status)}">${escapeHtml(lastLookup.status)}</span></p>
        <p><strong>Total:</strong> ${currency.format(lastLookup.totalAmount)} ${escapeHtml(lastLookup.currency)}</p>
        <p><strong>Contact:</strong> ${escapeHtml(lastLookup.phone)} (masked)</p>
        ${canCancel ? '<button class="button button-outline" id="cancel-booking" type="button">Cancel unpaid booking</button>' : ""}`;
      result.hidden = false;
      showMessage(feedback, "Booking details loaded.", "success");
      const cancel = result.querySelector("#cancel-booking");
      if (cancel) cancel.addEventListener("click", async () => {
        if (!window.confirm("Cancel this unpaid booking?")) return;
        try {
          await requestJson("/api/bookings/cancel", { method: "POST", body: JSON.stringify(data) });
          showMessage(feedback, "Booking cancelled.", "success");
          await lookup();
        } catch (error) {
          showMessage(feedback, error.message, "error");
        }
      });
    } catch (error) {
      lastLookup = null;
      showMessage(feedback, error.message, "error");
    }
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    lookup();
  });
}

async function initMeals() {
  const menu = document.querySelector("#meal-menu");
  if (!menu) return;
  const choices = document.querySelector("#meal-choices");
  const form = document.querySelector("#meal-order-form");
  const feedback = document.querySelector("#meal-message");
  let meals = [];
  try {
    meals = await requestJson("/api/meals");
    menu.innerHTML = meals.length ? meals.map((meal) => `
      <article class="menu-card"><div><h3>${escapeHtml(meal.name)}</h3><p>${escapeHtml(meal.description)}</p></div>
      <strong>${currency.format(meal.price)}</strong></article>`).join("") : '<p class="empty-state">No confirmed menu items are available yet.</p>';
    choices.innerHTML = meals.length ? meals.map((meal) => `
      <label class="meal-choice"><input type="checkbox" name="meal" value="${escapeHtml(meal.id)}">
        <span>${escapeHtml(meal.name)} — ${currency.format(meal.price)}</span>
        <input type="number" name="quantity-${escapeHtml(meal.id)}" min="1" max="20" value="1" aria-label="Quantity for ${escapeHtml(meal.name)}"></label>`).join("") : "<p>No menu items are available.</p>";
  } catch (error) {
    menu.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    choices.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    return;
  }
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const items = data.getAll("meal").map((mealId) => ({
      mealId,
      quantity: Number(data.get(`quantity-${mealId}`))
    }));
    if (!items.length) return showMessage(feedback, "Choose at least one menu item.", "error");
    try {
      const order = await requestJson("/api/meal-orders", {
        method: "POST",
        body: JSON.stringify({
          reference: data.get("reference"),
          phone: data.get("phone"),
          notes: data.get("notes"),
          items
        })
      });
      showMessage(feedback, `Meal request ${order.reference} received. Estimated total: ${currency.format(order.total)}; staff confirmation is still required.`, "success");
      form.reset();
    } catch (error) {
      showMessage(feedback, error.message, "error");
    }
  });
}

function initContactForms() {
  const contactForm = document.querySelector("#contact-form");
  if (contactForm) contactForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const feedback = document.querySelector("#contact-feedback");
    const data = Object.fromEntries(new FormData(contactForm).entries());
    if (!String(data.email || "").trim() && !String(data.phone || "").trim()) {
      showMessage(feedback, "Add an email address or phone number so the team can reply.", "error");
      contactForm.querySelector("#contact-email").focus();
      return;
    }
    const submitButton = contactForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    contactForm.setAttribute("aria-busy", "true");
    showMessage(feedback, "Sending your message…");
    try {
      const result = await requestJson("/api/contact-messages", { method: "POST", body: JSON.stringify(data) });
      contactForm.reset();
      showMessage(feedback, `${result.message} No email is sent automatically, so the team must review it before following up.`, "success");
    } catch (error) {
      showMessage(feedback, error.message, "error");
    } finally {
      submitButton.disabled = false;
      contactForm.removeAttribute("aria-busy");
    }
  });

  const serviceForm = document.querySelector("#service-form");
  if (serviceForm) serviceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const feedback = document.querySelector("#service-feedback");
    const data = Object.fromEntries(new FormData(serviceForm).entries());
    const submitButton = serviceForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    serviceForm.setAttribute("aria-busy", "true");
    showMessage(feedback, "Sending your request…");
    try {
      await requestJson("/api/service-requests", { method: "POST", body: JSON.stringify(data) });
      serviceForm.reset();
      showMessage(feedback, "Your request was saved. Staff follow-up is still required.", "success");
    } catch (error) {
      showMessage(feedback, error.message, "error");
    } finally {
      submitButton.disabled = false;
      serviceForm.removeAttribute("aria-busy");
    }
  });
}

function initYear() {
  document.querySelectorAll("[data-current-year]").forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });
}

function init() {
  initTheme();
  initNavigation();
  initHeroSlider();
  initChristmasCountdown();
  initChatbot();
  initQuickSearch();
  initLightbox();
  initGoogleReviews();
  initScrollReveal();
  initRoomFilters();
  initAvailability();
  initCustomerAccount();
  initBookingLookup();
  initContactForms();
  initYear();
  setDefaultDates();
  loadRooms().catch((error) => {
    document.querySelectorAll("#home-rooms, #all-rooms").forEach((element) => {
      element.innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
    });
    loadOffers();
  });
  initMeals();
}

document.addEventListener("DOMContentLoaded", init);
