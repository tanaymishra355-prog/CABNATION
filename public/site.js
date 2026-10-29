// Passenger-facing CABNATION booking experience.
'use strict';

const site = {
  view: 'site',
  rides: [],
  rideId: null,
  ride: null,
  seat: null,
  passengers: [],
  paxId: null,
  ridesPaxId: null,
};

const $s = (id) => document.getElementById(id);
const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

// Connection-level failures get calm, actionable copy; real database errors
// (duplicate email 1062, seat already booked 1644, ...) pass through unchanged.
function friendlyError(error) {
  const raw = error.message || '';
  const code = String(error.code || '');
  if (code.includes('ECONNREFUSED') || code === '-111' || /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|ER_ACCESS_DENIED_ERROR/.test(code + ' ' + raw)) {
    return 'The booking database is not reachable. Start MySQL, run schema.sql and seed.sql (or set DB_HOST to a hosted database), then reload.';
  }
  return error.code ? `[${error.code}] ${raw}` : raw;
}

async function jfetch(path, options) {
  const response = await fetch(path, options);
  let body;
  try { body = await response.json(); } catch (_) { body = {}; }
  if (!response.ok || !body.ok) {
    throw Object.assign(new Error(body.message || `request failed (${response.status})`), {
      code: body.code,
      trace: body.trace,
      committed: body.committed,
    });
  }
  return body;
}

const jpost = (path, data) => jfetch(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data),
});

function setView(view) {
  site.view = view;
  const isSite = view === 'site';
  $s('site-view').hidden = !isSite;
  $s('layout').hidden = isSite;
  for (const button of $s('view-switch').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
}

function formatTime(value) {
  return value ? value.slice(11, 16) : '—';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  return new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }).format(date);
}

function formatDuration(minutes) {
  const hours = Math.floor(Number(minutes) / 60);
  const remaining = Number(minutes) % 60;
  return remaining ? `${hours}h ${remaining}m` : `${hours}h`;
}

function updateRouteStamp() {
  $s('stamp-pickup').textContent = site.ride ? site.ride.pickup_code : 'FROM';
  $s('stamp-dropoff').textContent = site.ride ? site.ride.dropoff_code : 'TO';
}

function appendText(parent, tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

// Pickups and live availability.
async function loadSiteRides() {
  const list = $s('ride-list');
  const count = $s('ride-count');
  $s('ride-error').textContent = '';
  try {
    const body = await jfetch('/api/rides');
    site.rides = body.rows;
    list.textContent = '';
    count.textContent = `${site.rides.length} ${site.rides.length === 1 ? 'ride' : 'rides'}`;

    if (!site.rides.some((ride) => ride.ride_id === site.rideId)) {
      site.rideId = site.rides[0] ? site.rides[0].ride_id : null;
      site.seat = null;
    }
    site.ride = site.rides.find((ride) => ride.ride_id === site.rideId) || null;
    updateRouteStamp();

    if (!site.rides.length) {
      appendText(list, 'li', 'empty-state', 'No rides are available right now. Check back soon.');
      updateSummary();
      return;
    }

    for (const ride of site.rides) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `ride-row${ride.ride_id === site.rideId ? ' sel' : ''}`;
      button.dataset.rideId = String(ride.ride_id);
      button.setAttribute('aria-pressed', String(ride.ride_id === site.rideId));
      button.setAttribute('aria-label', `${ride.pickup_city} to ${ride.dropoff_city}, ${ride.operator} ${ride.cab_type}, pickup ${formatTime(ride.pickup_at)}, from ${money.format(Number(ride.min_fare))}, ${ride.free_seats} seats available`);

      const operator = appendText(button, 'span', 'ride-operator-wrap', '');
      appendText(operator, 'span', 'ride-operator', ride.operator);
      appendText(operator, 'small', 'ride-service', `${ride.cab_type} · ${ride.ride_no}`);

      const route = appendText(button, 'span', 'ride-route', '');
      const pickup = appendText(route, 'span', 'ride-city', '');
      appendText(pickup, 'strong', '', ride.pickup_city);
      appendText(pickup, 'small', '', ride.pickup_stand);
      appendText(route, 'span', 'ride-arrow', '');
      const destination = appendText(route, 'span', 'ride-city', '');
      appendText(destination, 'strong', '', ride.dropoff_city);
      appendText(destination, 'small', '', ride.dropoff_stand);

      const timing = appendText(button, 'span', 'ride-time', '');
      appendText(timing, 'strong', '', `${formatTime(ride.pickup_at)} – ${formatTime(ride.dropoff_at)}`);
      appendText(timing, 'small', '', `${formatDate(ride.pickup_at)} · ${formatDuration(ride.duration_minutes)}`);

      const price = appendText(button, 'span', 'ride-price', '');
      appendText(price, 'strong', '', `from ${money.format(Number(ride.min_fare))}`);
      appendText(price, 'small', '', `${ride.free_seats} seats left`);

      button.addEventListener('click', () => {
        selectRide(ride.ride_id).catch((error) => { $s('ride-error').textContent = friendlyError(error); });
      });
      item.appendChild(button);
      list.appendChild(item);
    }

    if (site.rideId != null) await loadCab();
    updateSummary();
  } catch (error) {
    count.textContent = 'Rides unavailable';
    list.textContent = '';
    appendText(list, 'li', 'empty-state', 'We couldn’t load rides. Check that the app and database are running.');
    $s('ride-error').textContent = friendlyError(error);
  }
}

