
"use strict";

const db = typeof supabaseClient !== "undefined"
  ? supabaseClient
  : window.supabaseClient;

const $ = selector => document.querySelector(selector);

const peso = amount => new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(Number(amount) || 0);

const dashboardImages = {
  logo: "../images/newlogo.png",
  roadmap: "../images/ricerush.png",
  sidebarFood: "../images/newlogo.png",
  fallback: "../images/newlogo.png"
};

const statuses = [
  "pending",
  "confirmed",
  "preparing",
  "ready",
  "out_for_delivery",
  "completed",
  "cancelled"
];

const statusLabels = {
  pending: "Pending",
  confirmed: "Confirmed",
  preparing: "Preparing",
  ready: "Ready",
  out_for_delivery: "Out for Delivery",
  completed: "Completed",
  cancelled: "Cancelled"
};

const fallbackImage = dashboardImages.fallback;

let allOrders = [];
let orderRiders = [];
let orderRidersLoadError = null;
let currentUser = null;
let orderChannel = null;
let isLoadingOrders = false;
let hasLoadedOrders = false;
const savingOrderIds = new Set();
const savingOrderRiderIds = new Set();
const pendingOrderStatuses = new Map();
const expandedOrderItems = new Set();

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function showMessage(message = "", type = "") {
  const element = $("#dashboardMessage");

  if (element) {
    element.textContent = message;
    element.className = `message ${type}`.trim();
  }
}

function getItemImage(item) {
  return (
    item?.image_url ||
    item?.image ||
    item?.menu_items?.image_url ||
    item?.menu_item?.image_url ||
    item?.product?.image_url ||
    item?.product?.image ||
    fallbackImage
  );
}

function createFoodImage(item, className = "ordered-item-image") {
  const image = escapeHTML(getItemImage(item));
  const name = escapeHTML(item?.item_name || item?.name || "Food item");

  return `
    <div class="${escapeHTML(className)}">
      <img
        src="${image}"
        alt="${name}"
        loading="lazy"
        onerror="this.onerror=null;this.src='${fallbackImage}'"
      >
    </div>
  `;
}

