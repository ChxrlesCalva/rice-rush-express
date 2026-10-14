const menuForm = document.getElementById("menuForm");
const menuList = document.getElementById("menuList");
const menuMessage = document.getElementById("menuMessage");
const imageFileInput = document.getElementById("image_file");
const imagePreview = document.getElementById("imagePreview");
const imageUploadMessage = document.getElementById("imageUploadMessage");
const MENU_IMAGE_BUCKET = "new-images";

let editingItemId = null;
let selectedImageFile = null;
let previewObjectURL = null;
let isAdminSession = false;

function showMenuMessage(message, isError = false) {
  menuMessage.textContent = message;
  menuMessage.style.color = isError ? "#FF8A80" : "#79D69A";
}

function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };

    return entities[character];
  });
}

function formatPrice(price) {
  return Number(price).toLocaleString("en-PH", {
    style: "currency",
    currency: "PHP"
  });
}

function safeImageURL(value) {
  const url = String(value || "").trim();

  try {
    const parsedURL = new URL(url);

    if (parsedURL.protocol === "https:" || parsedURL.protocol === "http:") {
      return url;
    }
  } catch {
    return "";
  }

  return "";
}

function clearImagePreview() {
  if (previewObjectURL) {
    URL.revokeObjectURL(previewObjectURL);
    previewObjectURL = null;
  }

  imagePreview.hidden = true;
  imagePreview.removeAttribute("src");
}

imageFileInput.addEventListener("change", () => {
  const file = imageFileInput.files[0];

  selectedImageFile = file || null;
  imageUploadMessage.textContent = "";
  clearImagePreview();

  if (!file) return;

  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

  if (!allowedTypes.includes(file.type)) {
    selectedImageFile = null;
    imageFileInput.value = "";
    imageUploadMessage.textContent = "Choose a JPG, PNG, or WebP image.";
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    selectedImageFile = null;
    imageFileInput.value = "";
    imageUploadMessage.textContent = "Choose an image smaller than 5 MB.";
    return;
  }

  previewObjectURL = URL.createObjectURL(file);
  imagePreview.src = previewObjectURL;
  imagePreview.hidden = false;
  imageUploadMessage.textContent = "Photo selected successfully.";
});

async function uploadMenuImage(file) {
  const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

  if (!file || !allowedTypes.includes(file.type)) {
    throw new Error("Choose a JPG, PNG, or WebP image.");
  }

  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Choose an image smaller than 5 MB.");
  }

  const extension = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  }[file.type];

  const filePath = `${crypto.randomUUID()}.${extension}`;

  const { error } = await supabaseClient.storage
    .from(MENU_IMAGE_BUCKET)
    .upload(filePath, file, {
      contentType: file.type,
      upsert: false
    });

  if (error) throw error;

  const { data } = supabaseClient.storage
    .from(MENU_IMAGE_BUCKET)
    .getPublicUrl(filePath);

  return data.publicUrl;
}

