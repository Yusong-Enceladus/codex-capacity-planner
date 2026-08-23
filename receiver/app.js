const statusDot = document.querySelector("#status-dot");
const statusTitle = document.querySelector("#status-title");
const statusDetail = document.querySelector("#status-detail");
const subscribeButton = document.querySelector("#subscribe");
const unsubscribeButton = document.querySelector("#unsubscribe");
const refreshButton = document.querySelector("#refresh");

let config = null;
let registration = null;

function base64URLBytes(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function setStatus(kind, title, detail) {
  statusDot.className = `dot ${kind || ""}`;
  statusTitle.textContent = title;
  statusDetail.textContent = detail;
  statusDetail.classList.toggle("error", kind === "error");
}

async function localJSON(url, options) {
  const response = await fetch(url, { cache: "no-store", ...(options || {}) });
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

async function postLocal(path, body, retried) {
  let response = await fetch(path, {
    cache: "no-store",
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-codex-reset-token": config.capabilityToken,
    },
    body: JSON.stringify(body),
  });
  if (response.status === 403 && !retried) {
    config = await localJSON("/api/config");
    return postLocal(path, body, true);
  }
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  return response.json();
}

async function reconcileExistingSubscription() {
  const [state, subscription] = await Promise.all([
    localJSON("/api/state"),
    registration.pushManager.getSubscription(),
  ]);
  if (subscription && state.push.registered !== true && Notification.permission === "granted") {
    await postLocal("/api/subscribe", {
      subscription: subscription.toJSON(),
      locale: "zh",
    });
  }
}

function relativeTime(value) {
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return "尚未";
  const minutes = Math.max(0, Math.floor((Date.now() - at) / 60000));
  if (minutes < 2) return "刚刚";
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.floor(minutes / 60)} 小时前`;
}

async function refreshState() {
  const [state, subscription] = await Promise.all([
    localJSON("/api/state"),
    registration.pushManager.getSubscription(),
  ]);
  const active = Boolean(subscription && state.push.registered);
  subscribeButton.hidden = active;
  unsubscribeButton.hidden = !active;
  if (active) {
    const verified = state.push.verifiedAt
      ? `最近一次真实 Push：${relativeTime(state.push.lastPushAt)}`
      : "订阅已建立；首次真实事件到来前标记为待验证。";
    setStatus("ok", "低延迟 Push 已启用", verified);
  } else if (Notification.permission === "denied") {
    setStatus("error", "通知权限已被阻止", "请在浏览器的网站设置中允许 127.0.0.1 的通知。" );
  } else {
    setStatus("warn", "当前由 Atom 与站点 API 补漏", "启用 Push 后，明确重置可以更快唤醒本机计算。" );
  }
}

async function setup() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    throw new Error("当前浏览器不支持后台 Push");
  }
  config = await localJSON("/api/config");
  registration = await navigator.serviceWorker.register("/sw.js", {
    scope: "/",
    updateViaCache: "none",
  });
  await navigator.serviceWorker.ready;
  await reconcileExistingSubscription();
  await refreshState();
}

subscribeButton.addEventListener("click", async () => {
  subscribeButton.disabled = true;
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("没有获得通知权限");
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64URLBytes(config.publicKey),
      });
    }
    await postLocal("/api/subscribe", {
      subscription: subscription.toJSON(),
      locale: "zh",
    });
    await refreshState();
  } catch (error) {
    setStatus("error", "Push 启用失败", String(error && error.message ? error.message : error));
  } finally {
    subscribeButton.disabled = false;
  }
});

unsubscribeButton.addEventListener("click", async () => {
  unsubscribeButton.disabled = true;
  try {
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await postLocal("/api/unsubscribe", { endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    await refreshState();
  } catch (error) {
    setStatus("error", "取消失败", String(error && error.message ? error.message : error));
  } finally {
    unsubscribeButton.disabled = false;
  }
});

refreshButton.addEventListener("click", () => refreshState().catch((error) => {
  setStatus("error", "状态读取失败", String(error && error.message ? error.message : error));
}));

setup().catch((error) => {
  setStatus("error", "本机接收器不可用", String(error && error.message ? error.message : error));
  subscribeButton.disabled = true;
});