function formatDate(dateValue) {
  if (!dateValue) return "Date unavailable";

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return date.toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function normalizeStatus(status) {
  return String(status || "pending").toLowerCase();
}

function getStatusText(status) {
  const normalized = normalizeStatus(status);
  if (statusLabels[normalized]) return statusLabels[normalized];

  return normalized
    .split("_")
    .map(word => word ? word[0].toUpperCase() + word.slice(1) : "")
    .join(" ") || "Status unavailable";
}

function statusBadge(status) {
  const normalized = normalizeStatus(status);
  const statusClass = statuses.includes(normalized) ? normalized : "unknown";

  return `
    <span class="status-badge status-${statusClass}">
      ${escapeHTML(getStatusText(normalized))}
    </span>
  `;
}

function getOrderItems(order) {
  return Array.isArray(order?.order_items) ? order.order_items : [];
}

function getOrderTotal(order) {
  if (order?.total !== null && order?.total !== undefined) {
    return Number(order.total) || 0;
  }

  return getOrderItems(order).reduce((sum, item) => {
    if (item.line_total !== null && item.line_total !== undefined) {
      return sum + (Number(item.line_total) || 0);
    }

    return sum +
      (Number(item.unit_price) || 0) *
      (Number(item.quantity) || 0);
  }, 0);
}

function getOrderCustomer(order) {
  return (
    order.customer_name ||
    order.customer?.full_name ||
    order.customer?.name ||
    order.customer?.email ||
    "Customer"
  );
}

function getOrderItemName(item) {
  return item.item_name || item.name || "Food item";
}

function getOrderItemPrice(item) {
  if (item.line_total !== null && item.line_total !== undefined) {
    return Number(item.line_total) || 0;
  }

  return (
    (Number(item.unit_price) || Number(item.price) || 0) *
    (Number(item.quantity) || 0)
  );
}

function createOrderItem(item) {
  return `
    <div class="ordered-item-with-image">
      ${createFoodImage(item)}
      <div class="ordered-item-info">
        <strong class="ordered-item-name">
          ${escapeHTML(getOrderItemName(item))}
        </strong>
        <span class="ordered-item-quantity">
          Quantity: ${Number(item.quantity) || 0}
        </span>
        <strong class="ordered-item-price">
          ${peso(getOrderItemPrice(item))}
        </strong>
      </div>
    </div>
  `;
}

function createOrderItems(order) {
  const items = getOrderItems(order);
  const orderKey = String(order.id);
  const expanded = expandedOrderItems.has(orderKey);

  if (!items.length) {
    return `<p class="empty-state">No food items found for this order.</p>`;
  }

  if (items.length === 1) {
    return `<div class="ordered-items-list">${createOrderItem(items[0])}</div>`;
  }

  const itemsId = `order-items-${escapeHTML(orderKey)}`;

  return `
    <div class="order-item-preview" ${expanded ? "hidden" : ""}>
      ${createOrderItem(items[0])}
    </div>
    <div id="${itemsId}" class="ordered-items-list order-item-details" ${expanded ? "" : "hidden"}>
      ${items.map(createOrderItem).join("")}
    </div>
    <button
      class="order-items-toggle"
      type="button"
      data-toggle-order-items="${escapeHTML(orderKey)}"
      data-item-count="${items.length}"
      aria-expanded="${expanded}"
      aria-controls="${itemsId}"
    >
      ${expanded ? "Show fewer items" : `Show all ${items.length} items`}
    </button>
  `;
}

function createOrderCard(order) {
  const orderKey = String(order.id);
  const orderId = escapeHTML(orderKey);
  const status = normalizeStatus(order.status);
  const selectedStatus = pendingOrderStatuses.get(orderKey) ||
    (statuses.includes(status) ? status : "");
  const isSaving = savingOrderIds.has(orderKey);
  const assignedRider = orderRiders.find(rider => String(rider.id) === String(order.rider_id));
  const isActiveDelivery = order.order_type === "delivery" &&
    ["confirmed", "preparing", "ready", "out_for_delivery"].includes(status);
  const availableRiders = orderRiders.filter(rider =>
    (isActiveDelivery && rider.status === "Available") || String(rider.id) === String(order.rider_id)
  );
  const isSavingAssignment = savingOrderRiderIds.has(orderKey);

  return `
    <article class="order-card" data-order-id="${orderId}">
      <div class="order-card-header">
        <div>
          <h3>Order #${orderId}</h3>
          <p>${escapeHTML(formatDate(order.created_at))}</p>
        </div>
        ${statusBadge(status)}
      </div>

      <div class="order-customer-info">
        <p><strong>Customer:</strong> ${escapeHTML(getOrderCustomer(order))}</p>
        <p><strong>Phone:</strong> ${escapeHTML(order.phone || "No phone provided")}</p>
        <p><strong>Order Type:</strong> ${escapeHTML(order.order_type || "Not specified")}</p>
        <p><strong>Payment:</strong> ${escapeHTML(order.payment_method || "Not specified")}</p>
        <p><strong>Address:</strong> ${escapeHTML(order.delivery_address || "No address provided")}</p>
        ${order.order_note ? `<p><strong>Note:</strong> ${escapeHTML(order.order_note)}</p>` : ""}
      </div>

      ${order.order_type === "delivery" ? `
        <div class="order-rider-section">
          <div class="order-rider-copy">
            <strong>Delivery Rider</strong>
            ${assignedRider
              ? `<span>${escapeHTML(assignedRider.full_name)} · ${escapeHTML(assignedRider.phone || "Phone unavailable")}${assignedRider.email ? ` · ${escapeHTML(assignedRider.email)}` : ""}</span>`
              : `<span class="order-rider-unassigned">${order.rider_id ? "Assigned rider details unavailable" : "No rider assigned"}</span>`}
          </div>
          <label class="order-rider-control">
            <span>${order.rider_id ? "Change or remove rider" : "Assign rider"}</span>
            <select
              class="order-rider-select"
              data-order-rider-id="${orderId}"
              aria-label="Assign rider to order ${orderId}"
              ${(!isActiveDelivery && !order.rider_id) || isSavingAssignment || Boolean(orderRidersLoadError) ? "disabled" : ""}
            >
              <option value="">${order.rider_id ? "Remove assignment" : "Unassigned"}</option>
              ${availableRiders.map(rider => `
                <option value="${escapeHTML(String(rider.id))}" ${String(rider.id) === String(order.rider_id) ? "selected" : ""}>
                  ${escapeHTML(rider.full_name)} — ${escapeHTML(rider.phone)}
                </option>
              `).join("")}
            </select>
            ${orderRidersLoadError ? `<small class="order-rider-error">Riders could not be loaded.</small>` : ""}
            ${!isActiveDelivery && !order.rider_id ? `<small>Assignment is available after the order is confirmed.</small>` : ""}
          </label>
        </div>
      ` : ""}

      <div class="order-items-section">
        <h4>Ordered Food</h4>
        ${createOrderItems(order)}
      </div>

      <div class="order-card-footer">
        <div class="order-total">
          <span>Total</span>
          <strong>${peso(getOrderTotal(order))}</strong>
        </div>

        <label class="order-status-control">
          <span>Update Status</span>
          <select
            class="order-status-select"
            data-order-id="${orderId}"
            aria-label="Update status for order ${orderId}"
            ${isSaving ? "disabled" : ""}
          >
            ${statuses.includes(status) ? "" : `
              <option value="" selected disabled>${escapeHTML(getStatusText(status))}</option>
            `}
            ${statuses.map(option => `
              <option value="${option}" ${option === selectedStatus ? "selected" : ""}>
                ${escapeHTML(statusLabels[option])}
              </option>
            `).join("")}
          </select>
          <span class="order-saving-indicator ${isSaving ? "" : "hidden"}" role="status">Saving...</span>
        </label>
      </div>
    </article>
  `;
}

function getFilteredOrders() {
  const search = ($("#searchInput")?.value || "").trim().toLowerCase();
  const selectedStatus = $("#statusFilter")?.value || "all";

  return allOrders.filter(order => {
    const matchesStatus =
      selectedStatus === "all" ||
      normalizeStatus(order.status) === selectedStatus;

    const searchableText = [
      order.id,
      order.customer_name,
      order.phone,
      order.delivery_address,
      order.payment_method,
      ...getOrderItems(order).map(getOrderItemName)
    ].join(" ").toLowerCase();

    return matchesStatus &&
      (!search || searchableText.includes(search));
  });
}

function renderOrders() {
  const ordersList = $("#ordersList");
  if (!ordersList || !hasLoadedOrders) return;

  const filteredOrders = getFilteredOrders();
  const selectedStatus = $("#statusFilter")?.value || "all";
  const search = ($("#searchInput")?.value || "").trim();

  if (filteredOrders.length) {
    ordersList.innerHTML = filteredOrders.map(createOrderCard).join("");
  } else if (!allOrders.length) {
    ordersList.innerHTML = `<div class="empty-state" role="status">No orders found.</div>`;
  } else if (selectedStatus !== "all" && !search) {
    ordersList.innerHTML = `
      <div class="empty-state" role="status">
        <p>No orders found for this status.</p>
        <button class="btn btn-light" type="button" data-clear-status-filter>
          Show All Statuses
        </button>
      </div>
    `;
  } else {
    ordersList.innerHTML =
      `<div class="empty-state" role="status">No orders match your search or selected status.</div>`;
  }

  ordersList.setAttribute("aria-busy", String(isLoadingOrders));

  const summary = $("#orderSummary");

  if (summary) {
    summary.textContent = `${filteredOrders.length} of ${allOrders.length} orders`;
  }
}

function updateDashboardStats() {
  const total = allOrders.length;

  const completed = allOrders.filter(order =>
    normalizeStatus(order.status) === "completed"
  );

  const cancelled = allOrders.filter(order =>
    normalizeStatus(order.status) === "cancelled"
  );

  const revenue = completed.reduce(
    (sum, order) => sum + getOrderTotal(order),
    0
  );

  if ($("#totalRevenue")) $("#totalRevenue").textContent = peso(revenue);
  if ($("#revenueState")) $("#revenueState").textContent = "Completed orders only";
  if ($("#totalCount")) $("#totalCount").textContent = total;
  if ($("#ordersState")) $("#ordersState").textContent = "All customer orders";
  if ($("#cancelledCount")) $("#cancelledCount").textContent = cancelled.length;
  if ($("#cancelledState")) $("#cancelledState").textContent = "Orders marked cancelled";
  if ($("#reportTotalOrders")) $("#reportTotalOrders").textContent = total;
  if ($("#reportCompletedOrders")) $("#reportCompletedOrders").textContent = completed.length;
  if ($("#reportCancelledOrders")) $("#reportCancelledOrders").textContent = cancelled.length;
  if ($("#reportRevenue")) $("#reportRevenue").textContent = peso(revenue);
}

function setDashboardDataUnavailable() {
  for (const [valueSelector, stateSelector] of [
    ["#totalRevenue", "#revenueState"],
    ["#totalCount", "#ordersState"],
    ["#cancelledCount", "#cancelledState"]
  ]) {
    const value = $(valueSelector);
    const state = $(stateSelector);
    if (value) value.textContent = "Unavailable";
    if (state) state.textContent = "Could not load dashboard data";
  }

  const customersBody = $("#topCustomersBody");
  if (customersBody) {
    customersBody.innerHTML =
      '<tr><td colspan="4" class="table-state" role="alert">Could not load customer activity.</td></tr>';
  }

  const trendingList = $("#trendingDishesList");
  if (trendingList) {
    trendingList.innerHTML =
      '<p class="panel-state" role="alert">Could not load dish activity.</p>';
  }
}

function renderTopCustomers(orders) {
  const body = $("#topCustomersBody");
  if (!body) return;

  const customers = new Map();

  for (const order of orders) {
    const customerId = order.customer_id;
    const key = customerId
      ? `id:${customerId}`
      : `order:${order.id}`;
    const existing = customers.get(key);
    const timestamp = order.created_at
      ? new Date(order.created_at).getTime()
      : 0;

    if (existing) {
      existing.orderCount += 1;
      if (timestamp > existing.lastOrderTime) {
        existing.lastOrderTime = timestamp;
        existing.lastOrder = order.created_at;
      }
      if (!existing.phone && order.phone) existing.phone = order.phone;
      if ((!existing.name || existing.name === "Customer") && order.customer_name) {
        existing.name = order.customer_name;
      }
      continue;
    }

    customers.set(key, {
      name: order.customer_name || "Customer",
      phone: order.phone || "Not provided",
      orderCount: 1,
      lastOrderTime: timestamp,
      lastOrder: order.created_at
    });
  }

  const topCustomers = [...customers.values()]
    .sort((a, b) =>
      b.orderCount - a.orderCount ||
      b.lastOrderTime - a.lastOrderTime
    )
    .slice(0, 5);

  if (!topCustomers.length) {
    body.innerHTML =
      '<tr><td colspan="4" class="table-state">No customer order data is available yet.</td></tr>';
    return;
  }

  body.innerHTML = topCustomers.map(customer => `
    <tr>
      <td><span class="customer-name-cell"><span class="customer-table-avatar" aria-hidden="true">♙</span>${escapeHTML(customer.name)}</span></td>
      <td>${escapeHTML(customer.phone)}</td>
      <td><span class="customer-order-count">${customer.orderCount}</span></td>
      <td>${escapeHTML(formatDate(customer.lastOrder))}</td>
    </tr>
  `).join("");
}

function renderTrendingDishes(orders, menuItems, menuError = null) {
  const container = $("#trendingDishesList");
  if (!container) return;

  if (menuError) {
    container.innerHTML =
      '<p class="panel-state" role="alert">Dish images and prices could not be loaded. Try refreshing the dashboard.</p>';
    return;
  }

  const menuById = new Map(
    menuItems.map(item => [String(item.id), item])
  );
  const dishes = new Map();

  for (const order of orders) {
    for (const item of getOrderItems(order)) {
      const key = item.menu_item_id !== null && item.menu_item_id !== undefined
        ? `id:${item.menu_item_id}`
        : `name:${String(getOrderItemName(item)).toLowerCase()}`;
      const menuItem = item.menu_item_id === null || item.menu_item_id === undefined
        ? null
        : menuById.get(String(item.menu_item_id));
      const quantity = Number(item.quantity) || 0;
      const existing = dishes.get(key);

      if (existing) {
        existing.quantitySold += quantity;
        continue;
      }

      dishes.set(key, {
        name: menuItem?.name || getOrderItemName(item),
        price: menuItem?.price == null
          ? Number(item.unit_price) || 0
          : Number(menuItem.price) || 0,
        image: menuItem?.image_url || item.image_url || fallbackImage,
        quantitySold: quantity
      });
    }
  }

  const trendingDishes = [...dishes.values()]
    .sort((a, b) => b.quantitySold - a.quantitySold)
    .slice(0, 5);

  if (!trendingDishes.length) {
    container.innerHTML =
      '<p class="panel-state">No dish sales are available yet.</p>';
    return;
  }

  container.innerHTML = trendingDishes.map(dish => `
    <article class="trending-dish">
      ${createFoodImage({
        image_url: dish.image,
        item_name: dish.name
      }, "trending-dish-image")}
      <div class="trending-dish-info">
        <strong>${escapeHTML(dish.name)}</strong>
        <span>${peso(dish.price)}</span>
      </div>
      <span class="trending-dish-count">${dish.quantitySold} sold</span>
    </article>
  `).join("");
}

async function loadOrderRiders() {
  const { data, error } = await db
    .from("riders")
    .select("id, full_name, phone, email, status")
    .order("full_name", { ascending: true });

  if (error) {
    orderRidersLoadError = error;
    orderRiders = [];
    console.error("Could not load riders for order management:", error);
    return false;
  }

  orderRidersLoadError = null;
  orderRiders = data || [];
  return true;
}

function initializeDashboardImages() {
  document.querySelectorAll("[data-dashboard-image]").forEach(image => {
    const imageName = image.dataset.dashboardImage;
    const imagePath = dashboardImages[imageName];

    if (!imagePath) {
      console.error(`No dashboard image is configured for "${imageName}".`);
      return;
    }

    image.src = imagePath;
  });
}

const customerFilterState = {
  search: "",
  status: "all",
  sort: "name",
  selectedCustomerId: null,
  records: []
};

function getCustomerStatusLabel(customer) {
  const lastOrderDate = customer.lastOrder ? new Date(customer.lastOrder) : null;
  if (!lastOrderDate || Number.isNaN(lastOrderDate.getTime())) {
    return "Inactive";
  }

  const diffDays = (Date.now() - lastOrderDate.getTime()) / 86400000;
  return diffDays <= 30 ? "Active" : "Inactive";
}

function formatCustomerStatusBadge(status) {
  const normalized = status === "Active" ? "active" : "inactive";

  return `<span class="customer-status-badge customer-status-${normalized}">${escapeHTML(status)}</span>`;
}

function getCustomerDisplayName(customer) {
  return customer.name || "Guest Customer";
}

function getCustomerTableRows(customers) {
  const query = customerFilterState.search.trim().toLowerCase();
  const statusFilter = customerFilterState.status;

  const filtered = customers.filter(customer => {
    const searchableText = [
      customer.name,
      customer.email,
      customer.phone,
      customer.lastOrder
    ].join(" ").toLowerCase();

    const matchesSearch = !query || searchableText.includes(query);
    const matchesStatus = statusFilter === "all"
      || getCustomerStatusLabel(customer).toLowerCase() === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const sorted = [...filtered].sort((left, right) => {
    switch (customerFilterState.sort) {
      case "orders":
        return (right.orderCount || 0) - (left.orderCount || 0);
      case "lastOrder": {
        const leftDate = left.lastOrder ? new Date(left.lastOrder).getTime() : 0;
        const rightDate = right.lastOrder ? new Date(right.lastOrder).getTime() : 0;
        return rightDate - leftDate;
      }
      case "totalSpent":
        return (right.totalSpent || 0) - (left.totalSpent || 0);
      case "name":
      default:
        return (left.name || "").localeCompare(right.name || "");
    }
  });

  return sorted;
}

function renderCustomerDetailPane(selectedCustomer) {
  const details = document.getElementById("customerDetails");
  if (!details) return;

  if (!selectedCustomer) {
    details.innerHTML = '<div class="empty-state">Select a customer to view their details.</div>';
    return;
  }

  const status = getCustomerStatusLabel(selectedCustomer);
  const orderCount = selectedCustomer.orderCount || 0;
  const lastOrder = selectedCustomer.lastOrder ? formatDate(selectedCustomer.lastOrder) : "No completed order yet";

  const recentOrders = selectedCustomer.orders.slice(0, 5).map(order => `
    <li class="customer-order-list-item">
      <div>
        <strong>#${escapeHTML(String(order.id))}</strong>
        <span>${escapeHTML(formatDate(order.created_at))}</span>
      </div>
      <div class="customer-order-meta">
        <span>${escapeHTML(getStatusText(order.status || "pending"))}</span>
        <strong>${peso(order.total || 0)}</strong>
      </div>
    </li>
  `).join("");

  details.innerHTML = `
    <div class="customer-detail-header">
      <div class="customer-detail-avatar" aria-hidden="true">${escapeHTML((getCustomerDisplayName(selectedCustomer).trim().charAt(0) || "C").toUpperCase())}</div>
      <div>
        <h3>${escapeHTML(getCustomerDisplayName(selectedCustomer))}</h3>
        <p>${escapeHTML(selectedCustomer.email || "No email on file")}</p>
      </div>
      ${formatCustomerStatusBadge(status)}
    </div>

    <dl class="customer-detail-list">
      <div>
        <dt>Phone</dt>
        <dd>${escapeHTML(selectedCustomer.phone || "Not provided")}</dd>
      </div>
      <div>
        <dt>Member since</dt>
        <dd>${escapeHTML(selectedCustomer.createdAt ? formatDate(selectedCustomer.createdAt) : "Unavailable")}</dd>
      </div>
      <div>
        <dt>Total orders</dt>
        <dd>${orderCount}</dd>
      </div>
      <div>
        <dt>Total spent</dt>
        <dd>${peso(selectedCustomer.totalSpent || 0)}</dd>
      </div>
      <div>
        <dt>Last order</dt>
        <dd>${escapeHTML(lastOrder)}</dd>
      </div>
    </dl>

    <div class="customer-activity-block">
      <h4>Recent orders</h4>
      <ul class="customer-order-list">
        ${recentOrders || '<li class="empty-state">No orders found for this customer.</li>'}
      </ul>
    </div>
  `;
}

function renderCustomerTable() {
  const body = document.getElementById("customerListBody");
  if (!body) return;

  const filteredCustomers = getCustomerTableRows(customerFilterState.records);
  const selectedCustomer = filteredCustomers.find(customer => customer.id === customerFilterState.selectedCustomerId)
    || filteredCustomers[0]
    || null;

  if (selectedCustomer) {
    customerFilterState.selectedCustomerId = selectedCustomer.id;
  } else {
    customerFilterState.selectedCustomerId = null;
  }

  renderCustomerDetailPane(selectedCustomer);

  if (!filteredCustomers.length) {
    body.innerHTML = '<tr><td colspan="5" class="table-state">No customers match the active filters.</td></tr>';
    return;
  }

  body.innerHTML = filteredCustomers.map(customer => {
    const active = customer.id === selectedCustomer?.id;
    return `
      <tr class="customer-row ${active ? "customer-row-selected" : ""}" data-customer-row-id="${escapeHTML(String(customer.id))}" tabindex="0">
        <td>
          <span class="customer-name-cell">
            <span class="customer-table-avatar" aria-hidden="true">${escapeHTML((getCustomerDisplayName(customer).trim().charAt(0) || "C").toUpperCase())}</span>
            <span>${escapeHTML(getCustomerDisplayName(customer))}</span>
          </span>
        </td>
        <td>
          <div class="customer-contact-stack">
            <span>${escapeHTML(customer.email || "No email")}</span>
            <small>${escapeHTML(customer.phone || "No phone")}</small>
          </div>
        </td>
        <td><span class="customer-order-count">${customer.orderCount || 0}</span></td>
        <td>${peso(customer.totalSpent || 0)}</td>
        <td>${formatCustomerStatusBadge(getCustomerStatusLabel(customer))}</td>
      </tr>
    `;
  }).join("");

  document.querySelectorAll("[data-customer-row-id]").forEach(row => {
    row.addEventListener("click", () => {
      customerFilterState.selectedCustomerId = row.dataset.customerRowId;
      renderCustomerTable();
    });

    row.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        customerFilterState.selectedCustomerId = row.dataset.customerRowId;
        renderCustomerTable();
      }
    });
  });
}