async function selectRide(rideId) {
  site.rideId = rideId;
  site.ride = site.rides.find((ride) => ride.ride_id === rideId) || null;
  site.seat = null;
  updateRouteStamp();
  $s('pax-error').textContent = '';
  for (const button of $s('ride-list').querySelectorAll('.ride-row')) {
    button.classList.toggle('sel', Number(button.dataset.rideId) === rideId);
    button.setAttribute('aria-pressed', String(button.classList.contains('sel')));
  }
  await loadCab();
  updateSummary();
}

// 2 + aisle + 2 seat map, built from the live ride inventory.
async function loadCab() {
  if (site.rideId == null) {
    $s('cab-map').textContent = '';
    return;
  }
  const body = await jfetch(`/api/rides/${site.rideId}/seats`);
  if (site.seat) {
    const currentSeat = body.rows.find((item) => item.seat_id === site.seat.seat_id);
    if (!currentSeat || currentSeat.booking_id != null) {
      site.seat = null;
      $s('pax-error').textContent = currentSeat
        ? `Seat ${currentSeat.seat_no} was just booked. Choose another seat.`
        : 'That seat is no longer available. Choose another seat.';
    } else {
      site.seat = currentSeat;
    }
  }
  const rows = {};
  for (const seat of body.rows) {
    const match = seat.seat_no.match(/^(\d+)([A-Z])$/);
    if (!match) continue;
    (rows[match[1]] = rows[match[1]] || []).push(seat);
  }
  const fares = {};
  for (const seat of body.rows) fares[seat.class] = seat.fare;
  const frontFare = fares.FRONT_ROW == null ? '—' : money.format(Number(fares.FRONT_ROW));
  const standardFare = fares.STANDARD == null ? '—' : money.format(Number(fares.STANDARD));
  $s('cab-legend').textContent = `Front row ${frontFare} · Standard ${standardFare}`;

  const map = $s('cab-map');
  map.textContent = '';
  for (const rowNo of Object.keys(rows).sort((a, b) => Number(a) - Number(b))) {
    const row = appendText(map, 'div', 'cab-row', '');
    appendText(row, 'span', 'rowno', rowNo);
    for (const letter of ['A', 'B', 'C', 'D']) {
      if (letter === 'C') {
        const aisle = appendText(row, 'span', 'aisle', '');
        aisle.setAttribute('aria-hidden', 'true');
      }
      const seat = rows[rowNo].find((item) => item.seat_no === rowNo + letter);
      if (!seat) continue;
      const booked = seat.booking_id != null;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `seat ${booked ? 'booked' : 'free'}${seat.class === 'FRONT_ROW' ? ' front' : ''}`;
      button.setAttribute('aria-pressed', String(Boolean(site.seat && site.seat.seat_id === seat.seat_id)));
      button.setAttribute('aria-label', booked
        ? `Seat ${seat.seat_no}, booked by ${seat.passenger_name}`
        : `Seat ${seat.seat_no}, ${seat.class === 'FRONT_ROW' ? 'front row' : 'standard'}, ${money.format(Number(seat.fare))}`);
      if (booked) button.title = `Booked by ${seat.passenger_name}`;
      if (site.seat && seat.seat_id === site.seat.seat_id) button.classList.add('selected');
      appendText(button, 'span', 'seatx', booked ? '×' : '');
      appendText(button, 'span', 'slabel', seat.seat_no);
      button.addEventListener('click', () => selectCabSeat(seat));
      row.appendChild(button);
    }
  }
}

function selectCabSeat(seat) {
  if (seat.booking_id != null) {
    $s('pax-error').textContent = `Seat ${seat.seat_no} is already booked by ${seat.passenger_name}.`;
    return;
  }
  $s('pax-error').textContent = '';
  site.seat = seat;
  loadCab().catch((error) => { $s('site-error').textContent = friendlyError(error); });
  updateSummary();
}

