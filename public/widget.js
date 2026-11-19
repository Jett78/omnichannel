/**
 * Unified Omnichannel Inbox — website live-chat loader (Phase 11).
 *
 * A site includes this file once:
 *   <script src="https://YOUR-APP/widget.js"
 *           data-website-token="wt_…" data-color="#4f46e5" async></script>
 *
 * It draws a floating chat bubble (bottom-right) and toggles an
 * iframe panel that hosts the actual chat UI at /widget/{token} —
 * the iframe keeps the widget's styles fully isolated from the
 * host site. The chat iframe is only loaded on first open, so the
 * widget costs the host page nothing until a visitor clicks.
 */
(function () {
  var script = document.currentScript;
  if (!script || !script.getAttribute) return;
  var token = script.getAttribute("data-website-token");
  if (!token) return;
  var color = script.getAttribute("data-color") || "#4f46e5";
  var base = script.src.replace(/\/widget\.js(?:\?.*)?$/, "");

  var CHAT_ICON =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
  var CLOSE_ICON =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';

  var button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", "Chat with us");
  button.innerHTML = CHAT_ICON;
  button.style.cssText =
    "position:fixed;right:20px;bottom:20px;z-index:2147483000;width:56px;height:56px;" +
    "border-radius:9999px;border:none;cursor:pointer;padding:0;" +
    "box-shadow:0 8px 24px rgba(0,0,0,.25);background:" +
    color +
    ";display:flex;align-items:center;justify-content:center;";

  var panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;right:20px;bottom:88px;z-index:2147483000;width:384px;" +
    "max-width:calc(100vw - 32px);height:620px;max-height:calc(100dvh - 116px);" +
    "border-radius:16px;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.30);" +
    "display:none;background:#fff;";

  var iframe = null;
  var open = false;

  function applyMobileLayout() {
    if (window.innerWidth < 520) {
      panel.style.right = "0";
      panel.style.bottom = "0";
      panel.style.width = "100vw";
      panel.style.maxWidth = "100vw";
      panel.style.height = "100dvh";
      panel.style.maxHeight = "100dvh";
      panel.style.borderRadius = "0";
    } else {
      panel.style.right = "20px";
      panel.style.bottom = "88px";
      panel.style.width = "384px";
      panel.style.maxWidth = "calc(100vw - 32px)";
      panel.style.height = "620px";
      panel.style.maxHeight = "calc(100dvh - 116px)";
      panel.style.borderRadius = "16px";
    }
  }

  function layoutButton() {
    // On small screens the open panel is full-screen, so the toggle
    // becomes a close button floating over the panel's header —
    // otherwise there would be no way to close it.
    if (open && window.innerWidth < 520) {
      button.style.bottom = "auto";
      button.style.top = "10px";
      button.style.right = "12px";
      button.style.width = "40px";
      button.style.height = "40px";
      button.style.boxShadow = "none";
    } else {
      button.style.bottom = "20px";
      button.style.top = "auto";
      button.style.right = "20px";
      button.style.width = "56px";
      button.style.height = "56px";
      button.style.boxShadow = "0 8px 24px rgba(0,0,0,.25)";
    }
  }

  function toggle() {
    open = !open;
    if (open && !iframe) {
      iframe = document.createElement("iframe");
      iframe.src = base + "/widget/" + encodeURIComponent(token);
      iframe.title = "Chat with us";
      iframe.style.cssText = "width:100%;height:100%;border:0;display:block;";
      panel.appendChild(iframe);
    }
    applyMobileLayout();
    layoutButton();
    panel.style.display = open ? "block" : "none";
    button.innerHTML = open ? CLOSE_ICON : CHAT_ICON;
  }

  button.addEventListener("click", toggle);
  window.addEventListener("resize", function () {
    if (open) {
      applyMobileLayout();
      layoutButton();
    }
  });

  function mount() {
    document.body.appendChild(panel);
    document.body.appendChild(button);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
