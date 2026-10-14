"use strict";

let meals = [];

const $ = selector => document.querySelector(selector);

const peso = amount => new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP"
}).format(Number(amount) || 0);

const mealGrid = $("#mealGrid");
const searchInput = $("#searchInput");
const categoryFilters = $("#categoryFilters");
const cartButton = $("#cartButton");
const cartDrawer = $("#cartDrawer");
const drawerBackdrop = $("#drawerBackdrop");
const closeCartButton = $("#closeCart");
const cartItems = $("#cartItems");
const cartCount = $("#cartCount");
const cartSubtotal = $("#cartSubtotal");
const checkoutButton = $("#checkoutButton");
const checkoutBackdrop = $("#checkoutBackdrop");
const closeCheckoutButton = $("#closeCheckout");
const checkoutForm = $("#checkoutForm");
const checkoutTotal = $("#checkoutTotal");
const orderMethod = $("#orderMethod");
const addressField = $("#addressField");
const customerAddress = $("#customerAddress");
const ordersList = $("#ordersList");
const myOrdersLinks = document.querySelectorAll("[data-my-orders-link]");
const toast = $("#toast");

let selectedCategory = "All";
let cart = {};
let toastTimer;
let customerOrders = [];
let ordersChannel = null;
let expandedOrderIds = new Set();
let highlightedOrderId = new URLSearchParams(window.location.search).get("order");
let submittingOrder = false;
let navigationIdleTimer;
let categoryIdleTimer;

const mobileNavigationQuery = window.matchMedia("(max-width: 760px)");

function updateMobileNavigationVisibility() {
  if (!mobileNavigationQuery.matches) {
    document.body.classList.remove("mobile-nav-hidden");
    clearTimeout(navigationIdleTimer);
    return;
  }

  document.body.classList.add("mobile-nav-hidden");
  clearTimeout(navigationIdleTimer);
  navigationIdleTimer = setTimeout(() => {
    document.body.classList.remove("mobile-nav-hidden");
  }, 700);
}

window.addEventListener("scroll", updateMobileNavigationVisibility, {
  passive: true
});

mobileNavigationQuery.addEventListener("change", updateMobileNavigationVisibility);

function updateCategoryVisibility() {
  document.body.classList.add("categories-hidden-while-scrolling");
  clearTimeout(categoryIdleTimer);
  categoryIdleTimer = setTimeout(() => {
    document.body.classList.remove("categories-hidden-while-scrolling");
  }, 500);
}

window.addEventListener("scroll", updateCategoryVisibility, {
  passive: true
});

const FAVORITES_STORAGE_KEY = "riceRushFavorites";
const MEAL_IMAGE_FALLBACK =
  "https://placehold.co/160x120/fff0e3/8a4a24?text=Rice+Rush";
const ORDER_BANNER_IMAGE_URL =
  "https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=900&q=85";

function loadFavorites() {
  try {
    const saved = JSON.parse(
      localStorage.getItem(FAVORITES_STORAGE_KEY) || "[]"
    );

    return new Set(
      Array.isArray(saved)
        ? saved.map(Number).filter(Number.isFinite)
        : []
    );
  } catch {
    return new Set();
  }
}

let favoriteMealIds = loadFavorites();