function updateCustomerSummary(customers) {
  const total = customers.length;
  const active = customers.filter(customer => getCustomerStatusLabel(customer) === "Active").length;
  const inactive = total - active;
  const totalSales = customers.reduce((sum, customer) => sum + (Number(customer.totalSpent) || 0), 0);

  document.getElementById("customerTotalCount")?.replaceChildren(document.createTextNode(String(total)));
  document.getElementById("customerActiveCount")?.replaceChildren(document.createTextNode(String(active)));
  document.getElementById("customerInactiveCount")?.replaceChildren(document.createTextNode(String(inactive)));
  document.getElementById("customerSalesTotal")?.replaceChildren(document.createTextNode(peso(totalSales)));
}

async function loadCustomers() {
  const body = document.getElementById("customerListBody");
  if (!body) return;

  body.innerHTML = '<tr><td colspan="5" class="table-state">Loading customer records...</td></tr>';

  try {
    const orderResponse = await db
      .from("orders")
      .select("id, customer_id, customer_name, phone, total, created_at, status")
      .order("created_at", { ascending: false });

    if (orderResponse.error) throw orderResponse.error;

    let profiles = [];
    try {
      const profileResponse = await db
        .from("profiles")
        .select("id, full_name, email, phone, created_at")
        .limit(1000);

      if (profileResponse.error) {
        console.warn("Profiles not available for customer list.", profileResponse.error);
      } else {
        profiles = profileResponse.data || [];
      }
    } catch (profileError) {
      console.warn("Profiles lookup unavailable for customer list.", profileError);
    }

    const profileMap = new Map((profiles || []).map(profile => [String(profile.id), profile]));
    const customerMap = new Map();

    (orderResponse.data || []).forEach(order => {
      const customerId = order.customer_id ? String(order.customer_id) : null;
      const profile = customerId ? profileMap.get(customerId) : null;
      const normalizedKey = customerId || `guest-${String(order.customer_name || order.phone || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
      const customer = customerMap.get(normalizedKey) || {
        id: normalizedKey,
        name: profile?.full_name || order.customer_name || "Guest Customer",
        email: profile?.email || "",
        phone: order.phone || profile?.phone || "",
        createdAt: profile?.created_at || order.created_at || null,
        totalSpent: 0,
        orderCount: 0,
        lastOrder: null,
        orders: []
      };

      customer.orderCount += 1;
      customer.totalSpent += Number(order.total) || 0;
      customer.lastOrder = customer.lastOrder && new Date(customer.lastOrder) > new Date(order.created_at || customer.lastOrder)
        ? customer.lastOrder
        : order.created_at || customer.lastOrder;
      customer.orders.push(order);

      if (!customer.email && profile?.email) customer.email = profile.email;
      if (!customer.phone && profile?.phone) customer.phone = profile.phone;
      if (!customer.name || customer.name === "Guest Customer") {
        customer.name = profile?.full_name || order.customer_name || "Guest Customer";
      }
      if (!customer.createdAt && profile?.created_at) customer.createdAt = profile.created_at;

      customerMap.set(normalizedKey, customer);
    });

    const customerRecords = [...customerMap.values()].map(customer => ({
      ...customer,
      name: customer.name || "Guest Customer",
      totalSpent: Number(customer.totalSpent) || 0,
      orderCount: Number(customer.orderCount) || 0,
      lastOrder: customer.lastOrder || null
    }));

    customerFilterState.records = customerRecords;
    customerFilterState.selectedCustomerId = customerRecords[0]?.id || null;
    updateCustomerSummary(customerRecords);
    renderCustomerTable();
    showMessage("", "");
  } catch (error) {
    console.error("Failed to load customer records:", error);
    body.innerHTML = `
      <tr>
        <td colspan="5" class="table-state" role="alert">
          Could not load customer records. Please try again.
        </td>
      </tr>
    `;
    showMessage("Could not load customer records. Please try again.", "error");
  }
}

function resetCustomerFilters() {
  customerFilterState.search = "";
  customerFilterState.status = "all";
  customerFilterState.sort = "name";

  const searchInput = document.getElementById("customerSearchInput");
  const statusFilter = document.getElementById("customerStatusFilter");
  const sortSelect = document.getElementById("customerSortSelect");

  if (searchInput) searchInput.value = "";
  if (statusFilter) statusFilter.value = "all";
  if (sortSelect) sortSelect.value = "name";

  renderCustomerTable();
}

function exportCustomerCsv() {
  const rows = getCustomerTableRows(customerFilterState.records);
  const csvRows = [
    ["Customer Name", "Email", "Phone", "Orders", "Total Spent", "Last Order", "Status"],
    ...rows.map(customer => [
      customer.name,
      customer.email,
      customer.phone,
      String(customer.orderCount || 0),
      String(customer.totalSpent || 0),
      customer.lastOrder || "",
      getCustomerStatusLabel(customer)
    ])
  ];

  const csvContent = csvRows
    .map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "rice-rush-customers.csv";
  anchor.click();
  URL.revokeObjectURL(url);
  showMessage("Customer export downloaded.", "success");
}

async function loadOrders() {
  if (isLoadingOrders || !db) return;

  isLoadingOrders = true;
  setRefreshButtons(true);

  const ordersList = $("#ordersList");
  if (ordersList) {
    ordersList.setAttribute("aria-busy", "true");
    if (!hasLoadedOrders) {
      ordersList.innerHTML = '<div class="empty-state" role="status">Loading orders...</div>';
    }
  }

  try {
    const { data, error } = await db
      .from("orders")
      .select(`
        id,
        customer_id,
        rider_id,
        customer_name,
        phone,
        order_type,
        delivery_address,
        order_note,
        payment_method,
        status,
        total,
        created_at,
        order_items (*)
      `)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const orders = data || [];
    await loadOrderRiders();

    const menuItemIds = [
      ...new Set(
        orders.flatMap(order =>
          getOrderItems(order)
            .map(item => item.menu_item_id)
            .filter(id => id !== null && id !== undefined)
        )
      )
    ];

    const imageMap = new Map();
    let menuItems = [];
    let menuError = null;

    if (menuItemIds.length) {
      const { data, error } = await db
        .from("menu_items")
        .select("id, name, price, image_url")
        .in("id", menuItemIds);

      if (error) {
        menuError = error;
        console.error("Failed to load menu data for trending dishes:", error);
      } else {
        menuItems = data || [];
      }

      menuItems.forEach(item => {
        imageMap.set(String(item.id), item.image_url || "");
      });
    }

    allOrders = orders.map(order => ({
      ...order,
      order_items: getOrderItems(order).map(item => ({
        ...item,
        image_url:
          item.image_url ||
          imageMap.get(String(item.menu_item_id)) ||
          fallbackImage
      }))
    }));

    hasLoadedOrders = true;
    renderOrders();
    updateDashboardStats();
    renderTopCustomers(allOrders);
    renderTrendingDishes(allOrders, menuItems, menuError);
    if (orderRidersLoadError) {
      showMessage("Orders loaded, but rider assignments are unavailable. Check rider table access and the rider-management migration.", "error");
    } else {
      showMessage("");
    }
  } catch (error) {
    console.error("Failed to load orders:", error);
    if (!hasLoadedOrders) {
      setDashboardDataUnavailable();
      if (ordersList) {
        ordersList.innerHTML = `
          <div class="empty-state" role="alert">
            <p>Could not load orders. Please try again.</p>
            <button class="btn btn-light" type="button" data-retry-orders>
              Try Again
            </button>
          </div>
        `;
      }
      if ($("#orderSummary")) {
        $("#orderSummary").textContent = "Orders could not be loaded.";
      }
    }
    showMessage("Could not load orders. Please try again.", "error");
  } finally {
    isLoadingOrders = false;
    setRefreshButtons(false);
    ordersList?.setAttribute("aria-busy", "false");
  }
}

async function updateOrderStatus(orderId, newStatus) {
  if (!statuses.includes(newStatus)) {
    showMessage("Invalid order status.", "error");
    return;
  }

  const orderKey = String(orderId);
  if (savingOrderIds.has(orderKey)) return;

  const previousOrder = allOrders.find(
    order => String(order.id) === orderKey
  );

  if (!previousOrder) {
    showMessage("Order not found.", "error");
    return;
  }

  const previousStatus = normalizeStatus(previousOrder.status);

  if (previousStatus === newStatus) return;

  savingOrderIds.add(orderKey);
  pendingOrderStatuses.set(orderKey, newStatus);
  renderOrders();
  let savedStatus = null;

  try {
    const { error } = await db
      .from("orders")
      .update({ status: newStatus })
      .eq("id", orderId);

    if (error) throw error;
    savedStatus = newStatus;
    allOrders = allOrders.map(order =>
      String(order.id) === orderKey
        ? { ...order, status: savedStatus }
        : order
    );
  } catch (error) {
    console.error("Failed to update order status:", error);
    showMessage("Unable to update the order status. Please try again.", "error");
  } finally {
    savingOrderIds.delete(orderKey);
    pendingOrderStatuses.delete(orderKey);
    renderOrders();
    updateDashboardStats();
  }

  if (savedStatus) {
    await loadOrderRiders();
    renderOrders();
    showMessage(
      `Order #${orderId} updated to ${statusLabels[savedStatus]}.`,
      "success"
    );
  }
}

async function updateOrderRider(orderId, riderId) {
  const orderKey = String(orderId);
  const order = allOrders.find(item => String(item.id) === orderKey);
  if (!order || savingOrderRiderIds.has(orderKey)) return;

  const isActiveDelivery = order.order_type === "delivery" &&
    ["confirmed", "preparing", "ready", "out_for_delivery"].includes(normalizeStatus(order.status));
  if (riderId && !isActiveDelivery) {
    showMessage("Riders can only be assigned to confirmed active delivery orders.", "error");
    renderOrders();
    return;
  }

  const selectedRider = riderId
    ? orderRiders.find(rider => String(rider.id) === String(riderId))
    : null;
  if (riderId && (!selectedRider ||
      (selectedRider.status !== "Available" && String(selectedRider.id) !== String(order.rider_id)))) {
    showMessage("That rider is not available. Refresh the dashboard and try again.", "error");
    renderOrders();
    return;
  }

  savingOrderRiderIds.add(orderKey);
  renderOrders();
  try {
    const { error } = await db.rpc("assign_order_rider", {
      p_order_id: orderKey,
      p_rider_id: riderId || null
    });
    if (error) throw error;

    allOrders = allOrders.map(item =>
      String(item.id) === orderKey
        ? { ...item, rider_id: riderId || null }
        : item
    );
    await loadOrderRiders();
    renderOrders();
    showMessage(riderId
      ? `Order #${orderKey} assigned to ${selectedRider.full_name}.`
      : `Rider removed from order #${orderKey}.`, "success");
  } catch (error) {
    console.error("Failed to assign rider to order:", error);
    showMessage(error.message || "Unable to assign this rider. Check the rider-management migration and Supabase permissions.", "error");
    renderOrders();
  } finally {
    savingOrderRiderIds.delete(orderKey);
    renderOrders();
  }
}

function setRefreshButtons(isRefreshing) {
  document.querySelectorAll("[data-refresh-orders]").forEach(button => {
    const label = button.querySelector("[data-refresh-label]");
    if (label) {
      label.textContent = isRefreshing
        ? "Refreshing..."
        : button.id === "refreshBtn" ? "Refresh" : "Refresh Orders";
    }

    button.disabled = isRefreshing;
    button.setAttribute("aria-busy", String(isRefreshing));
  });
}

function showSection(sectionName) {
  document.querySelectorAll(".content-section").forEach(section => {
    section.classList.toggle("hidden", section.id !== `section-${sectionName}`);
  });

  document.querySelectorAll(".nav-item[data-section]").forEach(button => {
    button.classList.toggle("active", button.dataset.section === sectionName);
  });

  if (sectionName === "orders") renderOrders();
  if (sectionName === "customers") loadCustomers();
}

async function verifyAdmin(user) {
  if (!user?.id) {
    throw new Error("Unable to verify your account.");
  }

  const { data, error } = await db
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Profile role verification failed:", error);
    throw new Error("Unable to verify your account role.");
  }

  if (!data?.role) {
    throw new Error("Your account role is missing.");
  }

  return data.role;
}