async function loadMenuItems() {
  menuList.textContent = "Loading menu items...";

  try {
    const { data, error } = await supabaseClient
      .from("menu_items")
      .select("id, name, description, price, category, image_url, is_available")
      .order("id", { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      menuList.textContent = "No menu items yet. Add your first item using the form.";
      return;
    }

    menuList.innerHTML = data.map((item) => {
      const image = safeImageURL(item.image_url);

      return `
        <article class="menu-item">
          ${
            image
              ? `<img
                   class="menu-item-image"
                   src="${escapeHTML(image)}"
                   alt="${escapeHTML(item.name)}"
                   loading="lazy"
                 >`
              : `<div class="menu-no-image">No photo</div>`
          }

          <div class="menu-item-details">
            <h3>${escapeHTML(item.name)}</h3>
            <p>${escapeHTML(item.description || "No description")}</p>
            <p>${escapeHTML(item.category)}</p>
            <p class="menu-item-price">${formatPrice(item.price)}</p>
            <p>${item.is_available ? "Available" : "Unavailable"}</p>
            <button
              type="button"
              class="edit-menu-button"
              data-edit-id="${escapeHTML(item.id)}"
            >Edit</button>
          </div>
        </article>
      `;
    }).join("");

    menuList.querySelectorAll(".menu-item-image").forEach((image) => {
      image.addEventListener("error", () => {
        image.alt = "Image could not be loaded";
        image.style.display = "none";
        console.error("Failed to load menu image:", image.src);
      });
    });
  } catch (error) {
    console.error("Menu loading error:", error);
    menuList.textContent = "Could not load menu items.";
    showMenuMessage(error.message || "Failed to load menu items.", true);
  }
}

function setMenuFormEnabled(enabled) {
  menuForm.querySelectorAll("input, textarea, button").forEach((control) => {
    control.disabled = !enabled;
  });
}

async function initializeMenuPage() {
  setMenuFormEnabled(false);

  if (typeof supabaseClient === "undefined") {
    showMenuMessage("Supabase did not initialize. Check the Supabase scripts and configuration.", true);
    menuList.textContent = "Could not connect to Supabase.";
    return;
  }

  try {
    const { data: authData, error: authError } = await supabaseClient.auth.getUser();

    if (authError) throw authError;

    if (!authData.user) {
      window.location.replace("../../index.html?access=login-required");
      return;
    }

    document.getElementById("menuAdminEmail").textContent =
      authData.user.email || "Administrator";

    const { data: profile, error: profileError } = await supabaseClient
      .from("profiles")
      .select("role")
      .eq("id", authData.user.id)
      .maybeSingle();

    if (profileError) throw profileError;

    if (profile?.role !== "admin") {
      if (profile?.role === "customer") {
        window.location.replace("../../customer/customer.html");
      } else {
        window.location.replace("../../index.html?access=unsupported-role");
      }
      return;
    }

    isAdminSession = true;
    setMenuFormEnabled(true);
    await loadMenuItems();
  } catch (error) {
    console.error("Menu access verification failed:", error);
    menuList.textContent = "Could not verify admin access.";
    showMenuMessage(error.message || "Could not verify admin access.", true);
  }
}

function startEditing(item) {
  editingItemId = item.id;

  menuForm.elements.name.value = item.name || "";
  menuForm.elements.description.value = item.description || "";
  menuForm.elements.price.value = item.price ?? "";
  menuForm.elements.category.value = item.category || "";

  selectedImageFile = null;
  imageFileInput.value = "";
  clearImagePreview();

  imageUploadMessage.textContent =
    "Choose a new photo only if you want to replace the current one.";

  menuForm.querySelector('button[type="submit"]').textContent = "Save Changes";

  showMenuMessage(`Editing ${item.name}. Update the form and save.`);
  menuForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

menuList.addEventListener("click", async (event) => {
  if (!isAdminSession) return;

  const button = event.target.closest("[data-edit-id]");

  if (!button) return;

  button.disabled = true;

  try {
    const { data, error } = await supabaseClient
      .from("menu_items")
      .select("id, name, description, price, category, image_url")
      .eq("id", button.dataset.editId)
      .single();

    if (error) throw error;

    startEditing(data);
  } catch (error) {
    console.error("Menu item edit error:", error);
    showMenuMessage(error.message || "Could not load menu item.", true);
  } finally {
    button.disabled = false;
  }
});

menuForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!isAdminSession) {
    showMenuMessage("Sign in with an administrator account to manage menu items.", true);
    return;
  }

  const submitButton = menuForm.querySelector('button[type="submit"]');
  const formData = new FormData(menuForm);

  const name = String(formData.get("name") || "").trim();
  const description = String(formData.get("description") || "").trim();
  const price = Number(formData.get("price"));
  const category = String(formData.get("category") || "").trim();

  if (!name || !category || !Number.isFinite(price) || price <= 0) {
    showMenuMessage("Enter a food name, category, and valid price.", true);
    return;
  }

  submitButton.disabled = true;
  let saveStage = "menu item save";

  try {
    showMenuMessage(
      editingItemId !== null ? "Saving changes..." : "Adding menu item..."
    );

    let uploadedImageURL = null;

    if (selectedImageFile) {
      saveStage = "photo upload";
      imageUploadMessage.textContent = "Uploading photo...";
      try {
        uploadedImageURL = await uploadMenuImage(selectedImageFile);
      } catch (error) {
        imageUploadMessage.textContent =
          `Photo upload failed: ${error.message || "Check the Supabase Storage policy for this bucket."}`;
        throw error;
      }
      saveStage = "menu item save";
      imageUploadMessage.textContent = "Photo uploaded. Saving menu item...";
    }

    const item = {
      name,
      description: description || null,
      price,
      category
    };

    if (uploadedImageURL) {
      item.image_url = uploadedImageURL;
    }

    let result;

    if (editingItemId !== null) {
      result = await supabaseClient
        .from("menu_items")
        .update(item)
        .eq("id", editingItemId);
    } else {
      result = await supabaseClient
        .from("menu_items")
        .insert({
          ...item,
          image_url: uploadedImageURL,
          is_available: true
        });
    }

    if (result.error) throw result.error;

    const wasEditing = editingItemId !== null;

    editingItemId = null;
    menuForm.reset();
    selectedImageFile = null;
    clearImagePreview();

    imageUploadMessage.textContent = "";
    submitButton.textContent = "Add Menu Item";

    showMenuMessage(
      wasEditing
        ? "Menu item updated successfully."
        : "Menu item added successfully."
    );

    await loadMenuItems();
  } catch (error) {
    console.error(`Menu ${saveStage} error:`, error);
    showMenuMessage(
      `${saveStage === "photo upload" ? "Photo upload" : "Menu item save"} failed: ${error.message || "Please try again."}`,
      true
    );
  } finally {
    submitButton.disabled = false;
  }
});

initializeMenuPage();