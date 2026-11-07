import { authApi } from "../api/auth.js";
import { UnauthorizedError } from "../api/http.js";
import { el } from "../util/dom.js";
import { icon } from "./icons.js";

export function renderLogin(root: HTMLElement, onSuccess: () => void): void {
  const input = el("input", {
    class: "login__input",
    id: "login-password",
    type: "password",
    autocomplete: "current-password",
  });
  const label = el("label", { class: "login__label", htmlFor: "login-password", textContent: "비밀번호" });
  const error = el("p", { class: "login__error" });
  const submit = el("button", { class: "btn btn--primary login__submit", type: "submit", textContent: "로그인" });

  const mark = icon("lock", 24);
  mark.classList.add("login__mark");
  const form = el("form", { class: "login__form" }, [
    mark,
    el("h1", { class: "login__title", textContent: "미디어 관리자" }),
    label,
    input,
    error,
    submit,
  ]);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    submit.disabled = true;
    try {
      await authApi.login(input.value);
      onSuccess();
    } catch (err) {
      error.textContent =
        err instanceof UnauthorizedError ? "비밀번호가 맞지 않습니다" : "로그인하지 못했습니다";
      submit.disabled = false;
    }
  });

  root.replaceChildren(el("div", { class: "login" }, [form]));
  input.focus();
}
