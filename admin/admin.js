const panel = document.querySelector("#admin-panel");
const nav = document.querySelector("#admin-nav");
const feedback = document.querySelector("#admin-feedback");
const loginView = document.querySelector("#login-view");
const changePasswordView = document.querySelector("#change-password-view");
const dashboardView = document.querySelector("#dashboard-view");
const logoutButton = document.querySelector("#logout-button");
const dialog = document.querySelector("#admin-dialog");
const dialogTitle = document.querySelector("#dialog-title");
const dialogContent = document.querySelector("#dialog-content");
const loginPassword = document.querySelector("#login-password");
const passwordToggle = document.querySelector("#password-toggle");
let currentUser = null;
let currentView = "overview";

const viewLabels = {
  overview: "Overview",
  bookings: "Bookings",
  calendar: "Calendar",
  rooms: "Rooms",
  offers: "Offers",
  meals: "Meals",
  orders: "Meal orders",
  requests: "Requests & messages",
  payments: "Payments",
  reports: "Reports",
  reviews: "Reviews",
  customers: "Customers",
  users: "Staff users",
  settings: "Settings",
  audit: "Audit log"
};
const staffViews = ["overview", "bookings", "calendar", "rooms", "meals", "orders", "requests", "payments", "reports"];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function setFeedback(message, kind = "success") {
  feedback.textContent = message;
  feedback.dataset.kind = kind;
}

