// RDBMS lab: ride seat map, transactional ticket actions, tables and logs.
'use strict';

const state = {
  rides: [],
  tripId: null,
  seatId: null,
  selectedBookingId: null,
  passengers: [],
  tableTab: 'bookings',
  logTab: 'audit',
  auditSince: 0,
  prevRows: new Map(),
  lastTrace: [],
};

const BADGE_KIND = {
  CONFIRMED: 'ok', PAID: 'ok', INSERT: 'ok', OK: 'ok',
  CANCELLED: 'err', FAILED: 'err', DELETE: 'err', ERROR: 'err',
  UPDATE: 'info', WAIT: 'wait',
};
const BADGE_COLS = new Set(['status', 'action', 'payment_status']);
const $ = (id) => document.getElementById(id);

function badgeCell(text) {
  const badge = document.createElement('span');
  badge.className = `badge b-${BADGE_KIND[text] || 'wait'}`;
  badge.textContent = text;
  return badge;
}

async function api(path, options) {
  const response = await fetch(path, options);
  let body;
  try { body = await response.json(); } catch (_) { body = {}; }
  if (!response.ok || !body.ok) {
    throw Object.assign(new Error(body.message || `request failed (${response.status})`), {
      code: body.code,
      trace: body.trace,
      committed: body.committed,
      sqlState: body.sqlState,
    });
  }
  return body;
}

const post = (path, data) => api(path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(data),
});

function showError(id, error) {
  const element = $(id);
  if (element) element.textContent = error.code ? `[${error.code}] ${error.message}` : error.message;
}

// Rides, passengers and the operations seat map.
async function loadRides() {
  const body = await api('/api/rides');
  state.rides = body.rows;
  const select = $('ride-select');
  select.textContent = '';
  for (const ride of state.rides) {
    const option = document.createElement('option');
    option.value = ride.ride_id;
    option.textContent = `${ride.ride_no}  ${ride.pickup_code}–${ride.dropoff_code}  ${ride.pickup_at}`;
    select.appendChild(option);
  }
  if (!state.rides.some((ride) => ride.ride_id === state.tripId)) {
    state.tripId = state.rides[0] ? state.rides[0].ride_id : null;
  }
  if (state.tripId != null) select.value = String(state.tripId);
  await refreshSeatMap();
}

async function loadPassengers() {
  const body = await api('/api/table/passengers');
  state.passengers = body.rows;
  const select = $('passenger-select');
  const previous = select.value;
  select.textContent = '';
  for (const passenger of state.passengers) {
    const option = document.createElement('option');
    option.value = passenger.passenger_id;
    option.textContent = `${passenger.name} · ${passenger.email}`;
    select.appendChild(option);
  }
  if (state.passengers.some((passenger) => String(passenger.passenger_id) === previous)) {
    select.value = previous;
  }
}

async function refreshSeatMap() {
  const map = $('seat-map');
  map.textContent = '';
  if (state.tripId == null) return;
  const body = await api(`/api/rides/${state.tripId}/seats`);
  for (const seat of body.rows) {
    const button = document.createElement('button');
    button.type = 'button';
    const booked = seat.booking_id != null;
    button.className = `seat ${booked ? 'booked' : 'free'}${seat.class === 'FRONT_ROW' ? ' front' : ''}`;
    button.setAttribute('aria-pressed', String(seat.seat_id === state.seatId));
    button.setAttribute('aria-label', booked
      ? `Seat ${seat.seat_no}, booked by ${seat.passenger_name}`
      : `Seat ${seat.seat_no}, free, ${seat.class}, fare ${seat.fare}`);
    if (booked) button.title = `Booked by ${seat.passenger_name}`;
    if (seat.seat_id === state.seatId) button.classList.add(booked ? 'selected' : 'freesel');
    const cross = document.createElement('span');
    cross.className = 'seatx';
    cross.textContent = booked ? '×' : '';
    const label = document.createElement('span');
    label.className = 'slabel';
    label.textContent = seat.seat_no;
    button.append(cross, label);
    button.addEventListener('click', () => selectSeat(seat));
    map.appendChild(button);
  }
}