// Passenger records are shared with the database console.
async function loadSitePassengers() {
  const body = await jfetch('/api/table/passengers');
  site.passengers = body.rows;
  for (const selectId of ['site-passenger', 'site-rides-pax']) {
    const select = $s(selectId);
    const previous = select.value;
    select.textContent = '';
    for (const passenger of site.passengers) {
      const option = document.createElement('option');
      option.value = passenger.passenger_id;
      option.textContent = `${passenger.name} · ${passenger.email}`;
      select.appendChild(option);
    }
    if (site.passengers.some((passenger) => String(passenger.passenger_id) === previous)) select.value = previous;
  }
  if (!site.passengers.some((passenger) => passenger.passenger_id === site.paxId)) {
    site.paxId = site.passengers[0] ? site.passengers[0].passenger_id : null;
  }
  if (!site.passengers.some((passenger) => passenger.passenger_id === site.ridesPaxId)) {
    site.ridesPaxId = site.passengers[0] ? site.passengers[0].passenger_id : null;
  }
  if (site.paxId != null) $s('site-passenger').value = String(site.paxId);
  if (site.ridesPaxId != null) $s('site-rides-pax').value = String(site.ridesPaxId);
  updateSummary();
}

async function addPassenger() {
  $s('np-error').textContent = '';
  try {
    const body = await jpost('/api/passengers', {
      name: $s('np-name').value,
      email: $s('np-email').value,
      phone: $s('np-phone').value,
    });
    await loadSitePassengers();
    site.paxId = body.row.passenger_id;
    $s('site-passenger').value = String(site.paxId);
    $s('np-name').value = '';
    $s('np-email').value = '';
    $s('np-phone').value = '';
    $s('new-pax').open = false;
    window.dispatchEvent(new Event('cabnation:passengers-changed'));
    updateSummary();
  } catch (error) {
    $s('np-error').textContent = friendlyError(error);
  }
}

function updateSummary() {
  const ride = site.ride;
  const seat = site.seat;
  const luggageKg = Number($s('site-luggage').value) || 0;
  $s('sum-ride').textContent = ride ? `${ride.pickup_city} → ${ride.dropoff_city} · ${ride.ride_no}` : 'Choose a ride to begin';
  $s('sum-departure').textContent = ride ? `${formatDate(ride.pickup_at)} · ${formatTime(ride.pickup_at)}` : '—';
  $s('sum-seat').textContent = seat ? `${seat.seat_no} · ${seat.class === 'FRONT_ROW' ? 'Front row' : 'Standard'}` : '—';
  $s('sum-fare').textContent = seat ? money.format(Number(seat.fare)) : '—';
  $s('sum-luggage').textContent = luggageKg > 0 ? `${luggageKg} kg · ${money.format(luggageKg * 50)}` : 'None';
  $s('sum-total').textContent = seat ? money.format(Number(seat.fare) + luggageKg * 50) : '—';
  $s('site-book').disabled = !(ride && seat && site.paxId && luggageKg >= 0 && luggageKg <= 40);
}

async function siteBook() {
  $s('site-error').textContent = '';
  $s('site-ticket').hidden = true;
  if (!site.ride || !site.seat || !site.paxId) {
    $s('site-error').textContent = 'Choose a ride, an available seat and a passenger before confirming.';
    return;
  }
  const luggageKg = Number($s('site-luggage').value) || 0;
  if (!Number.isInteger(luggageKg) || luggageKg < 0 || luggageKg > 40) {
    $s('site-error').textContent = 'Luggage must be a whole number from 0 to 40 kg.';
    return;
  }

  $s('site-book').disabled = true;
  let bookingId = null;
  try {
    const body = await jpost('/api/book', {
      ride_id: site.rideId,
      seat_id: site.seat.seat_id,
      passenger_id: site.paxId,
      luggage_kg: luggageKg,
    });
    bookingId = body.booking_id;
    renderSiteTrace(body.trace);
    site.seat = null;
    await showTicket(bookingId);
  } catch (error) {
    if (error.trace) renderSiteTrace(error.trace);
    $s('site-error').textContent = friendlyError(error);
  }

  await Promise.all([loadSiteRides(), loadMyTickets()]);
  updateSummary();
  $s('site-book').disabled = !(site.ride && site.seat && site.paxId);
}

