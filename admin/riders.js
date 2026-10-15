"use strict";

const riderDb = typeof supabaseClient !== "undefined"
  ? supabaseClient
  : window.supabaseClient;

const riderStatusLabels = {
  pending: "Pending",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  out_for_delivery: "Out for Delivery",
  completed: "Completed",
  cancelled: "Cancelled"
};

const riderStatuses = ["Available", "On Delivery", "Inactive"];
const activeDeliveryStatuses = new Set([
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery"
]);

let deliveryOrders = [];
let riders = [];
let riderLoadError = null;
let deliveryOrdersLoadError = null;
let isSavingRider = false;
const savingDeliveryOrderIds = new Set();
const deletingRiderIds = new Set();

const riderQuery = selector => document.querySelector(selector);

function riderEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function riderFormatDate(value) {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function riderPeso(value) {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(value) || 0);
}

function riderStatusBadge(status) {
  const normalized = String(status || "pending").toLowerCase();
  const statusClass = normalized.replace(/[^a-z0-9_-]/g, "");
  const label = riderStatusLabels[normalized] || normalized
    .split("_")
    .map(part => part ? part[0].toUpperCase() + part.slice(1) : "")
    .join(" ");

  return `<span class="status-badge status-${statusClass}">${riderEscape(label || "Unknown")}</span>`;
}

