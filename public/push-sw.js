/* global self */

const DEFAULT_TARGET = "/dashboard";

function safeTargetPath(value) {
  if (typeof value !== "string") return DEFAULT_TARGET;
  try {
    const target = new URL(value, self.location.origin);
    if (target.origin !== self.location.origin || !target.pathname.startsWith("/ch/")) {
      return DEFAULT_TARGET;
    }
    return `${target.pathname}${target.search}`;
  } catch {
    return DEFAULT_TARGET;
  }
}

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  const target = safeTargetPath(payload.url);
  event.waitUntil(self.registration.showNotification(
    typeof payload.title === "string" ? payload.title : "yap.",
    {
      body: typeof payload.body === "string" ? payload.body : "",
      icon: "/icons/yap-logo-192.png",
      badge: "/icons/yap-logo-192.png",
      tag: typeof payload.tag === "string" ? payload.tag : undefined,
      data: { target },
    },
  ));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeTargetPath(event.notification.data?.target);
  const absoluteTarget = new URL(target, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const matchingClient = clients.find((client) => {
      try {
        const url = new URL(client.url);
        return url.origin === self.location.origin && `${url.pathname}${url.search}` === target;
      } catch {
        return false;
      }
    });
    if (matchingClient && "focus" in matchingClient) return matchingClient.focus();
    return self.clients.openWindow(absoluteTarget);
  }));
});
