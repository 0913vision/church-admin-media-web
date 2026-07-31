import { authApi } from "../api/auth.js";
import { UnauthorizedError } from "../api/http.js";
import { el } from "../util/dom.js";

export function renderLogin(root: HTMLElement, onSuccess: () => void): void {
  const input = el("input", {
    class: "login__input",
    type: "password",
    placeholder: "관리자 비밀번호",
    autocomplete: "current-password",
  });
  const error = el("p", { class: "login__error" });
  const submit = el("button", { class: "btn btn--primary login__submit", type: "submit", textContent: "로그인" });

  const form = el("form", { class: "login__form" }, [
    el("h1", { class: "login__title", textContent: "미디어 관리자" }),
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
        err instanceof UnauthorizedError ? "비밀번호가 올바르지 않습니다." : "로그인에 실패했습니다.";
      submit.disabled = false;
    }
  });

  root.replaceChildren(el("div", { class: "login" }, [form]));
  input.focus();
}