function riderAvailabilityBadge(status) {
  const statusClass = String(status || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-");
  return `<span class="rider-status-badge rider-status-${statusClass}">${riderEscape(status || "Not specified")}</span>`;
}

function hasActiveDelivery(riderId) {
  return deliveryOrders.some(order =>
    String(order.rider_id || "") === String(riderId) &&
    activeDeliveryStatuses.has(String(order.status || "").toLowerCase())
  );
}

function renderDeliveryOrders() {
  const body = riderQuery("#deliveryOrdersBody");
  if (!body) return;

  const query = (riderQuery("#deliverySearch")?.value || "").trim().toLowerCase();
  const selectedStatus = riderQuery("#deliveryStatusFilter")?.value || "all";
  const filteredOrders = deliveryOrders.filter(order => {
    const status = String(order.status || "pending").toLowerCase();
    const searchable = [
      order.id,
      order.customer_name,
      order.phone,
      order.delivery_address
    ].join(" ").toLowerCase();

    return (!query || searchable.includes(query))
      && (selectedStatus === "all" || status === selectedStatus);
  });

  if (!filteredOrders.length) {
    body.innerHTML = `<tr><td colspan="7" class="table-state">${
      deliveryOrders.length
        ? "No delivery orders match these filters."
        : "No delivery orders are available."
    }</td></tr>`;
    return;
  }

  body.innerHTML = filteredOrders.map(order => `
    <tr>
      <td><span class="rider-order-id">#${riderEscape(String(order.id))}</span></td>
      <td>
        <span class="rider-customer-cell">
          <strong>${riderEscape(order.customer_name || "Customer")}</strong>
          <small>${riderEscape(order.phone || "Phone unavailable")}</small>
        </span>
      </td>
      <td><span class="rider-address">${riderEscape(order.delivery_address || "Address unavailable")}</span></td>
      <td>${riderEscape(riderFormatDate(order.created_at))}</td>
      <td>${riderPeso(order.total)}</td>
      <td>${riderStatusBadge(order.status)}</td>
      <td>
        ${renderOrderRiderAssignment(order)}
      </td>
    </tr>
  `).join("");
}

function renderOrderRiderAssignment(order) {
  const assignedRider = riders.find(rider => String(rider.id) === String(order.rider_id));
  const isActive = activeDeliveryStatuses.has(String(order.status || "").toLowerCase());
  const canModify = (isActive || Boolean(assignedRider)) &&
    !riderLoadError &&
    !deliveryOrdersLoadError;
  const isSaving = savingDeliveryOrderIds.has(String(order.id));
  const eligibleRiders = riders.filter(rider =>
    (isActive && rider.status === "Available") || String(rider.id) === String(order.rider_id)
  );
  const riderOptions = eligibleRiders.map(rider => `
    <option value="${riderEscape(String(rider.id))}" ${String(rider.id) === String(order.rider_id) ? "selected" : ""}>
      ${riderEscape(rider.full_name)}${rider.phone ? ` — ${riderEscape(rider.phone)}` : ""}
    </option>
  `).join("");

  return `
    <div class="order-rider-assignment">
      <select
        class="order-rider-select"
        data-order-rider="${riderEscape(String(order.id))}"
        aria-label="Assign rider to order ${riderEscape(String(order.id))}"
        ${!canModify || isSaving ? "disabled" : ""}
      >
        <option value="">${assignedRider ? "Remove assignment" : "Unassigned"}</option>
        ${riderOptions}
      </select>
      ${assignedRider
        ? `<span class="assigned-rider-contact"><strong>${riderEscape(assignedRider.full_name)}</strong><small>${riderEscape(assignedRider.phone || "Phone unavailable")}${assignedRider.email ? ` · ${riderEscape(assignedRider.email)}` : ""}</small></span>`
        : `<span class="rider-unassigned">${isActive ? "No rider assigned" : "Unassigned"}</span>`}
    </div>
  `;
}

function updateRiderSummary() {
  riderQuery("#riderCount").textContent = String(riders.length);
  riderQuery("#activeRiderCount").textContent = String(
    riders.filter(rider => rider.status === "Available").length
  );
}

function renderRiders() {
  const body = riderQuery("#riderListBody");
  if (!body) return;

  const query = (riderQuery("#riderSearchInput")?.value || "").trim().toLowerCase();
  const statusFilter = riderQuery("#riderStatusFilter")?.value || "all";
  const filteredRiders = riders.filter(rider => {
    const matchesQuery = !query ||
      `${rider.full_name || ""} ${rider.phone || ""}`.toLowerCase().includes(query);
    const matchesStatus = statusFilter === "all" || rider.status === statusFilter;
    return matchesQuery && matchesStatus;
  });

  if (!filteredRiders.length) {
    body.innerHTML = `<tr><td colspan="7" class="table-state">${
      riders.length ? "No riders match the active search or status filter." : "No riders have been added yet."
    }</td></tr>`;
    return;
  }

  body.innerHTML = filteredRiders.map(rider => `
    <tr>
      <td><strong>${riderEscape(rider.full_name)}</strong></td>
      <td>
        <span class="rider-directory-contact">
          <span>${riderEscape(rider.email || "No email")}</span>
          <small>${riderEscape(rider.phone || "No phone")}</small>
        </span>
      </td>
      <td>${riderEscape(rider.vehicle_type || "Not specified")}</td>
      <td>${riderEscape(rider.plate_number || "Not specified")}</td>
      <td>${riderAvailabilityBadge(rider.status)}</td>
      <td>${riderEscape(riderFormatDate(rider.created_at))}</td>
      <td>
        <div class="rider-row-actions">
          <button class="btn btn-light" type="button" data-edit-rider="${riderEscape(String(rider.id))}">Edit</button>
          <button class="btn btn-danger" type="button" data-delete-rider="${riderEscape(String(rider.id))}">Delete</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function resetRiderForm() {
  riderQuery("#riderForm")?.reset();
  riderQuery("#riderId").value = "";
  riderQuery("#riderSaveBtn").textContent = "Add Rider";
  riderQuery("#riderCancelEditBtn").classList.add("hidden");
  updateRiderStatusOptions();
}

function updateRiderStatusOptions() {
  const select = riderQuery("#riderStatus");
  if (!select) return;
  const riderId = riderQuery("#riderId")?.value;
  const onDeliveryOption = [...select.options].find(option => option.value === "On Delivery");
  if (onDeliveryOption) {
    onDeliveryOption.disabled = !riderId || !hasActiveDelivery(riderId);
  }
}

function editRider(riderId) {
  const rider = riders.find(record => String(record.id) === String(riderId));
  if (!rider) {
    showRiderMessage("Rider not found. Refresh the page and try again.", "error");
    return;
  }

  riderQuery("#riderId").value = rider.id;
  riderQuery("#riderFullName").value = rider.full_name || "";
  riderQuery("#riderPhone").value = rider.phone || "";
  riderQuery("#riderEmail").value = rider.email || "";
  riderQuery("#riderVehicleType").value = rider.vehicle_type || "";
  riderQuery("#riderPlateNumber").value = rider.plate_number || "";
  riderQuery("#riderStatus").value = rider.status || "";
  riderQuery("#riderSaveBtn").textContent = "Save Changes";
  riderQuery("#riderCancelEditBtn").classList.remove("hidden");
  updateRiderStatusOptions();
  riderQuery("#riderFullName").focus();
}

async function saveRider(event) {
  event.preventDefault();
  if (isSavingRider) return;
  const form = event.currentTarget;
  if (!form.reportValidity()) return;

  const riderId = riderQuery("#riderId").value;
  const riderData = {
    full_name: riderQuery("#riderFullName").value.trim(),
    phone: riderQuery("#riderPhone").value.trim() || null,
    email: riderQuery("#riderEmail").value.trim() || null,
    vehicle_type: riderQuery("#riderVehicleType").value.trim() || null,
    plate_number: riderQuery("#riderPlateNumber").value.trim() || null,
    status: riderQuery("#riderStatus").value.trim()
  };

  if (!riderData.full_name || !riderData.phone || !riderData.vehicle_type || !riderData.status) {
    showRiderMessage("Full name, phone, vehicle type, and status are required.", "error");
    return;
  }

  const phoneDigits = riderData.phone.replace(/\D/g, "");
  if (phoneDigits.length < 7 || phoneDigits.length > 15) {
    showRiderMessage("Enter a valid phone number containing 7 to 15 digits.", "error");
    return;
  }

  if (!riderStatuses.includes(riderData.status)) {
    showRiderMessage("Choose Available, On Delivery, or Inactive.", "error");
    return;
  }

  if (riderId && deliveryOrdersLoadError) {
    showRiderMessage("Delivery assignments could not be checked. Refresh the delivery queue before editing rider details.", "error");
    return;
  }

  const duplicateRider = riders.find(rider =>
    String(rider.id) !== String(riderId) &&
    (
      (rider.phone || "").replace(/\D/g, "") === riderData.phone.replace(/\D/g, "") ||
      (riderData.email && String(rider.email || "").toLowerCase() === riderData.email.toLowerCase())
    )
  );
  if (duplicateRider) {
    showRiderMessage("A rider with this phone number or email already exists.", "error");
    return;
  }

  const riderHasActiveDelivery = riderId && hasActiveDelivery(riderId);
  if (riderData.status === "On Delivery" && !riderHasActiveDelivery) {
    showRiderMessage("A rider can be On Delivery only when assigned to an active delivery order.", "error");
    return;
  }
  if (riderHasActiveDelivery && riderData.status !== "On Delivery") {
    showRiderMessage("This rider has an active delivery. Remove or complete the assignment before changing availability.", "error");
    return;
  }

  const saveButton = riderQuery("#riderSaveBtn");
  isSavingRider = true;
  saveButton.disabled = true;

  try {
    const result = riderId
      ? await riderDb.from("riders").update(riderData).eq("id", riderId).select("id").maybeSingle()
      : await riderDb.from("riders").insert(riderData).select("id").single();

    if (result.error) throw result.error;
    if (!result.data?.id) throw new Error("No rider row was changed. Check your admin permissions.");

    resetRiderForm();
    if (!await loadRiders()) {
      showRiderMessage("Rider was saved, but the rider list could not be refreshed.", "error");
      return;
    }
    showRiderMessage(riderId ? "Rider details updated." : "Rider added successfully.", "success");
  } catch (error) {
    console.error("Could not save rider:", error);
    showRiderMessage(`Could not save rider: ${error.message || "Check Supabase permissions and try again."}`, "error");
  } finally {
    isSavingRider = false;
    saveButton.disabled = false;
  }
}

async function deleteRider(riderId) {
  if (deletingRiderIds.has(String(riderId))) return;
  const rider = riders.find(record => String(record.id) === String(riderId));
  if (!rider) {
    showRiderMessage("Rider not found. Refresh the page and try again.", "error");
    return;
  }
  if (deliveryOrdersLoadError) {
    showRiderMessage("Delivery assignments could not be checked. Refresh the delivery queue before deleting a rider.", "error");
    return;
  }
  if (deliveryOrders.some(order => String(order.rider_id || "") === String(rider.id))) {
    showRiderMessage("Unassign this rider from their orders before deleting the rider.", "error");
    return;
  }
  if (!window.confirm(`Delete rider "${rider.full_name}"? This cannot be undone.`)) return;

  deletingRiderIds.add(String(riderId));
  try {
    const { data, error } = await riderDb
      .from("riders")
      .delete()
      .eq("id", rider.id)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data?.id) throw new Error("No rider row was deleted. Check your admin permissions.");
    if (String(riderQuery("#riderId").value) === String(rider.id)) resetRiderForm();
    if (!await loadRiders()) {
      showRiderMessage("Rider was deleted, but the rider list could not be refreshed.", "error");
      return;
    }
    showRiderMessage("Rider deleted.", "success");
  } catch (error) {
    console.error("Could not delete rider:", error);
    showRiderMessage(`Could not delete rider: ${error.message || "Check rider assignments and Supabase permissions."}`, "error");
  } finally {
    deletingRiderIds.delete(String(riderId));
  }
}

async function loadRiders() {
  const body = riderQuery("#riderListBody");
  if (body) body.innerHTML = '<tr><td colspan="7" class="table-state">Loading riders...</td></tr>';

  try {
    const { data, error } = await riderDb
      .from("riders")
      .select("id, full_name, phone, email, vehicle_type, plate_number, status, created_at")
      .order("created_at", { ascending: false });

    if (error) throw error;
    riderLoadError = null;
    riders = data || [];
    updateRiderSummary();
    renderRiders();
    renderDeliveryOrders();
    return true;
  } catch (error) {
    riderLoadError = error;
    console.error("Could not load riders:", error);
    if (body) {
      body.innerHTML = '<tr><td colspan="7" class="table-state" role="alert">Could not load riders. Check the riders table and its Row Level Security policies.</td></tr>';
    }
    showRiderMessage("Could not load rider records. Check the riders table permissions and try again.", "error");
    return false;
  }
}

function updateDeliverySummary(orders) {
  riderQuery("#deliveryOrderCount").textContent = String(orders.length);
}

function showRiderMessage(message, type = "") {
  const target = riderQuery("#riderMessage");
  if (!target) return;
  target.textContent = message;
  target.className = `message rider-message ${type}`.trim();
}

async function loadDeliveryOrders() {
  const body = riderQuery("#deliveryOrdersBody");
  const refreshButton = riderQuery("#riderRefreshBtn");
  if (body) body.innerHTML = '<tr><td colspan="7" class="table-state">Loading delivery orders...</td></tr>';
  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.setAttribute("aria-busy", "true");
  }

  try {
    const { data, error } = await riderDb
      .from("orders")
      .select("id, customer_name, phone, delivery_address, order_type, status, total, created_at, rider_id")
      .eq("order_type", "delivery")
      .order("created_at", { ascending: false });

    if (error) throw error;

    deliveryOrdersLoadError = null;
    deliveryOrders = data || [];
    updateDeliverySummary(deliveryOrders);
    renderDeliveryOrders();
  } catch (error) {
    deliveryOrdersLoadError = error;
    console.error("Could not load delivery orders:", error);
    if (body) {
      body.innerHTML = '<tr><td colspan="7" class="table-state" role="alert">Could not load delivery orders. Please refresh and try again.</td></tr>';
    }
    showRiderMessage("Could not load delivery orders. Please try again.", "error");
  } finally {
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.removeAttribute("aria-busy");
    }
  }
}

async function assignOrderRider(orderId, riderId) {
  const orderKey = String(orderId);
  const order = deliveryOrders.find(record => String(record.id) === orderKey);
  if (!order || savingDeliveryOrderIds.has(orderKey)) return;
  if (riderLoadError || deliveryOrdersLoadError) {
    showRiderMessage("Refresh rider and delivery-order data before changing an assignment.", "error");
    return;
  }

  const isActive = activeDeliveryStatuses.has(String(order.status || "").toLowerCase());
  if (riderId && !isActive) {
    showRiderMessage("Riders can only be assigned to active delivery orders.", "error");
    renderDeliveryOrders();
    return;
  }

  const rider = riderId
    ? riders.find(record => String(record.id) === String(riderId))
    : null;
  if (riderId && (!rider || (rider.status !== "Available" && String(rider.id) !== String(order.rider_id)))) {
    showRiderMessage("That rider is not currently available. Refresh rider data and try again.", "error");
    renderDeliveryOrders();
    return;
  }

  savingDeliveryOrderIds.add(orderKey);
  renderDeliveryOrders();
  try {
    const { error } = await riderDb.rpc("assign_order_rider", {
      p_order_id: orderKey,
      p_rider_id: riderId || null
    });
    if (error) throw error;

    const refreshed = await refreshRiderData();
    if (refreshed) {
      showRiderMessage(riderId ? `Order #${orderKey} assigned to ${rider.full_name}.` : `Rider removed from order #${orderKey}.`, "success");
    } else {
      showRiderMessage("Assignment saved, but the page could not refresh. Refresh before making another assignment.", "error");
    }
  } catch (error) {
    console.error("Could not assign rider to order:", error);
    showRiderMessage(error.message || "Could not assign rider. Check the assignment migration and Supabase permissions.", "error");
    renderDeliveryOrders();
  } finally {
    savingDeliveryOrderIds.delete(orderKey);
    renderDeliveryOrders();
  }
}

