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

async function isTargetChannelVisible(target) {
  try {
    const targetUrl = new URL(target, self.location.origin);
    if (targetUrl.origin !== self.location.origin || !targetUrl.pathname.startsWith("/ch/")) {
      return false;
    }

    const clients = await self.clients.matchAll({
      type: "window",
      includeUncontrolled: true,
    });
    const visibleClients = clients.filter((client) => client.visibilityState === "visible");
    const currentTargets = await Promise.all(visibleClients.map((client) => new Promise((resolve) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => resolve(null), 200);
      channel.port1.onmessage = (messageEvent) => {
        clearTimeout(timeout);
        const response = messageEvent.data;
        if (response?.visible !== true || typeof response?.target !== "string") {
          resolve(null);
          return;
        }
        resolve(response.target);
      };
      client.postMessage({ type: "push-visibility-probe" }, [channel.port2]);
    })));

    return currentTargets.some((currentTarget) => {
      if (typeof currentTarget !== "string") return false;
      try {
        const currentUrl = new URL(currentTarget, self.location.origin);
        return currentUrl.origin === self.location.origin
          && currentUrl.pathname === targetUrl.pathname;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
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
  event.waitUntil((async () => {
    if (await isTargetChannelVisible(target)) return;

    await self.registration.showNotification(
      typeof payload.title === "string" ? payload.title : "yap.",
      {
        body: typeof payload.body === "string" ? payload.body : "",
        icon: "/icons/yap-logo-192.png",
        badge: "/icons/yap-logo-192.png",
        tag: typeof payload.tag === "string" ? payload.tag : undefined,
        data: { target },
      },
    );
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeTargetPath(event.notification.data?.target);
  const absoluteTarget = new URL(target, self.location.origin).href;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const matchingClient = clients.find((client) => {
      try {
        const url = new URL(client.url);
        return url.origin === self.location.origin && `${url.pathname}${url.search}` === target;
      } catch {
        return false;
      }
    });
    if (matchingClient && "focus" in matchingClient) return matchingClient.focus();

    const isSameOriginClient = (client) => {
      try {
        return new URL(client.url).origin === self.location.origin;
      } catch {
        return false;
      }
    };
    const reusableClient = clients.find((client) => client.focused && isSameOriginClient(client))
      || clients.find((client) => client.visibilityState === "visible" && isSameOriginClient(client))
      || clients.find(isSameOriginClient);

    if (reusableClient) {
      reusableClient.postMessage({ type: "push-navigation", target });

      try {
        if ("navigate" in reusableClient) {
          const navigatedClient = await reusableClient.navigate(absoluteTarget);
          if (navigatedClient && "focus" in navigatedClient) {
            return navigatedClient.focus();
          }
        }
      } catch {
        // The page-level message handles iOS clients that cannot be navigated here.
      }

      if ("focus" in reusableClient) {
        return reusableClient.focus();
      }
    }

    return self.clients.openWindow(absoluteTarget);
  })());
});
