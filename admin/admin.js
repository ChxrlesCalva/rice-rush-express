
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
let currentUser = null;
let orderChannel = null;
let isLoadingOrders = false;

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
  const normalized = String(status || "pending").toLowerCase();
  return statuses.includes(normalized) ? normalized : "pending";
}

function statusBadge(status) {
  const normalized = normalizeStatus(status);

  return `
    <span class="status-badge status-${normalized}">
      ${escapeHTML(statusLabels[normalized])}
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

function createOrderItems(order) {
  const items = getOrderItems(order);

  if (!items.length) {
    return `<p class="empty-state">No food items found for this order.</p>`;
  }

  return `
    <div class="ordered-items-list">
      ${items.map(item => `
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
      `).join("")}
    </div>
  `;
}

function createOrderCard(order) {
  const orderId = escapeHTML(order.id);
  const status = normalizeStatus(order.status);

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
          >
            ${statuses.map(option => `
              <option value="${option}" ${option === status ? "selected" : ""}>
                ${escapeHTML(statusLabels[option])}
              </option>
            `).join("")}
          </select>
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
  if (!ordersList) return;

  const filteredOrders = getFilteredOrders();

  ordersList.innerHTML = filteredOrders.length
    ? filteredOrders.map(createOrderCard).join("")
    : `<div class="empty-state">No orders match your search or selected status.</div>`;

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

async function loadOrders() {
  if (isLoadingOrders || !db) return;

  isLoadingOrders = true;

  try {
    const { data, error } = await db
      .from("orders")
      .select(`
        id,
        customer_id,
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

    renderOrders();
    updateDashboardStats();
    renderTopCustomers(allOrders);
    renderTrendingDishes(allOrders, menuItems, menuError);
    showMessage("");
  } catch (error) {
    console.error("Failed to load orders:", error);
    setDashboardDataUnavailable();
    $("#ordersList").innerHTML =
      '<div class="empty-state" role="alert">Could not load orders. Please refresh and try again.</div>';
    showMessage(error.message || "Unable to load orders. Please try again.", "error");
  } finally {
    isLoadingOrders = false;
  }
}

async function updateOrderStatus(orderId, newStatus, selectElement) {
  if (!statuses.includes(newStatus)) {
    showMessage("Invalid order status.", "error");
    return;
  }

  const previousOrder = allOrders.find(
    order => String(order.id) === String(orderId)
  );

  if (!previousOrder) {
    showMessage("Order not found.", "error");
    return;
  }

  const previousStatus = normalizeStatus(previousOrder.status);

  if (previousStatus === newStatus) return;

  if (selectElement) selectElement.disabled = true;

  try {
    const { error } = await db
      .from("orders")
      .update({ status: newStatus })
      .eq("id", orderId);

    if (error) throw error;

    allOrders = allOrders.map(order =>
      String(order.id) === String(orderId)
        ? { ...order, status: newStatus }
        : order
    );

    renderOrders();
    updateDashboardStats();

    showMessage(`Order #${orderId} updated to ${statusLabels[newStatus]}.`, "success");
  } catch (error) {
    console.error("Failed to update order status:", error);
    showMessage(error.message || "Unable to update the order status.", "error");

    if (selectElement) {
      selectElement.value = previousStatus;
      selectElement.disabled = false;
    }
  }
}

function showSection(sectionName) {
  document.querySelectorAll(".content-section").forEach(section => {
    section.classList.toggle("hidden", section.id !== `section-${sectionName}`);
  });

  document.querySelectorAll(".nav-item[data-section]").forEach(button => {
    button.classList.toggle("active", button.dataset.section === sectionName);
  });

  if (sectionName === "orders") renderOrders();
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
  $("#refreshBtn")?.addEventListener("click", loadOrders);

  document.querySelectorAll("[data-section]").forEach(button => {
    button.addEventListener("click", () => showSection(button.dataset.section));
  });

  $("#searchInput")?.addEventListener("input", renderOrders);
  $("#statusFilter")?.addEventListener("change", renderOrders);

  document.addEventListener("change", event => {
    const select = event.target.closest(".order-status-select");
    if (!select) return;

    updateOrderStatus(select.dataset.orderId, select.value, select);
  });

  document.querySelectorAll("[data-refresh-orders]").forEach(button => {
    button.addEventListener("click", loadOrders);
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
  } catch (error) {
    console.error("Admin session verification failed:", error);
    redirectToSharedLogin("profile-error");
  }
}

document.addEventListener("DOMContentLoaded", initializeAdmin);