async function api(url, options = {}) {
  const { headers = {}, ...rest } = options;
  const response = await fetch(url, {
    credentials: "same-origin",
    headers: { "content-type": "application/json", ...headers },
    ...rest
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function showLogin(message = "") {
  currentUser = null;
  loginView.hidden = false;
  changePasswordView.hidden = true;
  dashboardView.hidden = true;
  logoutButton.hidden = true;
  if (message) {
    const loginMessage = document.querySelector("#login-message");
    loginMessage.textContent = message;
    loginMessage.dataset.kind = "error";
  }
}

function showPasswordChange(user) {
  currentUser = user;
  loginView.hidden = true;
  changePasswordView.hidden = false;
  dashboardView.hidden = true;
  logoutButton.hidden = false;
}

function showDashboard(user) {
  if (user.mustChangePassword) return showPasswordChange(user);
  currentUser = user;
  loginView.hidden = true;
  changePasswordView.hidden = true;
  dashboardView.hidden = false;
  logoutButton.hidden = false;
  document.querySelector("#user-summary").textContent = `${user.name} · ${user.role}`;
  renderNavigation();
  loadView("overview");
}

function renderNavigation() {
  const views = currentUser.role === "ADMIN" ? Object.keys(viewLabels) : staffViews;
  nav.innerHTML = views.map((view) => `<button class="admin-tab" type="button" data-view="${view}" aria-current="${view === currentView ? "page" : "false"}">${viewLabels[view]}</button>`).join("");
}

function setPanel(title, body) {
  panel.innerHTML = `<section class="admin-panel"><h2>${escapeHtml(title)}</h2>${body}</section>`;
}

function table(headers, rows) {
  return `<div class="table-wrap"><table class="admin-table"><thead><tr>${headers.map((header) => `<th scope="col">${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>${rows || `<tr><td colspan="${headers.length}">No records found.</td></tr>`}</tbody></table></div>`;
}

function money(amount, currency = "KES") {
  return new Intl.NumberFormat("en-KE", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount || 0);
}

function pretty(value) {
  return String(value || "").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function statusOptions(current, possible) {
  const options = [current, ...possible].filter((value, index, list) => list.indexOf(value) === index);
  return options.map((value) => `<option value="${value}" ${value === current ? "selected" : ""}>${escapeHtml(pretty(value))}</option>`).join("");
}

async function loadView(view) {
  if (currentUser.role !== "ADMIN" && !staffViews.includes(view)) return;
  currentView = view;
  renderNavigation();
  setFeedback("");
  try {
    const renderers = {
      overview: renderOverview,
      bookings: renderBookings,
      calendar: renderCalendar,
      rooms: renderRooms,
      offers: renderOffers,
      meals: renderMeals,
      orders: renderOrders,
      requests: renderRequests,
      payments: renderPayments,
      reports: renderReports,
      reviews: renderReviews,
      customers: renderCustomers,
      users: renderUsers,
      settings: renderSettings,
      audit: renderAudit
    };
    await renderers[view]();
  } catch (error) {
    setPanel(viewLabels[view], `<p class="empty-state">${escapeHtml(error.message)}</p>`);
  }
}

async function renderOverview() {
  const data = await api("/api/admin/summary");
  const metrics = [
    ["Arrivals today", data.arrivalsToday],
    ["Active bookings", data.activeBookings],
    ["Pending bookings", data.pendingBookings],
    ["New meal orders", data.newMealOrders],
    ["Open service requests", data.openServiceRequests],
    ["Payments received", money(data.successfulPaymentsKes)]
  ];
  setPanel("Today at Aster Suites", `<div class="metric-grid">${metrics.map(([label, value]) => `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></article>`).join("")}</div>
    <div class="admin-section"><h3>Keep your listings current</h3><p>Review room availability and rates regularly. Online payment connections must be configured before collecting payments online.</p>
    <button class="button button-small" type="button" data-view="bookings">Review bookings</button></div>`);
}

async function renderBookings() {
  setPanel("Bookings", `<form class="admin-filter" id="booking-filter">
    <div class="field"><label for="booking-search">Search ref / guest / phone</label><input id="booking-search" name="search" maxlength="120"></div>
    <div class="field"><label for="booking-status-filter">Status</label><select id="booking-status-filter" name="status"><option value="">All statuses</option>${["PENDING", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "REJECTED"].map((item) => `<option value="${item}">${pretty(item)}</option>`).join("")}</select></div>
    <button class="button button-small" type="submit">Filter</button>
  </form><div id="bookings-table"></div>`);
  const target = document.querySelector("#bookings-table");
  const filter = document.querySelector("#booking-filter");
  const fetchRows = async () => {
    const params = new URLSearchParams(new FormData(filter));
    for (const [key, value] of [...params.entries()]) if (!value) params.delete(key);
    const records = await api(`/api/admin/bookings?${params}`);
    const rows = records.map((booking) => {
      const transitions = {
        PENDING: ["CONFIRMED", "CANCELLED", "REJECTED"],
        CONFIRMED: ["CHECKED_IN", "CANCELLED", "REJECTED"],
        CHECKED_IN: ["CHECKED_OUT"],
        CHECKED_OUT: [],
        CANCELLED: [],
        REJECTED: []
      }[booking.status] || [];
      const paid = booking.payments.filter((payment) => payment.status === "SUCCESS").reduce((sum, payment) => sum + payment.amount, 0);
      const outstanding = Math.max(0, booking.totalAmount - paid);
      const cashAction = outstanding && !["CANCELLED", "REJECTED", "CHECKED_OUT"].includes(booking.status)
        ? `<div class="admin-inline-form"><label class="sr-only" for="cash-${escapeHtml(booking.id)}">Cash amount for ${escapeHtml(booking.reference)}</label><input id="cash-${escapeHtml(booking.id)}" data-cash-amount="${escapeHtml(booking.id)}" type="number" min="1" max="${outstanding}" value="${outstanding}"><button class="button button-outline button-small" type="button" data-action="record-cash" data-id="${escapeHtml(booking.id)}">Record cash</button></div>`
        : "";
      return `<tr><td><strong>${escapeHtml(booking.reference)}</strong><br>${escapeHtml(booking.guestName)}<br><small>${escapeHtml(booking.phone)}</small></td>
        <td>${escapeHtml(booking.room)}<br>${escapeHtml(booking.checkIn)} → ${escapeHtml(booking.checkOut)}<br>${booking.guests} guest(s)</td>
        <td>${money(booking.totalAmount, booking.currency)}${booking.offerTitle ? `<br><small>${escapeHtml(booking.offerTitle)} · ${booking.offerDiscountPercent}% off</small>` : ""}</td>
        <td><span class="status-pill" data-status="${escapeHtml(booking.status)}">${escapeHtml(pretty(booking.status))}</span></td>
        <td><div class="admin-inline-form"><select aria-label="New status for ${escapeHtml(booking.reference)}" data-booking-status="${escapeHtml(booking.id)}">${statusOptions(booking.status, transitions)}</select><button class="button button-small" type="button" data-action="booking-status" data-id="${escapeHtml(booking.id)}">Save</button></div>
        ${cashAction}${currentUser.role === "ADMIN" ? `<button class="button button-outline button-small" type="button" data-action="booking-contact" data-id="${escapeHtml(booking.id)}">Reveal contact</button>` : ""}</td></tr>`;
    }).join("");
    target.innerHTML = table(["Booking", "Room / dates", "Total", "Status", "Actions"], rows);
  };
  filter.addEventListener("submit", (event) => {
    event.preventDefault();
    fetchRows().catch((error) => setFeedback(error.message, "error"));
  });
  await fetchRows();
}

async function renderCalendar() {
  const today = new Date();
  const from = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);
  const dateValue = (date) => date.toISOString().slice(0, 10);
  const params = new URLSearchParams({ from: dateValue(from), to: dateValue(to) });
  const bookings = await api(`/api/admin/calendar?${params}`);
  const days = [];
  for (let cursor = new Date(from); cursor < to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = dateValue(cursor);
    const arrivals = bookings.filter((item) => item.checkIn === date);
    const departures = bookings.filter((item) => item.checkOut === date);
    const staying = bookings.filter((item) => item.checkIn <= date && item.checkOut > date && item.status !== "PENDING");
    days.push(`<tr><td><strong>${escapeHtml(date)}</strong><br>${escapeHtml(new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short" }))}</td>
      <td>${arrivals.map((item) => `${escapeHtml(item.reference)} · ${escapeHtml(item.guestName)} (${escapeHtml(item.room)})`).join("<br>") || "—"}</td>
      <td>${departures.map((item) => `${escapeHtml(item.reference)} · ${escapeHtml(item.guestName)} (${escapeHtml(item.room)})`).join("<br>") || "—"}</td>
      <td>${staying.length}</td></tr>`);
  }
  setPanel("14-day room calendar", `<p>Pending M-Pesa holds appear as arrivals but are not counted as confirmed occupancy.</p>
    ${table(["Date", "Arrivals", "Departures", "Confirmed rooms"], days.join(""))}`);
}

async function renderRooms() {
  const rooms = await api("/api/admin/rooms");
  const cards = rooms.map((room) => currentUser.role === "ADMIN"
    ? `<form class="room-admin-card room-edit" data-id="${escapeHtml(room.id)}">
        <div class="room-admin-heading">
          <div><h3>${escapeHtml(room.name)}</h3><p>${escapeHtml(room.slug)}</p></div>
          <span class="status-pill" data-status="${escapeHtml(room.status)}">${room.ownerConfirmed ? "Published" : "Needs review"}</span>
        </div>
        <div class="admin-form-grid">
          <div class="field"><label for="room-name-${escapeHtml(room.id)}">Room name</label><input id="room-name-${escapeHtml(room.id)}" name="name" value="${escapeHtml(room.name)}" required maxlength="120"></div>
          <div class="field"><label for="room-slug-${escapeHtml(room.id)}">Listing address</label><input id="room-slug-${escapeHtml(room.id)}" name="slug" value="${escapeHtml(room.slug)}" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*"></div>
          <div class="field"><label for="room-type-${escapeHtml(room.id)}">Room type</label><input id="room-type-${escapeHtml(room.id)}" name="roomType" value="${escapeHtml(room.roomType)}" required maxlength="40"></div>
          <div class="field"><label for="room-bed-${escapeHtml(room.id)}">Bed type</label><input id="room-bed-${escapeHtml(room.id)}" name="bedType" value="${escapeHtml(room.bedType)}" required maxlength="80"></div>
          <div class="field"><label for="room-bed-count-${escapeHtml(room.id)}">Beds</label><input id="room-bed-count-${escapeHtml(room.id)}" name="bedCount" type="number" min="1" max="10" value="${room.bedCount}" required></div>
          <div class="field"><label for="room-guests-${escapeHtml(room.id)}">Guest capacity</label><input id="room-guests-${escapeHtml(room.id)}" name="maxGuests" type="number" min="1" max="10" value="${room.maxGuests}" required></div>
          <div class="field"><label for="room-size-${escapeHtml(room.id)}">Floor area (m²)</label><input id="room-size-${escapeHtml(room.id)}" name="sizeSqm" type="number" min="1" value="${room.sizeSqm ?? ""}"></div>
          <div class="field"><label for="room-inventory-${escapeHtml(room.id)}">Available rooms</label><input id="room-inventory-${escapeHtml(room.id)}" name="inventory" type="number" min="0" value="${room.inventory}" required></div>
          <div class="field"><label for="room-rate-${escapeHtml(room.id)}">Nightly rate (KES)</label><input id="room-rate-${escapeHtml(room.id)}" name="nightlyRate" type="number" min="1" value="${room.nightlyRate}" required></div>
          <div class="field"><label for="room-status-${escapeHtml(room.id)}">Listing status</label><select id="room-status-${escapeHtml(room.id)}" name="status"><option value="ACTIVE" ${room.status === "ACTIVE" ? "selected" : ""}>Available</option><option value="INACTIVE" ${room.status === "INACTIVE" ? "selected" : ""}>Hidden</option></select></div>
          <div class="field field-full"><label for="room-description-${escapeHtml(room.id)}">Description</label><textarea id="room-description-${escapeHtml(room.id)}" name="description" maxlength="1000" required>${escapeHtml(room.description)}</textarea></div>
        </div>
        <div class="room-admin-footer">
          <label class="publish-toggle"><input name="ownerConfirmed" type="checkbox" ${room.ownerConfirmed ? "checked" : ""}> Publish this room and its rate on the guest site</label>
          <button class="button button-small" type="submit">Save room</button>
        </div>
      </form>`
    : `<article class="room-admin-card"><div class="room-admin-heading"><div><h3>${escapeHtml(room.name)}</h3><p>${escapeHtml(room.slug)}</p></div>
        <span class="status-pill" data-status="${escapeHtml(room.status)}">${room.ownerConfirmed ? "Published" : "Needs review"}</span></div>
        <p>${escapeHtml(room.description)}</p><p>${escapeHtml(pretty(room.roomType))} · ${escapeHtml(room.bedType)} · up to ${room.maxGuests} guests</p>
        <strong>${room.ownerConfirmed ? `${money(room.nightlyRate)} / night` : "Rate needs confirmation"}</strong>
      </article>`).join("") || '<p class="empty-state">No rooms yet. Add your first room to begin building your listings.</p>';
  setPanel("Rooms & rates", `<p>Set the room details, nightly price, and availability. Publish only after every detail is confirmed.</p>
    ${currentUser.role === "ADMIN" ? `<details class="admin-create-panel">
      <summary>Add a room</summary>
      <form id="create-room-form" class="admin-form-grid">
        <div class="field"><label for="new-room-name">Room name</label><input id="new-room-name" name="name" required maxlength="120"></div>
        <div class="field"><label for="new-room-slug">Listing address</label><input id="new-room-slug" name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*"></div>
        <div class="field"><label for="new-room-type">Room type</label><input id="new-room-type" name="roomType" required maxlength="40"></div>
        <div class="field"><label for="new-room-bed">Bed type</label><input id="new-room-bed" name="bedType" required maxlength="80"></div>
        <div class="field"><label for="new-room-beds">Beds</label><input id="new-room-beds" name="bedCount" type="number" min="1" max="10" value="1" required></div>
        <div class="field"><label for="new-room-guests">Guest capacity</label><input id="new-room-guests" name="maxGuests" type="number" min="1" max="10" value="2" required></div>
        <div class="field"><label for="new-room-inventory">Available rooms</label><input id="new-room-inventory" name="inventory" type="number" min="0" value="1" required></div>
        <div class="field"><label for="new-room-rate">Nightly rate (KES)</label><input id="new-room-rate" name="nightlyRate" type="number" min="1" required></div>
        <div class="field"><label for="new-room-size">Floor area (m²)</label><input id="new-room-size" name="sizeSqm" type="number" min="1"></div>
        <div class="field field-full"><label for="new-room-description">Description</label><textarea id="new-room-description" name="description" maxlength="1000" required></textarea></div>
        <div class="field field-full"><label class="publish-toggle"><input name="ownerConfirmed" type="checkbox"> Publish this room and its rate on the guest site</label></div>
        <div class="field field-full"><button class="button button-small" type="submit">Create room</button></div>
      </form>
    </details>` : ""}
    <div class="room-admin-list">${cards}</div>`);
  panel.querySelectorAll(".room-edit").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    for (const key of ["bedCount", "maxGuests", "inventory", "nightlyRate"]) data[key] = Number(data[key]);
    data.sizeSqm = data.sizeSqm ? Number(data.sizeSqm) : null;
    data.ownerConfirmed = formData.has("ownerConfirmed");
    try {
      await api(`/api/admin/rooms/${form.dataset.id}`, { method: "PATCH", body: JSON.stringify(data) });
      setFeedback("Room updated.");
      await renderRooms();
    } catch (error) { setFeedback(error.message, "error"); }
  }));
  const createForm = panel.querySelector("#create-room-form");
  if (createForm) createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(createForm);
    const data = Object.fromEntries(formData.entries());
    for (const key of ["bedCount", "maxGuests", "inventory", "nightlyRate"]) data[key] = Number(data[key]);
    data.sizeSqm = data.sizeSqm ? Number(data.sizeSqm) : null;
    data.ownerConfirmed = formData.has("ownerConfirmed");
    try {
      await api("/api/admin/rooms", { method: "POST", body: JSON.stringify(data) });
      setFeedback("Room created.");
      await renderRooms();
    } catch (error) { setFeedback(error.message, "error"); }
  });
}

async function renderOffers() {
  const offers = await api("/api/admin/offers");
  const cards = offers.map((offer) => `<form class="offer-admin-card offer-edit" data-id="${escapeHtml(offer.id)}">
      <div class="room-admin-heading"><div><h3>${escapeHtml(offer.title)}</h3><p>${offer.discountPercent}% off room rates</p></div>
        <span class="status-pill" data-status="${offer.active ? "ACTIVE" : "INACTIVE"}">${offer.active ? "Active" : "Paused"}</span></div>
      <div class="admin-form-grid">
        <div class="field"><label for="offer-title-${escapeHtml(offer.id)}">Offer name</label><input id="offer-title-${escapeHtml(offer.id)}" name="title" value="${escapeHtml(offer.title)}" maxlength="120" required></div>
        <div class="field"><label for="offer-percent-${escapeHtml(offer.id)}">Discount (%)</label><input id="offer-percent-${escapeHtml(offer.id)}" name="discountPercent" type="number" min="1" max="90" value="${offer.discountPercent}" required></div>
        <div class="field"><label for="offer-start-${escapeHtml(offer.id)}">First eligible check-in</label><input id="offer-start-${escapeHtml(offer.id)}" name="startDate" type="date" value="${escapeHtml(offer.startDate.slice(0, 10))}" required></div>
        <div class="field"><label for="offer-end-${escapeHtml(offer.id)}">Last eligible check-out</label><input id="offer-end-${escapeHtml(offer.id)}" name="endDate" type="date" value="${escapeHtml(offer.endDate.slice(0, 10))}" required></div>
        <div class="field field-full"><label for="offer-description-${escapeHtml(offer.id)}">Guest-facing details</label><textarea id="offer-description-${escapeHtml(offer.id)}" name="description" maxlength="500" required>${escapeHtml(offer.description)}</textarea></div>
      </div>
      <div class="room-admin-footer"><label class="publish-toggle"><input name="active" type="checkbox" ${offer.active ? "checked" : ""}> Show this offer and apply it to eligible stays</label>
        <button class="button button-small" type="submit">Save offer</button></div>
    </form>`).join("") || '<p class="empty-state">No offers yet. Create one when you are ready to promote eligible stays.</p>';
  setPanel("Offers", `<p>Active offers appear on the guest site and apply automatically when the full stay falls within their date range. Only confirmed room rates are discounted.</p>
    <details class="admin-create-panel">
      <summary>Create an offer</summary>
      <form id="create-offer-form" class="admin-form-grid">
        <div class="field"><label for="new-offer-title">Offer name</label><input id="new-offer-title" name="title" maxlength="120" required></div>
        <div class="field"><label for="new-offer-percent">Discount (%)</label><input id="new-offer-percent" name="discountPercent" type="number" min="1" max="90" required></div>
        <div class="field"><label for="new-offer-start">First eligible check-in</label><input id="new-offer-start" name="startDate" type="date" required></div>
        <div class="field"><label for="new-offer-end">Last eligible check-out</label><input id="new-offer-end" name="endDate" type="date" required></div>
        <div class="field field-full"><label for="new-offer-description">Guest-facing details</label><textarea id="new-offer-description" name="description" maxlength="500" required></textarea></div>
        <div class="field field-full"><label class="publish-toggle"><input name="active" type="checkbox"> Show this offer on the guest site</label></div>
        <div class="field field-full"><button class="button button-small" type="submit">Create offer</button></div>
      </form>
    </details>
    <div class="room-admin-list">${cards}</div>`);

  const toPayload = (form) => {
    const formData = new FormData(form);
    const data = Object.fromEntries(formData.entries());
    data.discountPercent = Number(data.discountPercent);
    data.active = formData.has("active");
    return data;
  };
  const createForm = panel.querySelector("#create-offer-form");
  createForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/admin/offers", { method: "POST", body: JSON.stringify(toPayload(createForm)) });
      setFeedback("Offer created.");
      await renderOffers();
    } catch (error) { setFeedback(error.message, "error"); }
  });
  panel.querySelectorAll(".offer-edit").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api(`/api/admin/offers/${form.dataset.id}`, { method: "PATCH", body: JSON.stringify(toPayload(form)) });
      setFeedback("Offer updated.");
      await renderOffers();
    } catch (error) { setFeedback(error.message, "error"); }
  }));
}

async function renderMeals() {
  const meals = await api("/api/admin/meals");
  const rows = meals.map((meal) => {
    const controls = currentUser.role === "ADMIN"
      ? `<form class="admin-inline-form meal-edit" data-id="${escapeHtml(meal.id)}">
          <label class="sr-only" for="meal-price-${escapeHtml(meal.id)}">Price for ${escapeHtml(meal.name)}</label><input id="meal-price-${escapeHtml(meal.id)}" name="price" type="number" min="1" value="${meal.price}" required>
          <label><input name="available" type="checkbox" ${meal.available ? "checked" : ""}> Available</label>
          <label><input name="ownerConfirmed" type="checkbox" ${meal.ownerConfirmed ? "checked" : ""}> Owner confirmed</label>
          <button class="button button-small" type="submit">Save</button>
        </form>`
      : `${meal.ownerConfirmed ? money(meal.price) : "Price needs confirmation"} · ${meal.available ? "Available" : "Unavailable"}`;
    return `<tr><td><strong>${escapeHtml(meal.name)}</strong><br><small>${escapeHtml(meal.description)}</small></td><td>${controls}</td></tr>`;
  }).join("");
  setPanel("Meal menu", `<p>Mark menu items as owner confirmed only after checking availability, ingredients and price.</p>${table(["Menu item", "Price / availability"], rows)}`);
  panel.querySelectorAll(".meal-edit").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const data = { price: Number(formData.get("price")), available: formData.has("available"), ownerConfirmed: formData.has("ownerConfirmed") };
    try {
      await api(`/api/admin/meals/${form.dataset.id}`, { method: "PATCH", body: JSON.stringify(data) });
      setFeedback("Menu item updated.");
      await renderMeals();
    } catch (error) { setFeedback(error.message, "error"); }
  }));
}

async function renderOrders() {
  const orders = await api("/api/admin/meal-orders");
  const rows = orders.map((order) => `<tr><td><strong>${escapeHtml(order.reference)}</strong><br>Booking ${escapeHtml(order.bookingReference)}<br>${escapeHtml(order.guestName)} · ${escapeHtml(order.guestPhone)}</td>
    <td>${order.items.map((item) => `${escapeHtml(item.name)} × ${item.quantity}`).join("<br>")}${order.notes ? `<br><small>${escapeHtml(order.notes)}</small>` : ""}</td>
    <td>${money(order.total, order.currency)}</td>
    <td><div class="admin-inline-form"><select aria-label="Meal order status" data-order-status="${escapeHtml(order.id)}">${statusOptions(order.status, ["ACCEPTED", "PREPARING", "READY", "SERVED", "CANCELLED"])}</select><button class="button button-small" type="button" data-action="order-status" data-id="${escapeHtml(order.id)}">Save</button></div></td></tr>`).join("");
  setPanel("Meal orders", table(["Order", "Items", "Total", "Status"], rows));
}

async function renderRequests() {
  const data = await api("/api/admin/requests");
  const serviceRows = data.serviceRequests.map((item) => `<article class="request-card"><h3>${escapeHtml(pretty(item.requestType))} · ${escapeHtml(item.guestName)}</h3>
    <p>${escapeHtml(item.details)}</p><p>Booking: ${escapeHtml(item.bookingReference || "Not provided")} · Phone: ${escapeHtml(item.phone)} · ${escapeHtml(new Date(item.createdAt).toLocaleString())}</p>
    <div class="admin-inline-form"><select aria-label="Service request status" data-service-status="${escapeHtml(item.id)}">${statusOptions(item.status, ["IN_PROGRESS", "RESOLVED", "CANCELLED"])}</select><button class="button button-small" type="button" data-action="service-status" data-id="${escapeHtml(item.id)}">Save</button>
    ${currentUser.role === "ADMIN" ? `<button class="button button-outline button-small" type="button" data-action="service-contact" data-id="${escapeHtml(item.id)}">Reveal contact</button>` : ""}</div></article>`).join("") || '<p class="empty-state">No service requests.</p>';
  const messageRows = data.messages.map((item) => `<article class="request-card"><h3>${escapeHtml(item.subject)} · ${escapeHtml(item.name)}</h3>
    <p>${escapeHtml(item.message)}</p><p>Email: ${escapeHtml(item.email || "Not provided")} · Phone: ${escapeHtml(item.phone || "Not provided")} · ${escapeHtml(new Date(item.createdAt).toLocaleString())}</p>
    <div class="admin-inline-form"><select aria-label="Message status" data-message-status="${escapeHtml(item.id)}">${statusOptions(item.status, ["IN_PROGRESS", "RESOLVED", "CANCELLED"])}</select><button class="button button-small" type="button" data-action="message-status" data-id="${escapeHtml(item.id)}">Save</button>
    ${currentUser.role === "ADMIN" ? `<button class="button button-outline button-small" type="button" data-action="message-contact" data-id="${escapeHtml(item.id)}">Reveal contact</button>` : ""}</div></article>`).join("") || '<p class="empty-state">No contact messages.</p>';
  setPanel("Service requests & messages", `<div class="admin-section"><h3>Service requests</h3>${serviceRows}</div><div class="admin-section"><h3>Contact messages</h3>${messageRows}</div>`);
}

async function renderPayments() {
  const payments = await api("/api/admin/payments");
  const rows = payments.map((payment) => `<tr><td>${escapeHtml(payment.bookingReference)}<br>${escapeHtml(payment.guestName)}<br><small>${escapeHtml(payment.phone || "Cash")}</small></td>
    <td>${escapeHtml(payment.method)}</td><td>${money(payment.amount, payment.currency)}</td>
    <td><span class="status-pill" data-status="${escapeHtml(payment.status)}">${escapeHtml(payment.status)}</span></td>
    <td>${escapeHtml(payment.receipt || payment.resultDescription || "—")}</td>
    <td>${currentUser.role === "ADMIN" && payment.method === "MPESA" ? `<button class="button button-outline button-small" type="button" data-action="payment-query" data-id="${escapeHtml(payment.id)}">Query sandbox</button>` : "—"}</td></tr>`).join("");
  setPanel("Payments", `<p>Payment records contain masked phone numbers. M-Pesa queries call Safaricom sandbox only; no live payment or refund is supported.</p>${table(["Booking", "Method", "Amount", "Status", "Receipt / result", "Action"], rows)}`);
}

async function renderReports() {
  const data = await api("/api/admin/reports");
  setPanel("Reports", `<p>Totals may include unconfirmed rates and are not financial statements.</p><pre class="json-output">${escapeHtml(JSON.stringify(data, null, 2))}</pre>`);
}

async function renderReviews() {
  const reviews = await api("/api/admin/reviews");
  const cards = reviews.map((review) => `<article class="review-card"><h3>${escapeHtml(review.guestName)} · ${review.rating}/5 · ${review.approved ? "Published" : "Pending"}</h3>
    <p>${escapeHtml(review.text)}</p><p><small>${escapeHtml(review.source || "Source not recorded")}</small></p>
    <button class="button button-small" type="button" data-action="review-toggle" data-id="${escapeHtml(review.id)}" data-approved="${!review.approved}">${review.approved ? "Unpublish" : "Approve"}</button>
    <button class="button button-outline button-small" type="button" data-action="review-delete" data-id="${escapeHtml(review.id)}">Delete</button></article>`).join("") || '<p class="empty-state">No guest reviews are stored. Do not invent quotes; add only verified reviews with permission.</p>';
  setPanel("Reviews", `<p>Only approved reviews are shown publicly. For Google feedback, record “Google” as the source, verify the original review and keep permission to publish it.</p>
    <form class="admin-form-grid" id="review-create">
      <div class="field"><label for="review-name">Guest display name</label><input id="review-name" name="guestName" required maxlength="120"></div>
      <div class="field"><label for="review-rating">Rating (1–5)</label><input id="review-rating" name="rating" type="number" min="1" max="5" required></div>
      <div class="field"><label for="review-source">Source (for example, Google) / permission note</label><input id="review-source" name="source" maxlength="250"></div>
      <div class="field field-full"><label for="review-text">Review text</label><textarea id="review-text" name="text" maxlength="1000" required></textarea></div>
      <div class="field"><label><input name="approved" type="checkbox"> Publish now</label></div>
      <div class="field field-full"><button class="button button-small" type="submit">Add review</button></div>
    </form><div class="admin-section">${cards}</div>`);
  panel.querySelector("#review-create").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    data.rating = Number(data.rating);
    data.approved = new FormData(form).has("approved");
    try {
      await api("/api/admin/reviews", { method: "POST", body: JSON.stringify(data) });
      setFeedback("Review added.");
      await renderReviews();
    } catch (error) { setFeedback(error.message, "error"); }
  });
}

async function renderCustomers() {
  const customers = await api("/api/admin/customers");
  const rows = customers.map((customer) => `<tr>
    <td><strong>${escapeHtml(customer.name)}</strong></td>
    <td>${escapeHtml(customer.email)}</td>
    <td>${escapeHtml(new Date(customer.lastLoginAt).toLocaleString())}</td>
    <td>${customer.bookingCount}</td>
  </tr>`).join("");
  setPanel("Guest accounts", `<p>Guests who sign in with Google are listed here. Their booking history is linked automatically when they reserve while signed in.</p>
    ${customers.length
      ? table(["Guest", "Email", "Last sign-in", "Bookings"], rows)
      : '<p class="empty-state">No Google guest accounts yet. New accounts will appear here after their first sign-in.</p>'}`);
}

async function renderUsers() {
  const users = await api("/api/admin/users");
  const rows = users.map((user) => `<tr><td>${escapeHtml(user.name)}<br><small>${escapeHtml(user.email)}</small></td>
    <td><form class="admin-inline-form user-edit" data-id="${escapeHtml(user.id)}">
      <select name="role" aria-label="Role for ${escapeHtml(user.email)}"><option value="STAFF" ${user.role === "STAFF" ? "selected" : ""}>Staff</option><option value="ADMIN" ${user.role === "ADMIN" ? "selected" : ""}>Admin</option></select>
      <select name="active" aria-label="Account status for ${escapeHtml(user.email)}"><option value="true" ${user.active ? "selected" : ""}>Active</option><option value="false" ${!user.active ? "selected" : ""}>Disabled</option></select>
      <button class="button button-small" type="submit">Save</button>
    </form></td></tr>`).join("");
  setPanel("Staff users", `<p>Use a unique password of at least 12 characters. Users with a disabled account or changed password have their sessions revoked.</p>
    <form class="admin-form-grid" id="user-create">
      <div class="field"><label for="new-user-name">Name</label><input id="new-user-name" name="name" required maxlength="120"></div>
      <div class="field"><label for="new-user-email">Email</label><input id="new-user-email" name="email" type="email" required maxlength="254"></div>
      <div class="field"><label for="new-user-role">Role</label><select id="new-user-role" name="role"><option value="STAFF">Staff</option><option value="ADMIN">Admin</option></select></div>
      <div class="field"><label for="new-user-password">Initial password</label><input id="new-user-password" name="password" type="password" minlength="12" required></div>
      <div class="field field-full"><button class="button button-small" type="submit">Create user</button></div>
    </form>${table(["User", "Access"], rows)}`);
  panel.querySelector("#user-create").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await api("/api/admin/users", { method: "POST", body: JSON.stringify(data) });
      setFeedback("Staff user created.");
      await renderUsers();
    } catch (error) { setFeedback(error.message, "error"); }
  });
  panel.querySelectorAll(".user-edit").forEach((form) => form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    data.active = data.active === "true";
    try {
      await api(`/api/admin/users/${form.dataset.id}`, { method: "PATCH", body: JSON.stringify(data) });
      setFeedback("User updated.");
      await renderUsers();
    } catch (error) { setFeedback(error.message, "error"); }
  }));
}

async function renderSettings() {
  const { paymentMode } = await api("/api/admin/settings/payment-mode");
  setPanel("Payment settings", `<p>Only Safaricom sandbox M-Pesa is configured. The app refuses a live Daraja endpoint. Cash is recorded by staff; changing this toggle does not contact Safaricom.</p>
    <form id="payment-settings" class="form-panel">
      <div class="field"><label for="payment-mode-setting">Accepted payment methods</label><select id="payment-mode-setting" name="paymentMode">
        <option value="BOTH" ${paymentMode === "BOTH" ? "selected" : ""}>Cash and M-Pesa sandbox</option>
        <option value="CASH_ONLY" ${paymentMode === "CASH_ONLY" ? "selected" : ""}>Cash only</option>
        <option value="MPESA" ${paymentMode === "MPESA" ? "selected" : ""}>M-Pesa sandbox only</option>
      </select></div><div class="form-actions"><button class="button" type="submit">Save payment mode</button></div>
    </form>`);
  panel.querySelector("#payment-settings").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      await api("/api/admin/settings/payment-mode", { method: "PATCH", body: JSON.stringify(data) });
      setFeedback("Payment mode saved.");
      await renderSettings();
    } catch (error) { setFeedback(error.message, "error"); }
  });
}

async function renderAudit() {
  const logs = await api("/api/admin/audit");
  const rows = logs.map((log) => `<tr><td>${escapeHtml(new Date(log.createdAt).toLocaleString())}</td>
    <td>${escapeHtml(log.actor?.name || "System")}<br><small>${escapeHtml(log.actor?.email || "")}</small></td>
    <td>${escapeHtml(log.action)}</td><td>${escapeHtml(log.entity)} ${escapeHtml(log.entityId || "")}</td>
    <td>${escapeHtml(JSON.stringify(log.details || {}))}</td></tr>`).join("");
  setPanel("Audit log", table(["When", "Actor", "Action", "Record", "Details"], rows));
}

function showDialog(title, values) {
  dialogTitle.textContent = title;
  dialogContent.innerHTML = Object.entries(values).map(([key, value]) => `<p><strong>${escapeHtml(pretty(key))}:</strong> ${escapeHtml(value || "Not provided")}</p>`).join("");
  dialog.showModal();
}

async function handleAction(button) {
  const { action, id } = button.dataset;
  if (action === "booking-status") {
    const status = panel.querySelector(`[data-booking-status="${CSS.escape(id)}"]`).value;
    await api(`/api/admin/bookings/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    await renderBookings();
  } else if (action === "record-cash") {
    const amount = Number(panel.querySelector(`[data-cash-amount="${CSS.escape(id)}"]`).value);
    await api(`/api/admin/bookings/${id}/cash-payment`, { method: "POST", body: JSON.stringify({ amount }) });
    await renderBookings();
  } else if (action === "booking-contact") {
    showDialog("Guest contact", await api(`/api/admin/bookings/${id}/contact`));
  } else if (action === "order-status") {
    const status = panel.querySelector(`[data-order-status="${CSS.escape(id)}"]`).value;
    await api(`/api/admin/meal-orders/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    await renderOrders();
  } else if (action === "service-status" || action === "message-status") {
    const isService = action === "service-status";
    const selector = isService ? "service" : "message";
    const status = panel.querySelector(`[data-${selector}-status="${CSS.escape(id)}"]`).value;
    const endpoint = isService ? "service-requests" : "contact-messages";
    await api(`/api/admin/${endpoint}/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
    await renderRequests();
  } else if (action === "service-contact" || action === "message-contact") {
    const kind = action === "service-contact" ? "service" : "message";
    showDialog("Guest contact", await api(`/api/admin/requests/${kind}/${id}/contact`));
  } else if (action === "payment-query") {
    const result = await api(`/api/admin/payments/${id}/query`, { method: "POST", body: "{}" });
    showDialog("Sandbox payment query", result);
  } else if (action === "review-toggle") {
    await api(`/api/admin/reviews/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ approved: button.dataset.approved === "true" })
    });
    await renderReviews();
  } else if (action === "review-delete") {
    if (!window.confirm("Delete this review record?")) return;
    await api(`/api/admin/reviews/${id}`, { method: "DELETE" });
    await renderReviews();
  }
  setFeedback("Update saved.");
}

document.addEventListener("click", async (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton && viewLabels[viewButton.dataset.view]) {
    await loadView(viewButton.dataset.view);
    return;
  }
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    actionButton.disabled = true;
    try {
      await handleAction(actionButton);
    } catch (error) {
      setFeedback(error.message, "error");
    } finally {
      actionButton.disabled = false;
    }
  }
});

document.querySelector("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("#login-message");
  const submitButton = form.querySelector('button[type="submit"]');
  const data = Object.fromEntries(new FormData(form).entries());
  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  submitButton.innerHTML = 'Checking your details<span class="loading-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
  message.textContent = "Checking your sign-in details…";
  message.dataset.kind = "info";
  try {
    const result = await api("/api/auth/login", { method: "POST", body: JSON.stringify(data) });
    if (result.user.mustChangePassword) {
      form.reset();
      showPasswordChange(result.user);
      return;
    }
    message.textContent = "Password accepted. Opening your dashboard…";
    message.dataset.kind = "success";
    submitButton.innerHTML = 'Opening dashboard<span class="loading-dots" aria-hidden="true"><i></i><i></i><i></i></span>';
    await new Promise((resolve) => window.setTimeout(resolve, 450));
    form.reset();
    showDashboard(result.user);
  } catch (error) {
    message.textContent = error.message;
    message.dataset.kind = "error";
  } finally {
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
    submitButton.textContent = "Sign in";
  }
});

document.querySelector("#change-password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const message = document.querySelector("#change-password-message");
  const data = Object.fromEntries(new FormData(form).entries());
  if (data.password !== data.confirmPassword) {
    message.textContent = "The passwords do not match.";
    message.dataset.kind = "error";
    return;
  }
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  message.textContent = "Saving your new password…";
  message.dataset.kind = "info";
  try {
    const result = await api("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ password: data.password })
    });
    form.reset();
    showDashboard(result.user);
  } catch (error) {
    message.textContent = error.message;
    message.dataset.kind = "error";
  } finally {
    button.disabled = false;
  }
});

passwordToggle.addEventListener("click", () => {
  const isVisible = loginPassword.type === "text";
  loginPassword.type = isVisible ? "password" : "text";
  passwordToggle.textContent = isVisible ? "Show" : "Hide";
  passwordToggle.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
  passwordToggle.setAttribute("aria-pressed", String(!isVisible));
});

logoutButton.addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
    showLogin("You have signed out.");
  } catch (error) {
    setFeedback(error.message, "error");
  }
});

async function init() {
  try {
    const result = await api("/api/auth/me");
    showDashboard(result.user);
  } catch (error) {
    showLogin(error.status === 401 ? "" : error.message);
  }
}

init();