function selectSeat(seat) {
  state.seatId = seat.seat_id;
  state.selectedBookingId = seat.booking_id || null;
  $('btn-cancel').disabled = !state.selectedBookingId;
  $('seat-hint').textContent = state.selectedBookingId
    ? `Selected seat ${seat.seat_no}, booked by ${seat.passenger_name}. Cancel it to release the seat.`
    : `Selected ${seat.seat_no} · ${seat.class} · ₹${Number(seat.fare).toFixed(2)}`;
  refreshSeatMap().catch((error) => showError('book-error', error));
}

// One transaction per ticket: booking + payment + optional luggage.
async function runBook(forceFail = false) {
  $('book-error').textContent = '';
  if (state.tripId == null || state.seatId == null || state.selectedBookingId != null) {
    $('book-error').textContent = 'Choose an available seat first.';
    return;
  }
  if (!Number($('passenger-select').value)) {
    $('book-error').textContent = 'Add a passenger before booking a ticket.';
    return;
  }
  const failAt = forceFail ? $('fail-at').value : null;
  if (forceFail && !failAt) {
    $('book-error').textContent = 'Choose a failure point to test rollback.';
    return;
  }
  try {
    const body = await post('/api/book', {
      ride_id: state.tripId,
      seat_id: state.seatId,
      passenger_id: Number($('passenger-select').value),
      luggage_kg: Number($('luggage-kg').value) || 0,
      fail_at: failAt,
    });
    renderTrace(body.trace);
    state.seatId = null;
    await refreshAfterAction();
  } catch (error) {
    if (error.trace) renderTrace(error.trace);
    showError('book-error', error);
    await refreshAfterAction();
  }
}

async function runCancel() {
  if (!state.selectedBookingId) return;
  $('book-error').textContent = '';
  try {
    const body = await post(`/api/cancel/${state.selectedBookingId}`, {});
    renderTrace(body.trace);
    state.selectedBookingId = null;
    state.seatId = null;
    $('btn-cancel').disabled = true;
    $('seat-hint').textContent = 'Ticket cancelled. The seat is available again.';
    await refreshAfterAction();
  } catch (error) {
    if (error.trace) renderTrace(error.trace);
    showError('book-error', error);
    await refreshAfterAction();
  }
}

async function refreshAfterAction() {
  await Promise.all([refreshSeatMap(), refreshTable()]);
  if (state.logTab === 'audit') await pollAudit();
  if (typeof loadSiteRides === 'function') await loadSiteRides();
  if (typeof loadMyTickets === 'function') await loadMyTickets();
}

async function runConceptDemo(type) {
  $('concept-error').textContent = '';
  try {
    const body = await post('/api/constraint-demo', { type });
    const line = body.code === 'NO_ERROR' || body.code === 'NO_BOOKINGS'
      ? `${type}: ${body.message}`
      : `${type}: MySQL error [${body.code} / SQLSTATE ${body.sqlState}] ${body.message}`;
    renderTrace([{ ts: nowTs(), actor: 'DB', step: line, status: body.code === 'NO_ERROR' ? 'OK' : 'ERROR' }]);
    $('concept-error').textContent = line;
  } catch (error) {
    showError('concept-error', error);
  }
}

async function runIsolationDemo() {
  $('concept-error').textContent = '';
  if (state.tripId == null || state.seatId == null || state.selectedBookingId != null) {
    $('concept-error').textContent = 'Select an available seat in the seat map first.';
    return;
  }
  if (!Number($('passenger-select').value)) {
    $('concept-error').textContent = 'Add a passenger before running the seat-lock demo.';
    return;
  }
  try {
    const body = await post('/api/isolation-demo', {
      ride_id: state.tripId,
      seat_id: state.seatId,
      passenger_id: Number($('passenger-select').value),
    });
    renderTrace(body.trace);
    state.seatId = null;
    await refreshAfterAction();
  } catch (error) {
    if (error.trace) renderTrace(error.trace);
    showError('concept-error', error);
    await refreshAfterAction();
  }
}

