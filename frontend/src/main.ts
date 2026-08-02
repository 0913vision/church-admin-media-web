import { authApi } from "./api/auth.js";
import { renderDashboard } from "./ui/dashboard.js";
import { renderLogin } from "./ui/login.js";

const root = document.getElementById("app");

// Note(yoochan.kim): Applied before anything paints, so the login screen matches the dashboard
// the operator left in.
document.documentElement.dataset.theme = localStorage.getItem("theme") ?? "light";

function showLogin(): void {
  if (root) renderLogin(root, showDashboard);
}

function showDashboard(): void {
  if (root) renderDashboard(root, showLogin);
}

async function boot(): Promise<void> {
  try {
    const { authenticated } = await authApi.session();
    if (authenticated) showDashboard();
    else showLogin();
  } catch {
    showLogin();
  }
}

void boot();