function saveFavorites() {
  try {
    localStorage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify([...favoriteMealIds])
    );
    return true;
  } catch (error) {
    console.error("Could not save favorites:", error);
    showToast("Could not save favorites in this browser.");
    return false;
  }
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function showToast(message) {
  if (!toast) return;

  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(toastTimer);

  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

async function loadMeals() {
  if (!mealGrid) return;

  mealGrid.innerHTML =
    '<p class="empty-message">Loading menu...</p>';

  try {
    const { data, error } = await supabaseClient
      .from("menu_items")
      .select("id, name, description, price, category, image_url, is_available")
      .order("id");

    if (error) throw error;

    meals = (data || []).map(item => ({
      ...item,
      id: Number(item.id),
      name: item.name || "",
      description: item.description || "",
      category: item.category || "",
      price: Number(item.price) || 0,
      is_available: item.is_available === true,
      image: item.image_url ||
        "https://placehold.co/700x450/fff0e3/8a4a24?text=Rice+Rush+Meal"
    }));

    const availableIds = new Set(meals.map(meal => meal.id));

    favoriteMealIds = new Set(
      [...favoriteMealIds].filter(id => availableIds.has(id))
    );

    saveFavorites();
    renderMeals();
  } catch (error) {
    console.error("Supabase menu error:", error);

    mealGrid.innerHTML =
      '<p class="empty-message">Could not load the menu. Please try again.</p>';
  }
}

function renderMeals() {
  if (!mealGrid || !searchInput) return;

  const search = searchInput.value.trim().toLowerCase();

  const filtered = meals.filter(meal => {
    let categoryMatch;

    if (selectedCategory === "All") {
      categoryMatch = true;
    } else if (selectedCategory === "Favorites") {
      categoryMatch = favoriteMealIds.has(meal.id);
    } else {
      categoryMatch = meal.category === selectedCategory;
    }

    const searchMatch =
      meal.name.toLowerCase().includes(search) ||
      meal.description.toLowerCase().includes(search) ||
      meal.category.toLowerCase().includes(search);

    return categoryMatch && searchMatch;
  });

  if (!filtered.length) {
    const message = selectedCategory === "Favorites"
      ? "No favorite meals yet. Tap a star to save a meal! ☆"
      : "No meals found. Try another search.";

    mealGrid.innerHTML =
      `<p class="empty-message">${escapeHTML(message)}</p>`;
    return;
  }

  mealGrid.innerHTML = filtered.map(meal => {
    const isFavorite = favoriteMealIds.has(meal.id);

    return `
      <article class="meal-card">
        <img
          class="meal-image"
          src="${escapeHTML(meal.image)}"
          alt="${escapeHTML(meal.name)}"
          loading="lazy"
        >
        <div class="meal-info">
          <h3>${escapeHTML(meal.name)}</h3>
          <p class="meal-description">${escapeHTML(meal.description)}</p>
          <div class="meal-bottom">
            <div class="meal-pricing">
              <span class="meal-price">${peso(meal.price)}</span>
              ${meal.is_available ? "" : '<span class="meal-availability">Unavailable</span>'}
            </div>
            <div class="meal-actions">
              <button
                type="button"
                class="favorite-button ${isFavorite ? "is-favorite" : ""}"
                data-favorite="${meal.id}"
                aria-label="${isFavorite ? "Remove" : "Add"} ${escapeHTML(meal.name)} ${isFavorite ? "from" : "to"} favorites"
                aria-pressed="${isFavorite}"
                title="${isFavorite ? "Remove from favorites" : "Add to favorites"}"
              >${isFavorite ? "★" : "☆"}</button>
              <button
                type="button"
                class="add-button ${meal.is_available ? "" : "is-unavailable"}"
                data-add="${meal.id}"
                aria-label="${meal.is_available ? `Add ${escapeHTML(meal.name)} to cart` : `${escapeHTML(meal.name)} is unavailable`}"
                ${meal.is_available ? "" : "disabled"}
              >＋ Add to Cart</button>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join("");

  mealGrid.querySelectorAll(".meal-image").forEach(img => {
    img.addEventListener("error", () => {
      img.src =
        "https://placehold.co/700x450/fff0e3/8a4a24?text=Rice+Rush+Meal";
    }, { once: true });
  });
}

function toggleFavorite(mealId) {
  const id = Number(mealId);

  if (!meals.some(meal => meal.id === id)) return;

  if (favoriteMealIds.has(id)) {
    favoriteMealIds.delete(id);
    showToast("Removed from favorites.");
  } else {
    favoriteMealIds.add(id);
    showToast("Added to favorites! ☆");
  }

  saveFavorites();
  renderMeals();
}

function addToCart(mealId) {
  const id = Number(mealId);
  const meal = meals.find(item => item.id === id);

  if (!meal || !meal.is_available) return;

  cart[id] = (cart[id] || 0) + 1;

  renderCart();
  showToast("Meal added to your cart!");
}

function changeQuantity(mealId, change) {
  const id = Number(mealId);

  if (!cart[id]) return;

  cart[id] += change;

  if (cart[id] <= 0) delete cart[id];

  renderCart();
}

function getCartDetails() {
  const items = Object.entries(cart)
    .map(([id, quantity]) => {
      const meal = meals.find(item => item.id === Number(id));
      return meal ? { ...meal, quantity } : null;
    })
    .filter(Boolean);

  const count = items.reduce((sum, item) => sum + item.quantity, 0);
  const total = items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  return { items, count, total };
}

function renderCart() {
  if (!cartItems) return;

  const { items, count, total } = getCartDetails();

  if (cartCount) cartCount.textContent = count;
  if (cartSubtotal) cartSubtotal.textContent = peso(total);
  if (checkoutTotal) checkoutTotal.textContent = peso(total);

  if (checkoutButton) {
    checkoutButton.disabled = count === 0 || submittingOrder;
  }

  if (!items.length) {
    cartItems.innerHTML =
      '<p class="empty-message">Your cart is empty. Add a meal to get started!</p>';
    return;
  }

  cartItems.innerHTML = items.map(item => `
    <div class="cart-item">
      <div>
        <h3>${escapeHTML(item.name)}</h3>
        <p>${peso(item.price)} each</p>
        <div class="quantity-controls">
          <button type="button" data-quantity="${item.id}" data-change="-1" aria-label="Decrease quantity">−</button>
          <strong>${item.quantity}</strong>
          <button type="button" data-quantity="${item.id}" data-change="1" aria-label="Increase quantity">+</button>
          <button type="button" class="remove-button" data-remove="${item.id}">Remove</button>
        </div>
      </div>
      <strong>${peso(item.price * item.quantity)}</strong>
    </div>
  `).join("");
}

function openCart() {
  cartDrawer?.classList.add("open");
  drawerBackdrop?.classList.add("open");
}

function closeCart() {
  cartDrawer?.classList.remove("open");
  drawerBackdrop?.classList.remove("open");
}

function openCheckout() {
  if (!getCartDetails().count) {
    showToast("Add a meal to your cart first.");
    return;
  }

  closeCart();

  if (checkoutTotal) checkoutTotal.textContent = peso(getCartDetails().total);

  checkoutBackdrop?.classList.add("open");
}

function closeCheckout() {
  checkoutBackdrop?.classList.remove("open");
}

function updateAddressRequirement() {
  if (!orderMethod || !customerAddress || !addressField) return;

  const delivery = orderMethod.value === "delivery";

  addressField.hidden = !delivery;
  customerAddress.required = delivery;

  if (!delivery) customerAddress.value = "";
}

function getStatusLabel(status) {
  const labels = {
    pending: "Pending",
    confirmed: "Confirmed",
    preparing: "Preparing",
    ready: "Ready",
    out_for_delivery: "Out for Delivery",
    completed: "Completed",
    delivered: "Delivered",
    cancelled: "Cancelled"
  };

  return labels[status] || "Status unavailable";
}

function getStatusClass(status) {
  return ({
    pending: "pending",
    confirmed: "confirmed",
    preparing: "preparing",
    ready: "ready",
    out_for_delivery: "out-for-delivery",
    completed: "completed",
    delivered: "delivered",
    cancelled: "cancelled"
  })[status] || "unknown";
}

function formatOrderDate(timestamp) {
  if (!timestamp) return "Date unavailable";

  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

function applyImageFallback(image) {
  image.addEventListener("error", () => {
    if (image.dataset.fallbackApplied) return;

    image.dataset.fallbackApplied = "true";
    image.src = MEAL_IMAGE_FALLBACK;
  }, { once: true });
}

function initializeOrdersBanner() {
  const bannerImage = document.querySelector("[data-order-banner-image]");
  if (!bannerImage) return;

  bannerImage.src = ORDER_BANNER_IMAGE_URL;
  applyImageFallback(bannerImage);
}

function setMyOrdersCount(count) {
  myOrdersLinks.forEach(link => {
    const badge = link.querySelector("[data-my-orders-count]");
    if (!badge) return;

    if (!Number.isInteger(count) || count < 0) {
      badge.hidden = true;
      link.setAttribute("aria-label", "My Orders");
      return;
    }

    badge.textContent = String(count);
    badge.hidden = false;
    link.setAttribute(
      "aria-label",
      `My Orders, ${count} ${count === 1 ? "order" : "orders"}`
    );
  });
}

async function loadMyOrdersCount() {
  if (!myOrdersLinks.length) return;

  try {
    const {
      data: { user },
      error: authError
    } = await supabaseClient.auth.getUser();

    if (authError) throw authError;

    if (!user) {
      setMyOrdersCount(null);
      return;
    }

    const { count, error } = await supabaseClient
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("customer_id", user.id);

    if (error) throw error;
    if (count === null) throw new Error("Supabase did not return the order count.");

    setMyOrdersCount(count);
  } catch (error) {
    console.error("Could not load customer order count:", error);
    setMyOrdersCount(null);
  }
}

function getProgressIndex(status) {
  const progress = {
    pending: 0,
    confirmed: 1,
    preparing: 2,
    ready: 3,
    out_for_delivery: 3,
    completed: 3,
    delivered: 3
  };

  return progress[status] ?? -1;
}

function renderTrackingProgress(status) {
  if (status === "cancelled") {
    return `
      <div class="tracking-cancelled">
        <strong>Order Cancelled</strong>
        <p>Please contact staff if you need assistance.</p>
      </div>
    `;
  }

  const steps = [
    { status: "pending", label: "Pending" },
    { status: "confirmed", label: "Cooking" },
    { status: "preparing", label: "Preparing" },
    { status: "ready", label: "Ready to Deliver" }
  ];

  const activeStep = getProgressIndex(status);

  return `
    <div class="tracking-progress" aria-label="Order progress">
      ${steps.map((step, index) => {
        const done = activeStep >= index;
        const current = activeStep === index;

        return `
          <div class="tracking-step ${done ? "completed" : ""} ${current ? "current" : ""}">
            <div class="tracking-dot">${done ? "✓" : index + 1}</div>
            <span>${step.label}</span>
          </div>
          ${index < steps.length - 1
            ? `<div class="tracking-line ${activeStep > index ? "completed" : ""}"></div>`
            : ""}
        `;
      }).join("")}
    </div>
    <p class="tracking-current">
      Current status: <strong>${escapeHTML(getStatusLabel(status))}</strong>
      ${status === "out_for_delivery" ? "<br>Your order is on its way!" : ""}
      ${status === "completed" ? "<br>Your order has been completed. Thank you!" : ""}
    </p>
  `;
}

function renderOrderItems(items) {
  if (!items.length) {
    return '<p class="empty-message">Order item details are unavailable.</p>';
  }

  return items.map(item => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.unit_price) || 0;
    const lineTotal = item.line_total == null
      ? unitPrice * quantity
      : Number(item.line_total);
    const image = item.image_url || MEAL_IMAGE_FALLBACK;

    return `
      <div class="tracking-item-row">
        <img
          class="tracking-item-image"
          src="${escapeHTML(image)}"
          alt="${escapeHTML(item.item_name || "Ordered meal")}"
          loading="lazy"
        >
        <div class="tracking-item-info">
          <div class="tracking-item-name">${escapeHTML(item.item_name)}</div>
          <p class="tracking-item-meta">${quantity} × ${peso(unitPrice)}</p>
        </div>
        <strong>${peso(lineTotal)}</strong>
      </div>
    `;
  }).join("");
}

function renderCalendarIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="5" width="17" height="16" rx="2"></rect>
      <path d="M7.5 3v4M16.5 3v4M3.5 9.5h17"></path>
    </svg>
  `;
}

function renderUtensilsIcon() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3v7M4.5 3v4.5A2.5 2.5 0 0 0 7 10a2.5 2.5 0 0 0 2.5-2.5V3M7 10v11M16 3v18M16 3c2.5 2.4 3.5 5.2 3.5 8H16"></path>
    </svg>
  `;
}

function renderOrders() {
  if (!ordersList) return;

  if (!customerOrders.length) {
    ordersList.innerHTML =
      '<div class="orders-empty-state"><span class="orders-empty-icon" aria-hidden="true">🍚</span><h3>No orders yet</h3><p>You haven\'t placed an order yet. Your next favorite meal is just a few clicks away.</p><a href="customer.html#menu" class="orders-browse-link">Browse the menu</a></div>';
    return;
  }

  const validIds = new Set(customerOrders.map(order => String(order.id)));
  expandedOrderIds = new Set(
    [...expandedOrderIds].filter(id => validIds.has(id))
  );
  const newlyPlacedOrder = highlightedOrderId && validIds.has(highlightedOrderId);

  if (newlyPlacedOrder) expandedOrderIds.add(highlightedOrderId);

  ordersList.innerHTML = customerOrders.map(order => {
    const items = order.order_items || [];
    const status = String(order.status || "pending").toLowerCase();
    const orderId = String(order.id);
    const expanded = expandedOrderIds.has(orderId);
    const date = formatOrderDate(order.created_at);
    const total = Number(order.total) || 0;
    const orderType = String(order.order_type || "").toLowerCase();
    const delivery = orderType === "delivery";
    const firstItem = items[0];
    const firstItemName = firstItem?.item_name || "Ordered meal";
    const firstItemImage = firstItem?.image_url || MEAL_IMAGE_FALLBACK;
    const itemSummary = items.length
      ? items.map(item => {
        const quantity = Number(item.quantity) || 0;
        return `${escapeHTML(item.item_name || "Meal")} (×${quantity})`;
      }).join(", ")
      : "Order item details are unavailable.";

    return `
      <article class="order-history-card">
        <button
          type="button"
          class="order-history-summary"
          data-order-toggle="${escapeHTML(orderId)}"
          aria-expanded="${expanded}"
          aria-controls="order-details-${escapeHTML(orderId)}"
        >
          <img
            class="order-history-image"
            src="${escapeHTML(firstItemImage)}"
            alt="${escapeHTML(firstItemName)}"
            loading="lazy"
          >

          <div class="order-history-info">
            <h3>Order #${escapeHTML(orderId)}</h3>
            <p class="order-history-date">
              ${renderCalendarIcon()}
              <span>${escapeHTML(date)}</span>
            </p>
            <p class="order-history-items">
              ${renderUtensilsIcon()}
              <span>${itemSummary}</span>
            </p>
            <p class="order-history-total">
              <span>Total</span>
              <strong>${peso(total)}</strong>
            </p>
          </div>

          <div class="order-history-actions">
            <span class="order-status status-${getStatusClass(status)}">
              ${escapeHTML(getStatusLabel(status))}
            </span>
            <span class="order-expand-indicator" aria-hidden="true">⌄</span>
          </div>
        </button>

        <div
          id="order-details-${escapeHTML(orderId)}"
          class="order-tracking-details"
          ${expanded ? "" : "hidden"}
        >
          <div class="tracking-heading">
            <h3>Track Your Order</h3>
            <span class="order-status status-${getStatusClass(status)}">
              ${escapeHTML(getStatusLabel(status))}
            </span>
          </div>

          ${renderTrackingProgress(status)}

          <div class="tracking-items">
            <h4>Items in This Order</h4>
            ${renderOrderItems(items)}
            <div class="tracking-total">
              <div class="tracking-total-row">
                <span>Order Total</span>
                <strong>${peso(total)}</strong>
              </div>
            </div>
          </div>

          <div class="tracking-order-details">
            <h4>Order Details</h4>
            <div class="tracking-details-grid">
              <div class="tracking-detail">
                <span class="tracking-detail-label">Customer Name</span>
                <span class="tracking-detail-value">${escapeHTML(order.customer_name || "Not provided")}</span>
              </div>
              <div class="tracking-detail">
                <span class="tracking-detail-label">Phone Number</span>
                <span class="tracking-detail-value">${escapeHTML(order.phone || "Not provided")}</span>
              </div>
              <div class="tracking-detail">
                <span class="tracking-detail-label">Order Method</span>
                <span class="tracking-detail-value">${delivery ? "🚚 Delivery" : "🏪 Pickup"}</span>
              </div>
              <div class="tracking-detail">
                <span class="tracking-detail-label">Payment Method</span>
                <span class="tracking-detail-value">${escapeHTML(order.payment_method === "cash" ? "Cash on Delivery" : order.payment_method || "Not specified")}</span>
              </div>
              ${delivery ? `
                <div class="tracking-detail">
                  <span class="tracking-detail-label">Delivery Address</span>
                  <span class="tracking-detail-value">${escapeHTML(order.delivery_address || "Not provided")}</span>
                </div>
              ` : ""}
              <div class="tracking-detail">
                <span class="tracking-detail-label">Order Note</span>
                <span class="tracking-detail-value">${escapeHTML(order.order_note || "No special instructions")}</span>
              </div>
            </div>
          </div>
        </div>
      </article>
    `;
  }).join("");

  ordersList.querySelectorAll(".order-history-image, .tracking-item-image")
    .forEach(applyImageFallback);

  if (newlyPlacedOrder) {
    showToast(`Order #${highlightedOrderId} placed successfully!`);
    highlightedOrderId = null;
  }
}

async function loadCustomerOrders() {
  if (!ordersList) return;
  ordersList.innerHTML =
    '<p class="orders-loading-state" role="status">Loading your orders...</p>';
  ordersList.setAttribute("aria-busy", "true");

  try {
    const {
      data: { user },
      error: authError
    } = await supabaseClient.auth.getUser();

    if (authError) throw authError;

    if (!user) {
      customerOrders = [];
      expandedOrderIds.clear();
      setMyOrdersCount(null);
      ordersList.innerHTML =
        '<div class="orders-empty-state"><h3>Please sign in to view your orders</h3><a href="../index.html" class="orders-browse-link">Go to sign in</a></div>';
      ordersList.setAttribute("aria-busy", "false");
      return;
    }

    const { data, error } = await supabaseClient
      .from("orders")
      .select(`
        id,
        customer_id,
        customer_name,
        phone,
        order_type,
        delivery_address,
        payment_method,
        order_note,
        status,
        total,
        created_at,
        order_items (
          item_name,
          menu_item_id,
          quantity,
          unit_price,
          line_total
        )
      `)
      .eq("customer_id", user.id)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const menuItemIds = [...new Set(
      (data || []).flatMap(order => order.order_items || [])
        .map(item => Number(item.menu_item_id))
        .filter(Number.isFinite)
    )];
    let mealImages = new Map();

    if (menuItemIds.length) {
      const { data: menuItems, error: menuItemsError } = await supabaseClient
        .from("menu_items")
        .select("id, image_url")
        .in("id", menuItemIds);

      if (menuItemsError) {
        console.error("Could not load meal images for customer orders:", menuItemsError);
      } else {
        mealImages = new Map(
          (menuItems || []).map(item => [String(item.id), item.image_url])
        );
      }
    }

    for (const order of data || []) {
      for (const item of order.order_items || []) {
        item.image_url = mealImages.get(String(item.menu_item_id)) || "";
      }
    }

    customerOrders = data || [];
    setMyOrdersCount(customerOrders.length);
    renderOrders();
    ordersList.setAttribute("aria-busy", "false");
  } catch (error) {
    console.error("Could not load customer orders:", error);

    ordersList.innerHTML =
      '<div class="orders-error-state" role="alert"><h3>We couldn’t load your orders</h3><p>Please check your connection and try again.</p><button type="button" class="orders-retry-button" data-orders-retry>Try Again</button></div>';
    ordersList.setAttribute("aria-busy", "false");
  }
}

async function subscribeToOrderUpdates() {
  if (!ordersList && !myOrdersLinks.length) return;

  try {
    const {
      data: { user },
      error
    } = await supabaseClient.auth.getUser();

    if (error) throw error;
    if (!user) {
      setMyOrdersCount(null);
      return;
    }

    if (ordersChannel) {
      await supabaseClient.removeChannel(ordersChannel);
    }

    ordersChannel = supabaseClient
      .channel(`customer-order-updates-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `customer_id=eq.${user.id}`
        },
        () => {
          if (ordersList) {
            loadCustomerOrders();
          } else {
            loadMyOrdersCount();
          }
        }
      )
      .subscribe();
  } catch (error) {
    console.error("Could not subscribe to order updates:", error);
  }
}

if (checkoutForm) {
  checkoutForm.addEventListener("submit", async event => {
    event.preventDefault();

    if (submittingOrder) return;

    const { items, total } = getCartDetails();

    if (!items.length) {
      showToast("Your cart is empty.");
      return;
    }

    if (!checkoutForm.reportValidity()) return;

    const {
      data: { user },
      error: authError
    } = await supabaseClient.auth.getUser();

    if (authError || !user) {
      showToast("Please log in before placing an order.");
      return;
    }

    const method = orderMethod?.value || "delivery";
    const name = $("#customerName")?.value.trim() || "";
    const phone = $("#customerPhone")?.value.trim() || "";
    const address = method === "delivery"
      ? customerAddress?.value.trim() || ""
      : "";
    const note = $("#customerNote")?.value.trim() || "";

    if (!name || !phone || (method === "delivery" && !address)) {
      showToast("Please complete the required fields.");
      return;
    }

    submittingOrder = true;

    const submitButton = checkoutForm.querySelector('button[type="submit"]');
    const originalSubmitText = submitButton?.textContent || "Place Order";
    const originalCheckoutText = checkoutButton?.textContent || "Proceed to Checkout";

    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Placing order...";
    }

    if (checkoutButton) {
      checkoutButton.disabled = true;
      checkoutButton.textContent = "Placing order...";
    }

    let savedOrder = null;

    try {
      const { data: order, error: orderError } = await supabaseClient
        .from("orders")
        .insert({
          customer_id: user.id,
          customer_name: name,
          phone,
          order_type: method,
          delivery_address: address || null,
          order_note: note || null,
          payment_method: "cash",
          status: "pending",
          total
        })
        .select("id, status")
        .single();

      if (orderError) throw orderError;

      savedOrder = order;

      const orderItems = items.map(item => ({
        order_id: order.id,
        menu_item_id: item.id,
        item_name: item.name,
        unit_price: item.price,
        quantity: item.quantity,
        line_total: item.price * item.quantity
      }));

      const { error: itemsError } = await supabaseClient
        .from("order_items")
        .insert(orderItems);

      if (itemsError) {
        console.error("Order items error:", itemsError);
        await loadCustomerOrders();
        closeCheckout();

        showToast(
          `Order #${order.id} was created, but its items could not be saved. Contact staff before retrying.`
        );
        return;
      }

      cart = {};
      renderCart();
      checkoutForm.reset();

      if (orderMethod) orderMethod.value = "delivery";

      updateAddressRequirement();
      closeCheckout();

      window.location.assign(`orders.html?order=${encodeURIComponent(order.id)}`);
    } catch (error) {
      console.error("Checkout error:", error);

      showToast(
        savedOrder
          ? `Order #${savedOrder.id} may be incomplete. Contact staff before retrying.`
          : error.message || "Could not place your order."
      );
    } finally {
      submittingOrder = false;

      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = originalSubmitText;
      }

      if (checkoutButton) {
        checkoutButton.textContent = originalCheckoutText;
      }

      renderCart();
    }
  });
}

