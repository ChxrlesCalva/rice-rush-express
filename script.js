
const splashScreen = document.getElementById("splash-screen");

const loginView = document.getElementById("login-view");
const signupView = document.getElementById("signup-view");
const forgotView = document.getElementById("forgot-view");

const loginForm = document.getElementById("login-form");
const signupForm = document.getElementById("signup-form");
const forgotForm = document.getElementById("forgot-form");

const openSignup = document.getElementById("open-signup");
const backToLogin = document.getElementById("back-to-login");
const forgotPassword = document.getElementById("forgot-password");
const forgotBack = document.getElementById("forgot-back");

const loginMessage = document.getElementById("login-message");
const signupMessage = document.getElementById("signup-message");

function showView(view) {
  [loginView, signupView, forgotView].forEach((section) => {
    if (section) section.classList.add("hidden");
  });

  if (view) view.classList.remove("hidden");

  [loginMessage, signupMessage].forEach((element) => {
    if (element) element.className = "form-message";
  });

  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showMessage(element, message, type = "error") {
  if (!element) return;

  element.textContent = message;
  element.className = `form-message visible ${type}`;
}

const accessMessages = {
  "login-required": "Please sign in to continue.",
  "profile-error": "We couldn't verify your account role. Please sign in again or contact the administrator.",
  "unsupported-role": "Your account role does not have an implemented dashboard. Contact the administrator."
};

const accessMessage = new URLSearchParams(window.location.search).get("access");

if (typeof accessMessages[accessMessage] === "string") {
  showMessage(loginMessage, accessMessages[accessMessage]);
}

// Check that Supabase was loaded by the HTML files.
function getSupabase() {
  if (typeof supabaseClient === "undefined") {
    throw new Error(
      "Supabase is not loaded. Check supabase-config.js and index.html."
    );
  }

  return supabaseClient;
}

window.addEventListener("load", () => {
  setTimeout(() => {
    if (splashScreen) {
      splashScreen.classList.add("slide-left");
    }
  }, 3000);
});

// Switch between login, signup and forgot-password views.
openSignup?.addEventListener("click", () => showView(signupView));
backToLogin?.addEventListener("click", () => showView(loginView));
forgotPassword?.addEventListener("click", () => showView(forgotView));
forgotBack?.addEventListener("click", () => showView(loginView));

// CUSTOMER SIGNUP
if (signupForm) {
  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const fullName =
      document.getElementById("full-name")?.value.trim() || "";
    const email =
      document.getElementById("signup-email")?.value.trim() || "";
    const password =
      document.getElementById("signup-password")?.value || "";
    const confirmPassword =
      document.getElementById("confirm-password")?.value || "";

    if (!fullName || !email || !password || !confirmPassword) {
      showMessage(signupMessage, "Please complete all required fields.");
      return;
    }

    if (password.length < 8) {
      showMessage(
        signupMessage,
        "Your password must contain at least 8 characters."
      );
      return;
    }

    if (password !== confirmPassword) {
      showMessage(
        signupMessage,
        "Your passwords do not match. Please try again."
      );
      return;
    }

    const submitButton = signupForm.querySelector(
      'button[type="submit"], button:not([type])'
    );

    if (submitButton) submitButton.disabled = true;

    try {
      const client = getSupabase();

      const { data, error } = await client.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName
          }
        }
      });

      if (error) throw error;

      if (data.session) {
        showMessage(
          signupMessage,
          "Account created! Opening your customer dashboard...",
          "success"
        );

        window.location.href = "customer/customer.html";
      } else {
        showMessage(
          signupMessage,
          "Registration received! Check your email for the confirmation link before signing in.",
          "success"
        );
      }
    } catch (error) {
      console.error("Signup error:", error);
      showMessage(
        signupMessage,
        error.message || "We couldn't create your account. Please try again."
      );
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

// CUSTOMER LOGIN
if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const emailInput = loginForm.querySelector('input[type="email"]');
    const passwordInput = loginForm.querySelector(
      'input[type="password"]'
    );

    const email = emailInput?.value.trim() || "";
    const password = passwordInput?.value || "";

    if (!email || !password) {
      showMessage(
        loginMessage,
        "Please enter your email and password."
      );
      return;
    }

    try {
      const client = getSupabase();

      const { data, error } = await client.auth.signInWithPassword({
        email,
        password
      });

      if (error) throw error;

      const { data: profile, error: profileError } = await client
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .maybeSingle();

      if (profileError) {
        console.error("Profile lookup error:", profileError);
        const { error: signOutError } = await client.auth.signOut();
        if (signOutError) console.error("Could not clear unverified login:", signOutError);
        showMessage(
          loginMessage,
          "You signed in, but we couldn't load your profile. Please contact the administrator."
        );
        return;
      }

      const role = profile?.role;

      const destination = role === "admin"
        ? "admin/admin.html"
        : role === "customer"
          ? "customer/customer.html"
          : null;

      if (!destination) {
        const { error: signOutError } = await client.auth.signOut();
        if (signOutError) console.error("Could not clear unsupported login:", signOutError);

        showMessage(
          loginMessage,
          !role
            ? "Your account role is missing. Please contact the administrator."
            : "Your account role does not have an implemented dashboard. Contact the administrator."
        );
        return;
      }

      window.location.href = destination;
    } catch (error) {
      console.error("Login error:", error);
      showMessage(
        loginMessage,
        error.message || "Unable to sign in. Please try again."
      );
    }
  });
}

// PASSWORD RESET
if (forgotForm) {
  forgotForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email =
      forgotForm.querySelector('input[type="email"]')?.value.trim() || "";

    if (!email) {
      showMessage(
        document.getElementById("forgot-message"),
        "Please enter your email address."
      );
      return;
    }

    try {
      const client = getSupabase();
      const { error } = await client.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + window.location.pathname
      });

      if (error) throw error;

      showMessage(
        document.getElementById("forgot-message"),
        "If an account exists for that email, a password reset link will be sent.",
        "success"
      );
    } catch (error) {
      console.error("Password reset error:", error);
      showMessage(
        document.getElementById("forgot-message"),
        error.message || "Unable to request a password reset."
      );
    }
  });
}
