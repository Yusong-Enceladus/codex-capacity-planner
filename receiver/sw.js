let cachedConfig = null;

async function config() {
  if (cachedConfig) return cachedConfig;
  const response = await fetch("/api/config", { cache: "no-store" });
  if (!response.ok) throw new Error(`config_${response.status}`);
  cachedConfig = await response.json();
  return cachedConfig;
}

function base64URLBytes(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function post(path, body) {
  async function send(current) {
    return fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-codex-reset-token": current.capabilityToken,
      },
      body: JSON.stringify(body || {}),
    });
  }

  let response = await send(await config());
  if (response.status === 403) {
    // The monitor may have restored a state backup while this worker was
    // asleep. Refresh the loopback capability token once and retry in-place.
    cachedConfig = null;
    response = await send(await config());
  }
  if (!response.ok) throw new Error(`${path}_${response.status}`);
  return response.json();
}

async function buildNotification() {
  try {
    return await post("/api/push-event", {});
  } catch {
    return {
      title: "Codex Capacity Planner",
      options: {
        body: "收到一次 Push，但本机尚未完成事件核验；打开接收器可立即重试。",
        tag: "codex-reset-unverified",
        renotify: false,
        data: { url: "/" },
      },
    };
  }
}

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  event.waitUntil(
    buildNotification().then((notification) =>
      self.registration.showNotification(notification.title, notification.options),
    ),
  );
});

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    config()
      .then((current) =>
        self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64URLBytes(current.publicKey),
        }),
      )
      .then((subscription) =>
        post("/api/subscribe", { subscription: subscription.toJSON(), locale: "zh" }),
      ),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (new URL(client.url).pathname === "/" && "focus" in client) return client.focus();
      }
      return self.clients.openWindow("/");
    }),
  );
});