async function showTicket(bookingId) {
  const body = await jfetch(`/api/bookings?passenger_id=${site.paxId}`);
  const ticket = body.rows.find((row) => Number(row.booking_id) === Number(bookingId));
  if (!ticket) return;
  const passenger = site.passengers.find((item) => item.passenger_id === site.paxId);
  $s('tkt-id').textContent = `CB-${String(ticket.booking_id).padStart(6, '0')}`;
  $s('tkt-route').textContent = `${ticket.pickup_city} → ${ticket.dropoff_city} · ${ticket.ride_no}`;
  $s('tkt-pax').textContent = passenger ? passenger.name : `Passenger ${site.paxId}`;
  $s('tkt-seat').textContent = ticket.seat_no;
  $s('tkt-total').textContent = money.format(Number(ticket.amount) + Number(ticket.luggage_fee));
  $s('site-ticket').hidden = false;
}

// Tickets remain visible after cancellation so the booking history is intact.
async function loadMyTickets() {
  const list = $s('site-rides');
  const passengerId = site.ridesPaxId;
  list.textContent = '';
  if (passengerId == null) {
    appendText(list, 'li', 'empty-state', 'Add a passenger to see ticket history.');
    return;
  }
  $s('rides-error').textContent = '';
  try {
    const body = await jfetch(`/api/bookings?passenger_id=${passengerId}`);
    if (!body.rows.length) {
      appendText(list, 'li', 'empty-state', 'No tickets yet. Your next ride can start here.');
      return;
    }
    for (const ticket of body.rows) {
      const item = document.createElement('li');
      item.className = 'my-ride-item';
      const info = appendText(item, 'span', 'my-ride-info', '');
      appendText(info, 'strong', '', `${ticket.pickup_city} → ${ticket.dropoff_city}`);
      appendText(info, 'small', '', `${ticket.ride_no} · seat ${ticket.seat_no} · ${formatDate(ticket.pickup_at)}`);

      const badge = appendText(item, 'span', `badge ${ticket.status === 'CONFIRMED' ? 'b-ok' : 'b-err'}`, ticket.status);
      badge.setAttribute('aria-label', `Ticket ${ticket.status.toLowerCase()}`);
      appendText(item, 'span', 'my-ride-amount', money.format(Number(ticket.amount) + Number(ticket.luggage_fee)));
      if (ticket.status === 'CONFIRMED') {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'button-danger cancel-ticket';
        cancel.textContent = 'Cancel';
        cancel.setAttribute('aria-label', `Cancel ticket CB-${String(ticket.booking_id).padStart(6, '0')}`);
        cancel.addEventListener('click', () => cancelTicket(ticket.booking_id));
        item.appendChild(cancel);
      }
      list.appendChild(item);
    }
  } catch (error) {
    $s('rides-error').textContent = friendlyError(error);
  }
}

async function cancelTicket(bookingId) {
  $s('rides-error').textContent = '';
  try {
    const body = await jpost(`/api/cancel/${bookingId}`, {});
    renderSiteTrace(body.trace);
  } catch (error) {
    if (error.trace) renderSiteTrace(error.trace);
    $s('rides-error').textContent = friendlyError(error);
  }
  await Promise.all([loadMyTickets(), loadSiteRides()]);
  updateSummary();
}

function renderSiteTrace(trace) {
  const list = $s('site-trace-list');
  list.textContent = '';
  for (const step of trace.slice().reverse()) {
    const item = document.createElement('li');
    const time = appendText(item, 'span', 't', step.ts);
    time.setAttribute('aria-label', `At ${step.ts}`);
    const status = String(step.status || 'OK').toLowerCase();
    appendText(item, 'span', `status-${status}`, step.status || 'OK');
    item.appendChild(document.createTextNode(` ${step.actor ? `${step.actor} ` : ''}${step.step}`));
    list.appendChild(item);
  }
}

function initSite() {
  for (const button of $s('view-switch').querySelectorAll('button')) {
    button.addEventListener('click', () => setView(button.dataset.view));
  }
  $s('site-passenger').addEventListener('change', (event) => {
    site.paxId = Number(event.target.value) || null;
    updateSummary();
  });
  $s('site-rides-pax').addEventListener('change', (event) => {
    site.ridesPaxId = Number(event.target.value) || null;
    loadMyTickets();
  });
  $s('site-luggage').addEventListener('input', updateSummary);
  $s('btn-add-pax').addEventListener('click', addPassenger);
  $s('site-book').addEventListener('click', siteBook);
  setView('site');

  loadSiteRides();
  loadSitePassengers().then(loadMyTickets).catch((error) => {
    $s('pax-error').textContent = `Passenger list unavailable: ${friendlyError(error)}`;
  });
}

initSite();
