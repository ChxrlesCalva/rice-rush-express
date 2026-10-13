
"use strict";

const db = typeof supabaseClient !== "undefined"
  ? supabaseClient
  : window.supabaseClient;

const $ = selector => document.querySelector(selector);

const peso = amount => new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP"
}).format(Number(amount) || 0);

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

const fallbackImage =
  "https://placehold.co/700x450/fff0e3/8a4a24?text=Rice+Rush+Meal";

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

function showLoginMessage(message = "", type = "") {
  const element = $("#loginMessage");

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

function renderRecentOrders() {
  const container = $("#recentOrdersList");
  if (!container) return;

  const recentOrders = [...allOrders]
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, 5);

  if (!recentOrders.length) {
    container.innerHTML = `<div class="empty-state">No orders have been placed yet.</div>`;
    return;
  }

  container.innerHTML = recentOrders.map(order => {
    const items = getOrderItems(order);

    const foodItems = items.length
      ? `
        <div class="recent-food-list">
          ${items.map(item => `
            <div class="recent-food-item">
              ${createFoodImage(item, "recent-food-image")}
              <div class="recent-food-info">
                <strong class="recent-food-name">${escapeHTML(getOrderItemName(item))}</strong>
                <span class="recent-food-quantity">Qty: ${Number(item.quantity) || 0}</span>
                <strong class="recent-food-price">${peso(getOrderItemPrice(item))}</strong>
              </div>
            </div>
          `).join("")}
        </div>
      `
      : `<p>No food items found.</p>`;

    return `
      <article class="recent-order-card">
        <div class="recent-order-header">
          <div>
            <h3>Order #${escapeHTML(order.id)}</h3>
            <p>${escapeHTML(getOrderCustomer(order))}</p>
            <small>${escapeHTML(formatDate(order.created_at))}</small>
          </div>
          ${statusBadge(order.status)}
        </div>
        ${foodItems}
        <div class="recent-order-total">
          <span>Order Total</span>
          <strong>${peso(getOrderTotal(order))}</strong>
        </div>
      </article>
    `;
  }).join("");
}

