const ATTR_TRANS = "data-imt-translation";
const ATTR_PLACE = "data-imt-placeholder";
const ATTR_MODEL = "data-imt-model";

/** Coalesce identical toasts: at most one visible per key within this window. */
const TOAST_COALESCE_MS = 8000;

interface ToastState {
  message: string;
  level: string;
  count: number;
  el: HTMLElement;
  timer: number;
  lastAt: number;
}

let activeToast: ToastState | null = null;

function fillTranslationNode(
  node: HTMLElement,
  translation: string,
  meta?: { modelId?: string; platform?: string; fromCache?: boolean }
): void {
  node.replaceChildren();
  const text = document.createElement("span");
  text.className = "imt-translation-text";
  text.textContent = translation;
  node.appendChild(text);

  if (meta?.modelId) {
    node.setAttribute(ATTR_MODEL, meta.modelId);
    const mark = document.createElement("sup");
    mark.className = "imt-model-footnote";
    mark.textContent = meta.modelId;
    mark.title = `模型 ${meta.modelId}${meta.fromCache ? "（缓存）" : ""}${
      meta.platform ? ` · ${meta.platform}` : ""
    }`;
    node.appendChild(mark);
  } else {
    node.removeAttribute(ATTR_MODEL);
  }
}

export function insertTranslation(
  el: HTMLElement,
  translation: string,
  meta?: { modelId?: string; platform?: string; fromCache?: boolean }
): void {
  removePlaceholder(el);
  let node = el.nextElementSibling as HTMLElement | null;
  if (node?.hasAttribute(ATTR_TRANS)) {
    fillTranslationNode(node, translation, meta);
  } else {
    node = document.createElement("div");
    node.setAttribute(ATTR_TRANS, "1");
    node.className = "imt-translation";
    fillTranslationNode(node, translation, meta);
    el.insertAdjacentElement("afterend", node);
  }
}

export function insertPlaceholder(el: HTMLElement, message = "未缓存 / 缓存不足"): void {
  removeTranslation(el);
  let node = el.nextElementSibling as HTMLElement | null;
  if (node?.hasAttribute(ATTR_PLACE)) {
    node.textContent = message;
    return;
  }
  node = document.createElement("div");
  node.setAttribute(ATTR_PLACE, "1");
  node.className = "imt-placeholder";
  node.textContent = message;
  el.insertAdjacentElement("afterend", node);
}

export function removeTranslation(el: HTMLElement): void {
  const next = el.nextElementSibling as HTMLElement | null;
  if (next?.hasAttribute(ATTR_TRANS)) next.remove();
}

export function removePlaceholder(el: HTMLElement): void {
  const next = el.nextElementSibling as HTMLElement | null;
  if (next?.hasAttribute(ATTR_PLACE)) next.remove();
}

export function teardownAll(): void {
  document.querySelectorAll(`[${ATTR_TRANS}],[${ATTR_PLACE}]`).forEach((n) => n.remove());
  document.querySelectorAll("[data-imt-id]").forEach((n) => {
    if (n instanceof HTMLElement) delete n.dataset.imtId;
  });
  const toastHost = document.getElementById("imt-toast-host");
  toastHost?.remove();
  if (activeToast?.timer) window.clearTimeout(activeToast.timer);
  activeToast = null;
}

function toastKey(message: string, level: string): string {
  // Normalize rate-limit / quota messages so slight wording diffs still coalesce
  const norm = message
    .replace(/（已尝试备用平台）/g, "")
    .replace(/（×\d+）/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${level}::${norm}`;
}

function formatToastText(message: string, count: number): string {
  if (count <= 1) return message;
  return `${message}（×${count}）`;
}

export function showToast(
  message: string,
  level: "info" | "error" | "warn" = "info"
): void {
  let host = document.getElementById("imt-toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "imt-toast-host";
    host.className = "imt-toast-host";
    document.documentElement.appendChild(host);
  }

  const key = toastKey(message, level);
  const now = Date.now();

  if (
    activeToast &&
    toastKey(activeToast.message, activeToast.level) === key &&
    now - activeToast.lastAt < TOAST_COALESCE_MS
  ) {
    activeToast.count += 1;
    activeToast.lastAt = now;
    activeToast.el.textContent = formatToastText(activeToast.message, activeToast.count);
    window.clearTimeout(activeToast.timer);
    activeToast.timer = window.setTimeout(() => {
      activeToast?.el.remove();
      activeToast = null;
    }, 4500);
    return;
  }

  // Replace previous coalesce target; keep host tidy (no stack of identical errors)
  if (activeToast) {
    window.clearTimeout(activeToast.timer);
    activeToast.el.remove();
    activeToast = null;
  }

  const toast = document.createElement("div");
  toast.className = `imt-toast imt-toast--${level}`;
  toast.textContent = message;
  host.appendChild(toast);

  activeToast = {
    message,
    level,
    count: 1,
    el: toast,
    lastAt: now,
    timer: window.setTimeout(() => {
      toast.remove();
      if (activeToast?.el === toast) activeToast = null;
    }, 4500),
  };
}

export function countInjected(): number {
  return document.querySelectorAll(`[${ATTR_TRANS}],[${ATTR_PLACE}]`).length;
}