if (mealGrid) {
  mealGrid.addEventListener("click", event => {
    const favoriteButton = event.target.closest("button[data-favorite]");

    if (favoriteButton) {
      toggleFavorite(favoriteButton.dataset.favorite);
      return;
    }

    const addButton = event.target.closest("button[data-add]");

    if (addButton) addToCart(addButton.dataset.add);
  });
}

if (categoryFilters) {
  categoryFilters.addEventListener("click", event => {
    const button = event.target.closest("button[data-category]");

    if (!button) return;

    selectedCategory = button.dataset.category;

    categoryFilters.querySelectorAll("[data-category]").forEach(filter => {
      filter.classList.toggle("active", filter === button);
    });

    renderMeals();
  });
}

if (searchInput) {
  searchInput.addEventListener("input", renderMeals);
}

if (cartItems) {
  cartItems.addEventListener("click", event => {
    const quantityButton = event.target.closest("button[data-quantity]");
    const removeButton = event.target.closest("button[data-remove]");

    if (removeButton) {
      delete cart[Number(removeButton.dataset.remove)];
      renderCart();
      return;
    }

    if (quantityButton) {
      changeQuantity(
        quantityButton.dataset.quantity,
        Number(quantityButton.dataset.change)
      );
    }
  });
}

if (ordersList) {
  ordersList.addEventListener("click", event => {
    const retryButton = event.target.closest("[data-orders-retry]");

    if (retryButton) {
      loadCustomerOrders();
      return;
    }

    const summary = event.target.closest("[data-order-toggle]");
    if (!summary) return;

    const orderId = String(summary.dataset.orderToggle);
    const details = summary
      .closest(".order-history-card")
      ?.querySelector(".order-tracking-details");

    if (!details) return;

    if (details.hidden) {
      details.hidden = false;
      expandedOrderIds.add(orderId);
    } else {
      details.hidden = true;
      expandedOrderIds.delete(orderId);
    }

    summary.setAttribute("aria-expanded", String(!details.hidden));
  });
}

cartButton?.addEventListener("click", openCart);
closeCartButton?.addEventListener("click", closeCart);
drawerBackdrop?.addEventListener("click", closeCart);
checkoutButton?.addEventListener("click", openCheckout);
closeCheckoutButton?.addEventListener("click", closeCheckout);

orderMethod?.addEventListener("change", updateAddressRequirement);

checkoutBackdrop?.addEventListener("click", event => {
  if (event.target === checkoutBackdrop) closeCheckout();
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeCart();
    closeCheckout();
  }
});

updateAddressRequirement();
renderCart();
initializeOrdersBanner();
loadMeals();
loadCustomerOrders();
if (!ordersList) loadMyOrdersCount();
subscribeToOrderUpdates();

window.addEventListener("pagehide", () => {
  if (!ordersChannel) return;

  supabaseClient.removeChannel(ordersChannel).catch(error => {
    console.error("Could not clean up customer order updates:", error);
  });
  ordersChannel = null;
});