async function refreshRiderData() {
  showRiderMessage("");
  const results = await Promise.all([loadRiders(), loadDeliveryOrders()]);
  return results.every(Boolean);
}

function showRiderAccessError() {
  window.location.replace("../index.html?access=profile-error");
}

async function initializeRiderManagement() {
  if (!riderDb) {
    console.error("Supabase is not initialized. Check supabase-config.js.");
    showRiderAccessError();
    return;
  }

  riderQuery("#riderRefreshBtn")?.addEventListener("click", refreshRiderData);
  riderQuery("#riderForm")?.addEventListener("submit", saveRider);
  riderQuery("#riderCancelEditBtn")?.addEventListener("click", resetRiderForm);
  riderQuery("#riderSearchInput")?.addEventListener("input", renderRiders);
  riderQuery("#riderStatusFilter")?.addEventListener("change", renderRiders);
  riderQuery("#riderClearFilters")?.addEventListener("click", () => {
    riderQuery("#riderSearchInput").value = "";
    riderQuery("#riderStatusFilter").value = "all";
    renderRiders();
  });
  riderQuery("#deliverySearch")?.addEventListener("input", renderDeliveryOrders);
  riderQuery("#deliveryStatusFilter")?.addEventListener("change", renderDeliveryOrders);
  riderQuery("#deliveryOrdersBody")?.addEventListener("change", event => {
    const assignment = event.target.closest("[data-order-rider]");
    if (assignment) {
      assignOrderRider(assignment.dataset.orderRider, assignment.value);
    }
  });
  riderQuery("#riderListBody")?.addEventListener("click", event => {
    const editButton = event.target.closest("[data-edit-rider]");
    if (editButton) {
      editRider(editButton.dataset.editRider);
      return;
    }

    const deleteButton = event.target.closest("[data-delete-rider]");
    if (deleteButton) deleteRider(deleteButton.dataset.deleteRider);
  });

  riderQuery("#riderLogoutBtn")?.addEventListener("click", async () => {
    const { error } = await riderDb.auth.signOut();
    if (error) {
      console.error("Rider management sign out failed:", error);
      showRiderMessage("Unable to sign out. Please try again.", "error");
      return;
    }
    window.location.replace("../index.html");
  });

  riderDb.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session?.user) {
      window.location.replace("../index.html?access=login-required");
    }
  });

  try {
    const { data: authData, error: authError } = await riderDb.auth.getUser();
    if (authError) throw authError;
    if (!authData?.user) {
      window.location.replace("../index.html?access=login-required");
      return;
    }

    const { data: profile, error: profileError } = await riderDb
      .from("profiles")
      .select("role")
      .eq("id", authData.user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    if (profile?.role !== "admin") {
      window.location.replace(profile?.role === "customer"
        ? "../customer/customer.html"
        : "../index.html?access=unsupported-role");
      return;
    }

    riderQuery("#riderAdminEmail").textContent = authData.user.email || "Administrator";
    riderQuery("#riderManagement").classList.remove("hidden");
    await refreshRiderData();
  } catch (error) {
    console.error("Rider management access verification failed:", error);
    showRiderAccessError();
  }
}

document.addEventListener("DOMContentLoaded", initializeRiderManagement);