const NORM_QUERIES = {
  update: "UPDATE unnormalized_bookings SET passenger_email = 'asha.verma@newmail.com' WHERE booking_no = 'CT-1001'",
  insert: "INSERT INTO unnormalized_bookings (booking_no, ride_no, operator_name, pickup_city, dropoff_city, seat_no, fare, payment_status) VALUES ('CT-1011', 'CB999', 'New Cab Co', 'Pune', 'Nashik', '1A', 399.00, 'PENDING')",
  delete: "DELETE FROM unnormalized_bookings WHERE ride_no = 'CB318'",
};

function loadNormalizationQuery(kind) {
  $('sql-input').value = NORM_QUERIES[kind] || '';
  $('sql-input').focus();
}

const TABLE_TABS = [
  'bookings', 'payments', 'luggage', 'seats', 'passengers', 'rides', 'cabs', 'stands',
  'audit_log', 'unnormalized_bookings', 'bookings_1nf', 'bookings_2nf', 'rides_2nf',
  'bookings_3nf', 'passengers_3nf', 'rides_3nf',
];

function renderTableTabs() {
  const nav = $('table-tabs');
  nav.textContent = '';
  for (const tableName of TABLE_TABS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = tableName;
    button.setAttribute('aria-pressed', String(tableName === state.tableTab));
    button.addEventListener('click', () => {
      state.tableTab = tableName;
      renderTableTabs();
      refreshTable();
    });
    nav.appendChild(button);
  }
}

async function refreshTable() {
  $('table-error').textContent = '';
  try {
    const body = await api(`/api/table/${state.tableTab}`);
    renderDataTable($('data-table'), body.columns, body.rows, true);
  } catch (error) {
    state.prevRows.clear();
    showError('table-error', error);
  }
}

function renderDataTable(table, columns, rows, flashNew = false) {
  table.textContent = '';
  if (!columns || !columns.length) return;
  const thead = document.createElement('thead');
  const headingRow = document.createElement('tr');
  for (const column of columns) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = column;
    headingRow.appendChild(th);
  }
  thead.appendChild(headingRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const row of rows) {
    const key = String(row[columns[0]]);
    const json = JSON.stringify(row);
    const tr = document.createElement('tr');
    if (flashNew && (!state.prevRows.has(key) || state.prevRows.get(key) !== json)) tr.className = 'flash';
    if (flashNew) state.prevRows.set(key, json);
    for (const column of columns) {
      const td = document.createElement('td');
      if (BADGE_COLS.has(column) && BADGE_KIND[row[column]]) td.appendChild(badgeCell(row[column]));
      else td.textContent = row[column] == null ? 'NULL' : String(row[column]);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
}

// Activity streams.
function setLogTab(tab) {
  state.logTab = tab;
  for (const button of $('log-tabs').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.log === tab));
  }
  $('audit-list').hidden = tab !== 'audit';
  $('general-list').hidden = tab !== 'general';
  $('trace-list').hidden = tab !== 'trace';
  if (tab === 'audit') pollAudit();
  if (tab === 'general') pollGeneral();
}

function nowTs() {
  const date = new Date();
  const pad = (value, width = 2) => String(value).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
}

function logItem(text, status, timeText, flash = false) {
  const item = document.createElement('li');
  const time = document.createElement('span');
  time.className = 't';
  time.textContent = timeText || '--';
  const badge = document.createElement('span');
  badge.className = `status-${String(status).toLowerCase()}`;
  badge.textContent = status;
  item.append(time, badge, document.createTextNode(` ${text}`));
  if (flash) item.className = 'flash';
  return item;
}

async function pollAudit() {
  try {
    const body = await api(`/api/logs/audit?since=${state.auditSince}`);
    const list = $('audit-list');
    for (const row of body.rows.slice().reverse()) {
      const detail = row.new_data ? JSON.stringify(row.new_data) : JSON.stringify(row.old_data);
      list.prepend(logItem(`${row.action} ${row.table_name} row ${row.row_id} ${detail}`, 'OK', row.logged_at, true));
      state.auditSince = Math.max(state.auditSince, row.log_id);
    }
    while (list.children.length > 200) list.removeChild(list.lastChild);
  } catch (_) { /* Keep the last visible audit entries during a connection issue. */ }
}