function showDashboard(user) {
  currentUser = user;

  $("#dashboard")?.classList.remove("hidden");
  $("#logoutBtn")?.classList.remove("hidden");

  if ($("#adminEmail")) $("#adminEmail").textContent = user.email || "Administrator";
  if ($("#settingsEmail")) $("#settingsEmail").value = user.email || "";
  if ($("#accountEmail")) $("#accountEmail").textContent = user.email || "Email unavailable";
  if ($("#sidebarAdminName")) $("#sidebarAdminName").textContent = user.email || "Administrator";
  if ($("#accountName")) $("#accountName").textContent = user.email || "Administrator";

  const initial = (user.email || "A").trim().charAt(0).toUpperCase();
  if ($("#adminAvatar")) $("#adminAvatar").textContent = initial;
  if ($("#accountAvatar")) $("#accountAvatar").textContent = initial;

  showSection("overview");
  loadOrders();
  subscribeToOrderChanges();
}

async function handleLogout() {
  try {
    const { error } = await db.auth.signOut();
    if (error) throw error;

    window.location.replace("../index.html");
  } catch (error) {
    console.error("Logout failed:", error);
    showMessage("Unable to log out. Please try again.", "error");
  }
}

function subscribeToOrderChanges() {
  if (orderChannel) {
    db.removeChannel(orderChannel);
    orderChannel = null;
  }

  orderChannel = db
    .channel("admin-orders-updates")
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "orders"
    }, () => loadOrders())
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "order_items"
    }, () => loadOrders())
    .on("postgres_changes", {
      event: "*",
      schema: "public",
      table: "riders"
    }, () => loadOrders())
    .subscribe();
}

