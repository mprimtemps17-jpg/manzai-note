import type { Status } from "./domain.ts";

export function bindSwipe(list: HTMLElement, commit: (id: string, status: Status) => void) {
  let drag: { card: HTMLElement; id: number; x: number; y: number; horizontal: boolean } | undefined;
  let suppressClick = false;

  list.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0 || !(event.target instanceof Element) || event.target.closest(".memo-menu")) return;
    const card = event.target.closest<HTMLElement>(".swipe-card");
    if (!card) return;
    suppressClick = false;
    drag = { card, id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false };
  });
  list.addEventListener("pointermove", event => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.horizontal) {
      if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { drag = undefined; return; }
      if (Math.abs(dx) < 12 || Math.abs(dx) <= Math.abs(dy) * 1.25) return;
      drag.horizontal = true;
      list.setPointerCapture(event.pointerId);
      drag.card.classList.add("dragging");
    }
    drag.card.style.setProperty("--swipe", Math.min(155, Math.max(-155, dx)) + "px");
    drag.card.dataset.direction = dx >= 0 ? "right" : "left";
  });
  function finish(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    const { card, horizontal, x } = drag;
    drag = undefined;
    const dx = event.clientX - x;
    card.classList.remove("dragging");
    card.style.removeProperty("--swipe");
    delete card.dataset.direction;
    if (!horizontal) return;
    suppressClick = true;
    window.setTimeout(() => { suppressClick = false; }, 350);
    if (event.type === "pointerup" && Math.abs(dx) >= 62) {
      const id = card.dataset.swipeId!;
      card.style.setProperty("--swipe", dx > 0 ? "100px" : "-100px");
      card.dataset.direction = dx > 0 ? "right" : "left";
      window.setTimeout(() => {
        card.style.removeProperty("--swipe");
        delete card.dataset.direction;
        if (card.isConnected) commit(id, dx > 0 ? "ready" : "shelved");
      }, matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 120);
    }
  }
  list.addEventListener("pointerup", finish);
  list.addEventListener("pointercancel", finish);
  list.addEventListener("lostpointercapture", event => {
    // Touch starts with implicit capture on the pressed element. Its capture is
    // transferred to the list when a horizontal drag starts.
    if (event.target === list) finish(event);
  });
  list.addEventListener("click", event => {
    if (!suppressClick || event.detail === 0) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClick = false;
  }, true);
}
