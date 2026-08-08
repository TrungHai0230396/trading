"use client";

import * as React from "react";

/**
 * Scrolls to `#id` and holds it there while the page is still growing.
 *
 * The naive versions of this failed twice, for a reason worth writing down:
 * on /settings each broker card fetches its balances from the exchange and
 * expands when they arrive — which takes SECONDS, not milliseconds. A one-shot
 * scroll lands correctly and then drifts as content above the anchor grows,
 * and a fixed settle window (1.5s) simply ended before the exchanges answered.
 * A measured comparison made this concrete: a test page whose cards finished
 * growing at 800ms scrolled correctly; /settings did not.
 *
 * So don't guess a duration — watch the document and re-assert whenever it
 * actually changes size, until it stops or the user takes over.
 */
export function ScrollToHash({
  findWindowMs = 3000,
  maxHoldMs = 10000,
}: {
  /** How long to wait for the target to exist at all. */
  findWindowMs?: number;
  /** Hard stop, so a page that never settles can't hold the scroll forever. */
  maxHoldMs?: number;
}) {
  React.useEffect(() => {
    const id = decodeURIComponent(window.location.hash.replace(/^#/, ""));
    if (!id) return;

    let done = false;
    let findTimer: ReturnType<typeof setTimeout> | undefined;
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    let ro: ResizeObserver | undefined;

    // A deliberate scroll means the user has taken over. Re-asserting past
    // that point would yank the page out from under them, which is worse than
    // landing a little off.
    const release = () => {
      if (done) return;
      done = true;
      ro?.disconnect();
      if (findTimer) clearTimeout(findTimer);
      if (stopTimer) clearTimeout(stopTimer);
      window.removeEventListener("wheel", release);
      window.removeEventListener("touchmove", release);
      window.removeEventListener("keydown", onKey);
    };
    const onKey = (e: KeyboardEvent) => {
      if (
        ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", " "].includes(
          e.key,
        )
      ) {
        release();
      }
    };
    window.addEventListener("wheel", release, { passive: true });
    window.addEventListener("touchmove", release, { passive: true });
    window.addEventListener("keydown", onKey);

    // "auto", not "smooth": a smooth scroll is an animation, and the reflow
    // from a card expanding cancels it part-way.
    const snap = () => {
      if (done) return;
      document.getElementById(id)?.scrollIntoView({
        behavior: "auto",
        block: "start",
      });
    };

    const findDeadline = Date.now() + findWindowMs;
    const start = () => {
      if (done) return;
      const el = document.getElementById(id);
      if (!el) {
        if (Date.now() < findDeadline) findTimer = setTimeout(start, 100);
        else release();
        return;
      }

      snap();
      // Re-snap on every layout change rather than on a timer: this is what
      // survives an exchange call that answers after four seconds.
      //
      // Observe <body>, NOT <html>. A ResizeObserver watches the CONTENT BOX,
      // and the root element's content box is the viewport — measured here at
      // 559px while the document was 2688px tall, and unchanged after 800px of
      // content was appended. Watching <html> therefore almost never fires,
      // which is exactly why the previous attempt stopped holding position the
      // moment the broker cards began to expand. <body> does grow with its
      // content (2688 = the full document height).
      ro = new ResizeObserver(snap);
      ro.observe(document.body);
      stopTimer = setTimeout(release, maxHoldMs);
    };

    start();
    return release;
  }, [findWindowMs, maxHoldMs]);

  return null;
}