function redirectToSharedLogin(accessReason) {
  window.location.replace(`../index.html?access=${accessReason}`);
}

async function initializeAdmin() {
  initializeDashboardImages();

  if (!db) {
    console.error("Supabase is not initialized. Check supabase-config.js.");
    redirectToSharedLogin("profile-error");
    return;
  }

  $("#logoutBtn")?.addEventListener("click", handleLogout);

  document.querySelectorAll("[data-section]").forEach(button => {
    button.addEventListener("click", () => showSection(button.dataset.section));
  });

  $("#searchInput")?.addEventListener("input", renderOrders);
  $("#statusFilter")?.addEventListener("change", renderOrders);

  $("#customerSearchInput")?.addEventListener("input", event => {
    customerFilterState.search = event.target.value.trim();
    renderCustomerTable();
  });

  $("#customerStatusFilter")?.addEventListener("change", event => {
    customerFilterState.status = event.target.value;
    renderCustomerTable();
  });

  $("#customerSortSelect")?.addEventListener("change", event => {
    customerFilterState.sort = event.target.value;
    renderCustomerTable();
  });

  $("#customerResetBtn")?.addEventListener("click", resetCustomerFilters);
  $("#customerExportBtn")?.addEventListener("click", exportCustomerCsv);
  $("[data-customer-refresh]")?.addEventListener("click", loadCustomers);

  document.addEventListener("change", event => {
    const riderSelect = event.target.closest(".order-rider-select");
    if (riderSelect?.dataset.orderRiderId) {
      updateOrderRider(riderSelect.dataset.orderRiderId, riderSelect.value);
      return;
    }

    const select = event.target.closest(".order-status-select");
    if (!select) return;

    updateOrderStatus(select.dataset.orderId, select.value);
  });

  document.querySelectorAll("[data-refresh-orders]").forEach(button => {
    button.addEventListener("click", loadOrders);
  });

  document.addEventListener("click", event => {
    const itemsToggle = event.target.closest("[data-toggle-order-items]");
    if (itemsToggle) {
      const orderKey = itemsToggle.dataset.toggleOrderItems;
      const orderCard = itemsToggle.closest(".order-card");
      const preview = orderCard?.querySelector(".order-item-preview");
      const details = orderCard?.querySelector(".order-item-details");
      const expanded = itemsToggle.getAttribute("aria-expanded") !== "true";

      if (expanded) {
        expandedOrderItems.add(orderKey);
      } else {
        expandedOrderItems.delete(orderKey);
      }

      if (preview) preview.hidden = expanded;
      if (details) details.hidden = !expanded;
      itemsToggle.setAttribute("aria-expanded", String(expanded));
      itemsToggle.textContent = expanded
        ? "Show fewer items"
        : `Show all ${itemsToggle.dataset.itemCount} items`;
      return;
    }

    if (event.target.closest("[data-clear-status-filter]")) {
      $("#statusFilter").value = "all";
      renderOrders();
    }

    if (event.target.closest("[data-retry-orders]")) {
      loadOrders();
    }
  });

  db.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session?.user) {
      redirectToSharedLogin("login-required");
    }
  });

  try {
    const { data, error } = await db.auth.getUser();

    if (error) throw error;

    const user = data?.user;

    if (!user) {
      redirectToSharedLogin("login-required");
      return;
    }

    const role = await verifyAdmin(user);

    if (role === "customer") {
      window.location.replace("../customer/customer.html");
      return;
    }

    if (role !== "admin") {
      redirectToSharedLogin("unsupported-role");
      return;
    }

    showDashboard(user);
    const requestedSection = window.location.hash.replace(/^#section-/, "");
    if (["overview", "orders", "customers", "reports", "settings", "account"].includes(requestedSection)) {
      showSection(requestedSection);
    }
  } catch (error) {
    console.error("Admin session verification failed:", error);
    redirectToSharedLogin("profile-error");
  }
}

document.addEventListener("DOMContentLoaded", initializeAdmin);
