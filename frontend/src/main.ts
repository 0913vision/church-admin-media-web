import { authApi } from "./api/auth.js";
import { renderDashboard } from "./ui/dashboard.js";
import { renderLogin } from "./ui/login.js";

const root = document.getElementById("app");

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