async function pollGeneral() {
  const list = $('general-list');
  try {
    const body = await api('/api/logs/general');
    list.textContent = '';
    if (!body.enabled) {
      list.appendChild(logItem('MySQL general log is OFF. Enable it on the database to inspect raw statements.', 'OK', '--'));
      return;
    }
    for (const row of body.rows) list.appendChild(logItem(`${row.command_type} ${row.argument}`, 'OK', row.event_time));
  } catch (error) {
    list.textContent = '';
    list.appendChild(logItem(error.message, 'ERROR', '--'));
  }
}

function renderTrace(trace) {
  state.lastTrace = trace.slice();
  const list = $('trace-list');
  list.textContent = '';
  for (const step of trace.slice().reverse()) {
    list.appendChild(logItem(`${step.actor ? `${step.actor} ` : ''}${step.step}`, step.status || 'OK', step.ts));
  }
}

async function runQuery() {
  $('sql-error').textContent = '';
  $('sql-table').textContent = '';
  const sql = $('sql-input').value.trim();
  if (!sql) return;
  try {
    const body = await post('/api/query', { sql });
    if (body.columns && body.columns.length) renderDataTable($('sql-table'), body.columns, body.rows);
    else $('sql-table').textContent = `OK · affected rows: ${body.affectedRows}`;
    await refreshAfterAction();
  } catch (error) {
    showError('sql-error', error);
  }
}

async function checkHealth() {
  const status = $('db-status');
  try {
    await api('/api/health');
    status.textContent = 'database connected';
    status.className = 'ok';
  } catch (_) {
    status.textContent = 'database offline';
    status.className = 'bad';
  }
}

async function resetDemo() {
  if (!window.confirm('Restore the sample rides, seats and tickets? This replaces the current demo data.')) return;
  $('book-error').textContent = '';
  try {
    await post('/api/reset', {});
    state.auditSince = 0;
    state.prevRows.clear();
    state.seatId = null;
    state.selectedBookingId = null;
    $('btn-cancel').disabled = true;
    $('audit-list').textContent = '';
    await loadRides();
    await Promise.all([loadPassengers(), refreshTable()]);
    if (typeof loadSiteRides === 'function') await loadSiteRides();
    if (typeof loadMyTickets === 'function') await loadMyTickets();
    $('site-error').textContent = '';
  } catch (error) {
    showError('book-error', error);
    showError('site-error', error);
  }
}

function pollEverything() {
  refreshTable();
  if (state.logTab === 'audit') pollAudit();
  if (state.logTab === 'general') pollGeneral();
  checkHealth();
}

function initConsole() {
  $('ride-select').addEventListener('change', (event) => {
    state.tripId = Number(event.target.value) || null;
    state.seatId = null;
    state.selectedBookingId = null;
    $('btn-cancel').disabled = true;
    $('seat-hint').textContent = 'Available seats can be booked. Select a booked seat to cancel.';
    refreshSeatMap();
  });
  $('btn-book').addEventListener('click', () => runBook(false));
  $('btn-book-fail').addEventListener('click', () => runBook(true));
  $('btn-cancel').addEventListener('click', runCancel);
  $('btn-isolation').addEventListener('click', runIsolationDemo);
  $('btn-run').addEventListener('click', runQuery);
  $('sql-input').addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      runQuery();
    }
  });
  $('btn-reset').addEventListener('click', resetDemo);
  for (const button of document.querySelectorAll('button[data-demo]')) {
    button.addEventListener('click', () => runConceptDemo(button.dataset.demo));
  }
  for (const button of document.querySelectorAll('button[data-norm]')) {
    button.addEventListener('click', () => loadNormalizationQuery(button.dataset.norm));
  }
  for (const button of $('log-tabs').querySelectorAll('button')) {
    button.addEventListener('click', () => setLogTab(button.dataset.log));
  }

  renderTableTabs();
  loadRides().catch((error) => showError('book-error', error));
  loadPassengers().catch((error) => showError('book-error', error));
  refreshTable();
  pollAudit();
  checkHealth();
  window.addEventListener('cabnation:passengers-changed', () => loadPassengers());
  window.setInterval(pollEverything, 2500);
}

initConsole();