function updateDashboardStats() {
  const total = allOrders.length;

  const pending = allOrders.filter(order =>
    normalizeStatus(order.status) === "pending"
  ).length;

  const inProgress = allOrders.filter(order =>
    ["confirmed", "preparing", "ready", "out_for_delivery"]
      .includes(normalizeStatus(order.status))
  ).length;

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

  if ($("#totalCount")) $("#totalCount").textContent = total;
  if ($("#pendingCount")) $("#pendingCount").textContent = pending;
  if ($("#progressCount")) $("#progressCount").textContent = inProgress;
  if ($("#completedCount")) $("#completedCount").textContent = completed.length;
  if ($("#reportTotalOrders")) $("#reportTotalOrders").textContent = total;
  if ($("#reportCompletedOrders")) $("#reportCompletedOrders").textContent = completed.length;
  if ($("#reportCancelledOrders")) $("#reportCancelledOrders").textContent = cancelled.length;
  if ($("#reportRevenue")) $("#reportRevenue").textContent = peso(revenue);
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

    if (menuItemIds.length) {
      const { data: menuItems, error: menuError } = await db
        .from("menu_items")
        .select("id, image_url")
        .in("id", menuItemIds);

      if (menuError) throw menuError;

      (menuItems || []).forEach(item => {
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
    renderRecentOrders();
    updateDashboardStats();
    showMessage("");
  } catch (error) {
    console.error("Failed to load orders:", error);
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
    renderRecentOrders();
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
  if (sectionName === "overview") renderRecentOrders();
}

async function verifyAdmin(user) {
  if (!user?.id) {
    throw new Error("Unable to verify your administrator account.");
  }

  const { data, error } = await db
    .from("admin_users")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    console.error("Admin authorization check failed:", error);
    throw new Error("Unable to verify administrator access. Check your Supabase permissions.");
  }

  if (!data) {
    throw new Error("This account is not authorized to access the admin dashboard.");
  }

  return true;
}

function showDashboard(user) {
  currentUser = user;

  $("#loginPanel")?.classList.add("hidden");
  $("#dashboard")?.classList.remove("hidden");
  $("#logoutBtn")?.classList.remove("hidden");

  if ($("#adminEmail")) $("#adminEmail").textContent = user.email || "Administrator";
  if ($("#settingsEmail")) $("#settingsEmail").value = user.email || "";

  showSection("overview");
  loadOrders();
  subscribeToOrderChanges();
}

function showLogin() {
  currentUser = null;

  $("#dashboard")?.classList.add("hidden");
  $("#loginPanel")?.classList.remove("hidden");
  $("#logoutBtn")?.classList.add("hidden");

  if ($("#adminEmail")) $("#adminEmail").textContent = "Administrator";
  if ($("#settingsEmail")) $("#settingsEmail").value = "";

  allOrders = [];

  renderOrders();
  renderRecentOrders();
  updateDashboardStats();

  if (orderChannel) {
    db.removeChannel(orderChannel);
    orderChannel = null;
  }
}

async function handleLogin(event) {
  event.preventDefault();
  showLoginMessage("Signing in...");

  const email = $("#email")?.value.trim();
  const password = $("#password")?.value;

  if (!email || !password) {
    showLoginMessage("Enter your email and password.", "error");
    return;
  }

  try {
    const { data, error } = await db.auth.signInWithPassword({ email, password });

    if (error) throw error;

    await verifyAdmin(data.user);
    showLoginMessage("");
    showDashboard(data.user);
  } catch (error) {
    console.error("Admin login failed:", error);
    await db.auth.signOut();

    showLoginMessage(
      error.message || "Unable to sign in. Please check your credentials.",
      "error"
    );
  }
}

async function handleLogout() {
  try {
    const { error } = await db.auth.signOut();
    if (error) throw error;

    showLoginMessage("You have signed out successfully.", "success");
    showLogin();
  } catch (error) {
    console.error("Logout failed:", error);
    showMessage("Unable to log out. Please try again.", "error");
  }
}

async function handleForgotPassword() {
  const email = $("#email")?.value.trim();

  if (!email) {
    showLoginMessage("Enter your email address first, then select Forgot Password.", "error");
    $("#email")?.focus();
    return;
  }

  try {
    const { error } = await db.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/admin/reset-password.html`
    });

    if (error) throw error;

    showLoginMessage(
      "If this email is registered, a password reset link will be sent.",
      "success"
    );
  } catch (error) {
    console.error("Password reset request failed:", error);
    showLoginMessage(error.message || "Unable to request a password reset.", "error");
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

function initializeAdmin() {
  if (!db) {
    showLoginMessage("Supabase is not initialized. Check supabase-config.js.", "error");
    return;
  }

  $("#loginForm")?.addEventListener("submit", handleLogin);
  $("#logoutBtn")?.addEventListener("click", handleLogout);
  $("#forgotPasswordBtn")?.addEventListener("click", handleForgotPassword);
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

  db.auth.getSession().then(async ({ data, error }) => {
    if (error) {
      showLoginMessage("Unable to check your session. Please sign in again.", "error");
      return;
    }

    const user = data?.session?.user;

    if (!user) {
      showLogin();
      return;
    }

    try {
      await verifyAdmin(user);
      showDashboard(user);
    } catch (authorizationError) {
      console.error("Admin session verification failed:", authorizationError);
      await db.auth.signOut();
      showLogin();

      showLoginMessage(
        authorizationError.message || "Your account is not authorized.",
        "error"
      );
    }
  });

  db.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || !session?.user) {
      showLogin();
    }
  });
}

document.addEventListener("DOMContentLoaded", initializeAdmin);
