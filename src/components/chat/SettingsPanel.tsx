"use client";

import { CloseIcon } from "@/components/ui/CloseIcon";
import { useEffect, useState, useRef } from "react";
import { useLocale } from "@/hooks/useLocale";
import { useSession } from "next-auth/react";
import { saveFontSize } from "@/components/UserPreferencesSync";
import { normalizeBubbleColor } from "@/lib/bubble-color";
import {
  getWebPushSupport,
  subscribeCurrentBrowserToPush,
} from "@/lib/web-push-client";

const BUBBLE_COLORS = [
  "#3598fe",
  "#9b59b6",
  "#2e7d32",
  "#e74c3c",
  "#f39c12",
  "#1abc9c",
  "#e91e63",
];

function darkenColor(hex: string, amount: number): string {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.max(0, (num >> 16) - amount);
  const g = Math.max(0, ((num >> 8) & 0xff) - amount);
  const b = Math.max(0, (num & 0xff) - amount);

  return `#${(
    (r << 16) |
    (g << 8) |
    b
  )
    .toString(16)
    .padStart(6, "0")}`;
}

interface SettingsPanelProps {
  channelId: string;
  currentColor: string;
  onColorChange: (color: string) => void;
  notificationsAvailable: boolean;
  onAdmin?: () => void;
  onClose: () => void;
}

type NotificationMode =
  | "off"
  | "important"
  | "all";

type NotificationState =
  | "loading"
  | NotificationMode
  | "unsupported"
  | "blocked"
  | "error"
  | "ios-install-required"
  | "ios-update-required";

type NotificationNote =
  | "notificationReconfirm";

export function SettingsPanel({
  channelId,
  currentColor,
  onColorChange,
  notificationsAvailable,
  onAdmin,
  onClose,
}: SettingsPanelProps) {
  const { t } = useLocale();
  const { status } = useSession();

  const [fontSize, setFontSize] = useState(() => {
    if (typeof window === "undefined") {
      return 15;
    }

    return (
      parseInt(
        getComputedStyle(
          document.documentElement,
        ).getPropertyValue(
          "--bubble-font-size",
        ),
      ) || 15
    );
  });

  const [selectedColor, setSelectedColor] =
    useState(currentColor);

  const colorInputRef =
    useRef<HTMLInputElement>(null);

  const [
    notificationState,
    setNotificationState,
  ] =
    useState<NotificationState>("loading");

  const [
    notificationBusy,
    setNotificationBusy,
  ] = useState(false);

  const [
    notificationNote,
    setNotificationNote,
  ] =
    useState<NotificationNote | null>(null);

  const [
    showIosInstallGuide,
    setShowIosInstallGuide,
  ] = useState(false);

  const [
    showNotificationInfo,
    setShowNotificationInfo,
  ] = useState(false);

  useEffect(() => {
    const handleFontSize = (
      event: Event,
    ) => {
      const size = (
        event as CustomEvent<{
          size: number;
        }>
      ).detail?.size;

      if (size) {
        setFontSize(size);
      }
    };

    window.addEventListener(
      "font-size-changed",
      handleFontSize,
    );

    return () =>
      window.removeEventListener(
        "font-size-changed",
        handleFontSize,
      );
  }, []);

  useEffect(() => {
    if (
      !notificationsAvailable ||
      status !== "authenticated"
    ) {
      return;
    }

    const support =
      getWebPushSupport();

    if (
      support === "unsupported" ||
      support ===
        "ios-install-required" ||
      support ===
        "ios-update-required"
    ) {
      setNotificationState(support);
      return;
    }

    if (support === "blocked") {
      setNotificationState("blocked");
      return;
    }

    const controller =
      new AbortController();

    setNotificationState("loading");

    fetch(
      `/api/notifications/preferences?channel=${encodeURIComponent(
        channelId,
      )}`,
      {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      },
    )
      .then(async (response) => {
        const body = (await response
          .json()
          .catch(() => null)) as {
          preference?: {
            mode?: unknown;
            requiresReconfirmation?: unknown;
          };
        } | null;

        if (!response.ok) {
          throw new Error(
            `notification_preference_failed:${response.status}`,
          );
        }

        setNotificationState(
          body?.preference?.mode ===
            "all"
            ? "all"
            : body?.preference
                  ?.mode ===
                "important"
              ? "important"
              : "off",
        );

        if (
          body?.preference
            ?.requiresReconfirmation ===
          true
        ) {
          setNotificationNote(
            "notificationReconfirm",
          );
        }
      })
      .catch(
        (error: unknown) => {
          if (
            error instanceof
              DOMException &&
            error.name ===
              "AbortError"
          ) {
            return;
          }

          setNotificationState(
            "error",
          );
        },
      );

    return () =>
      controller.abort();
  }, [
    channelId,
    notificationsAvailable,
    status,
  ]);

  const updateNotificationPreference =
    async (
      mode: NotificationMode,
    ) => {
      const response = await fetch(
        "/api/notifications/preferences",
        {
          method: "PUT",
          credentials: "same-origin",
          headers: {
            "Content-Type":
              "application/json",
          },
          body: JSON.stringify({
            channel_id: channelId,
            mode,
          }),
        },
      );

      if (!response.ok) {
        throw new Error(
          `notification_preference_failed:${response.status}`,
        );
      }
    };

  const selectNotificationMode =
    async (
      mode: NotificationMode,
    ) => {
      if (
        notificationBusy ||
        notificationState ===
          "loading"
      ) {
        return;
      }

      if (
        notificationState === mode
      ) {
        return;
      }

      setNotificationBusy(true);
      setNotificationNote(null);

      try {
        if (mode === "off") {
          await updateNotificationPreference(
            "off",
          );

          setNotificationState(
            "off",
          );

          return;
        }

        await subscribeCurrentBrowserToPush();

        await updateNotificationPreference(
          mode,
        );

        setNotificationState(mode);
      } catch (error) {
        const support =
          getWebPushSupport();

        if (
          support === "blocked" ||
          (error instanceof Error &&
            error.message ===
              "push_permission_not_granted")
        ) {
          setNotificationState(
            "blocked",
          );
        } else if (
          support === "unsupported" ||
          support ===
            "ios-install-required" ||
          support ===
            "ios-update-required"
        ) {
          setNotificationState(
            support,
          );
        } else {
          setNotificationState(
            "error",
          );
        }
      } finally {
        setNotificationBusy(false);
      }
    };

  const changeFontSize = (
    dir: number,
  ) => {
    const newSize = Math.max(
      12,
      Math.min(
        20,
        fontSize + dir,
      ),
    );

    setFontSize(newSize);

    void saveFontSize(
      newSize,
      status === "authenticated",
    );
  };

  const changeColor = (
    color: string,
  ) => {
    const normalizedColor =
      normalizeBubbleColor(color);

    setSelectedColor(
      normalizedColor,
    );

    localStorage.setItem(
      `bubbleColor_${channelId}`,
      normalizedColor,
    );

    document.documentElement.style.setProperty(
      "--bubble-sent",
      normalizedColor,
    );

    onColorChange(
      normalizedColor,
    );
  };

  const isCustomColor =
    !BUBBLE_COLORS.includes(
      selectedColor,
    );

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-6 animate-[ctxFade_0.2s_ease]"
      style={{
        background:
          "rgba(0,0,0,.4)",
        backdropFilter:
          "blur(6px)",
        WebkitBackdropFilter:
          "blur(6px)",
      }}
      onClick={(e) => {
        if (
          e.target ===
          e.currentTarget
        ) {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-[320px] rounded-[16px] overflow-hidden"
        style={{
          background: "var(--bg)",
          color:
            "var(--gray-text)",
          boxShadow:
            "0 12px 40px rgba(0,0,0,.25)",
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between"
          style={{
            padding:
              "16px 18px",
            borderBottom:
              "0.5px solid var(--hairline)",
          }}
        >
          <h3
            className="m-0 font-medium"
            style={{
              fontSize:
                "var(--bubble-font-size, 16px)",
            }}
          >
            {t("settings")}
          </h3>

          <button
            className="bg-transparent border-none cursor-pointer"
            style={{
              color:
                "var(--meta)",
              padding: "4px 8px",
            }}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Body */}
        <div
          style={{
            padding:
              "12px 18px",
          }}
        >
          {/* Font size */}
          <div
            className="flex items-start justify-between"
            style={{
              padding:
                "12px 0",
            }}
          >
            <span
              style={{
                fontSize:
                  "var(--bubble-font-size, 15px)",
                fontWeight: 400,
              }}
            >
              {t("fontSize")}
            </span>

            <div
              className="flex items-center justify-between"
              style={{
                gap: "10px",
                width: "140px",
              }}
            >
              <button
                className="cursor-pointer"
                style={{
                  width: "40px",
                  height: "32px",
                  border:
                    "1px solid var(--input-border)",
                  background:
                    "var(--input-bg)",
                  color:
                    "var(--gray-text)",
                  borderRadius:
                    "8px",
                  fontSize:
                    "var(--bubble-font-size, 13px)",
                  fontFamily:
                    "inherit",
                }}
                onClick={() =>
                  changeFontSize(
                    -1,
                  )
                }
              >
                A-
              </button>

              <span
                style={{
                  fontSize:
                    "var(--bubble-font-size, 14px)",
                  color:
                    "var(--meta)",
                  minWidth:
                    "36px",
                  textAlign:
                    "center",
                }}
              >
                {fontSize}px
              </span>

              <button
                className="cursor-pointer"
                style={{
                  width: "40px",
                  height: "32px",
                  border:
                    "1px solid var(--input-border)",
                  background:
                    "var(--input-bg)",
                  color:
                    "var(--gray-text)",
                  borderRadius:
                    "8px",
                  fontSize:
                    "var(--bubble-font-size, 13px)",
                  fontFamily:
                    "inherit",
                }}
                onClick={() =>
                  changeFontSize(
                    1,
                  )
                }
              >
                A+
              </button>
            </div>
          </div>

          {/* Bubble color */}
          <div
            className="flex items-start justify-between"
            style={{
              padding:
                "12px 0",
            }}
          >
            <span
              style={{
                fontSize:
                  "var(--bubble-font-size, 15px)",
                fontWeight: 400,
              }}
            >
              {t("bubbleColor")}
            </span>

            <div
              className="grid justify-items-center"
              style={{
                gridTemplateColumns:
                  "repeat(4, 1fr)",
                gap: "6px",
                width: "140px",
                padding: "2px",
              }}
            >
              {BUBBLE_COLORS.map(
                (color) => (
                  <button
                    key={color}
                    className="cursor-pointer"
                    style={{
                      width:
                        "calc(var(--bubble-font-size, 17px) + 9px)",
                      height:
                        "calc(var(--bubble-font-size, 17px) + 9px)",
                      borderRadius:
                        "50%",
                      background:
                        color,
                      border:
                        "3px solid transparent",
                      outline:
                        selectedColor ===
                        color
                          ? `3px solid ${darkenColor(
                              color,
                              50,
                            )}`
                          : "3px solid transparent",
                      transition:
                        "outline-color .15s, transform .15s",
                    }}
                    onClick={() =>
                      changeColor(
                        color,
                      )
                    }
                  />
                ),
              )}

              {/* Custom color picker */}
              <button
                className="cursor-pointer relative overflow-hidden"
                style={{
                  width:
                    "calc(var(--bubble-font-size, 17px) + 9px)",
                  height:
                    "calc(var(--bubble-font-size, 17px) + 9px)",
                  borderRadius:
                    "50%",
                  background:
                    "conic-gradient(red,orange,yellow,green,cyan,blue,violet,red)",
                  border:
                    "3px solid transparent",
                  outline:
                    isCustomColor
                      ? `3px solid ${darkenColor(
                          selectedColor,
                          50,
                        )}`
                      : "3px solid transparent",
                  transition:
                    "outline-color .15s, transform .15s",
                }}
              >
                <input
                  ref={
                    colorInputRef
                  }
                  type="color"
                  value={
                    selectedColor
                  }
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={(e) =>
                    changeColor(
                      e.target
                        .value,
                    )
                  }
                />
              </button>
            </div>
          </div>

          {/* Divider */}
          <div
            style={{
              height: "1px",
              background:
                "var(--hairline)",
              margin: "8px 0",
            }}
          />

          {notificationsAvailable &&
            status ===
              "authenticated" && (
              <>
                <div
                  className="flex items-start justify-between"
                  style={{
                    padding:
                      "12px 0",
                    gap: "12px",
                  }}
                >
                  <div
                    style={{
                      minWidth: 0,
                      paddingTop:
                        "2px",
                    }}
                  >
                    <div
                      className="flex items-center"
                      style={{
                        gap: "5px",
                        fontSize:
                          "var(--bubble-font-size, 15px)",
                        fontWeight:
                          400,
                      }}
                    >
                      <span>
                        {t(
                          "notifications",
                        )}
                      </span>

                      <button
                        type="button"
                        aria-label={t(
                          "notificationInfoTitle",
                        )}
                        onClick={() =>
                          setShowNotificationInfo(
                            true,
                          )
                        }
                        style={{
                          width:
                            "18px",
                          height:
                            "18px",
                          padding: 0,
                          border:
                            "1.4px solid currentColor",
                          borderRadius:
                            "50%",
                          background:
                            "transparent",
                          color:
                            "var(--meta)",
                          fontFamily:
                            "inherit",
                          fontSize:
                            "11px",
                          fontWeight:
                            700,
                          lineHeight:
                            "16px",
                          cursor:
                            "pointer",
                        }}
                      >
                        i
                      </button>
                    </div>

                    {(notificationState ===
                      "unsupported" ||
                      notificationState ===
                        "ios-install-required" ||
                      notificationState ===
                        "ios-update-required" ||
                      notificationState ===
                        "blocked" ||
                      notificationState ===
                        "error") && (
                      <div
                        style={{
                          marginTop:
                            "4px",
                          color:
                            "var(--meta)",
                          fontSize:
                            "calc(var(--bubble-font-size) - 5px)",
                          lineHeight:
                            1.35,
                        }}
                      >
                        {notificationState ===
                        "unsupported"
                          ? t(
                              "notificationUnsupported",
                            )
                          : notificationState ===
                              "ios-install-required"
                            ? t(
                                "notificationIosInstallRequired",
                              )
                            : notificationState ===
                                "ios-update-required"
                              ? t(
                                  "notificationIosUpdateRequired",
                                )
                              : notificationState ===
                                  "blocked"
                                ? t(
                                    "notificationBlocked",
                                  )
                                : t(
                                    "notificationLoadFailed",
                                  )}
                      </div>
                    )}

                    {notificationNote && (
                      <div
                        style={{
                          marginTop:
                            "4px",
                          color:
                            "var(--bubble-sent)",
                          fontSize:
                            "calc(var(--bubble-font-size) - 5px)",
                          lineHeight:
                            1.35,
                        }}
                      >
                        {t(
                          notificationNote,
                        )}
                      </div>
                    )}

                    {notificationState ===
                      "ios-install-required" && (
                      <button
                        type="button"
                        onClick={() =>
                          setShowIosInstallGuide(
                            (
                              visible,
                            ) =>
                              !visible,
                          )
                        }
                        aria-expanded={
                          showIosInstallGuide
                        }
                        style={{
                          display:
                            "block",
                          marginTop:
                            "7px",
                          padding: 0,
                          border: 0,
                          background:
                            "transparent",
                          color:
                            "var(--bubble-sent)",
                          fontSize:
                            "calc(var(--bubble-font-size) - 4px)",
                          fontWeight:
                            600,
                          cursor:
                            "pointer",
                        }}
                      >
                        {t(
                          "notificationInstallGuide",
                        )}
                      </button>
                    )}
                  </div>

                  {notificationState !==
                    "ios-install-required" &&
                    notificationState !==
                      "ios-update-required" && (
                      <div
                        className="relative flex"
                        style={{
                          width:
                            "140px",
                          height:
                            "36px",
                          flexShrink: 0,
                          padding:
                            "3px",
                          borderRadius:
                            "18px",
                          background:
                            notificationState ===
                              "important" ||
                            notificationState ===
                              "all"
                              ? "var(--bubble-sent)"
                              : "var(--input-border)",
                          boxShadow:
                            "inset 0 0 0 0.5px rgba(0,0,0,.08)",
                          transition:
                            "background-color .22s ease",
                        }}
                      >
                        <span
                          aria-hidden="true"
                          className="absolute"
                          style={{
                            top: "3px",
                            left: "3px",
                            width:
                              "calc((100% - 6px) / 3)",
                            height:
                              "30px",
                            borderRadius:
                              "15px",
                            background:
                              "#fff",
                            boxShadow:
                              "0 1px 3px rgba(0,0,0,.22), 0 1px 1px rgba(0,0,0,.08)",
                            transform: `translateX(${
                              notificationState ===
                              "important"
                                ? "100%"
                                : notificationState ===
                                    "all"
                                  ? "200%"
                                  : "0"
                            })`,
                            transition:
                              "transform .24s cubic-bezier(.4,0,.2,1)",
                          }}
                        />

                        {(
                          [
                            "off",
                            "important",
                            "all",
                          ] as NotificationMode[]
                        ).map(
                          (mode) => {
                            const selected =
                              notificationState ===
                              mode;

                            const enabled =
                              notificationState ===
                                "important" ||
                              notificationState ===
                                "all";

                            return (
                              <button
                                key={
                                  mode
                                }
                                type="button"
                                aria-pressed={
                                  selected
                                }
                                disabled={
                                  notificationBusy ||
                                  notificationState ===
                                    "loading" ||
                                  notificationState ===
                                    "unsupported" ||
                                  notificationState ===
                                    "blocked"
                                }
                                onClick={() => {
                                  void selectNotificationMode(
                                    mode,
                                  );
                                }}
                                style={{
                                  position:
                                    "relative",
                                  zIndex:
                                    1,
                                  padding:
                                    0,
                                  flex: 1,
                                  border:
                                    0,
                                  borderRadius:
                                    "15px",
                                  background:
                                    "transparent",
                                  color:
                                    selected
                                      ? "#202124"
                                      : enabled
                                        ? "rgba(255,255,255,.9)"
                                        : "var(--meta)",
                                  fontFamily:
                                    "inherit",
                                  fontSize:
                                    "calc(var(--bubble-font-size) - 5px)",
                                  fontWeight:
                                    selected
                                      ? 600
                                      : 400,
                                  cursor:
                                    notificationBusy
                                      ? "wait"
                                      : "pointer",
                                  transition:
                                    "color .18s ease",
                                }}
                              >
                                {t(
                                  mode ===
                                    "off"
                                    ? "notificationOff"
                                    : mode ===
                                        "important"
                                      ? "notificationImportant"
                                      : "notificationAll",
                                )}
                              </button>
                            );
                          },
                        )}
                      </div>
                    )}
                </div>

                {notificationState ===
                  "ios-install-required" &&
                  showIosInstallGuide && (
                    <div
                      style={{
                        margin:
                          "0 0 12px",
                        padding:
                          "12px 14px",
                        borderRadius:
                          "14px",
                        background:
                          "var(--input-bg)",
                        color:
                          "var(--text)",
                        fontSize:
                          "calc(var(--bubble-font-size) - 4px)",
                        lineHeight:
                          1.5,
                      }}
                    >
                      <div>
                        1.{" "}
                        {t(
                          "notificationInstallStep1",
                        )}
                      </div>

                      <div
                        style={{
                          marginTop:
                            "5px",
                        }}
                      >
                        2.{" "}
                        {t(
                          "notificationInstallStep2",
                        )}
                      </div>

                      <div
                        style={{
                          marginTop:
                            "5px",
                        }}
                      >
                        3.{" "}
                        {t(
                          "notificationInstallStep3",
                        )}
                      </div>
                    </div>
                  )}

                <div
                  style={{
                    height:
                      "1px",
                    background:
                      "var(--hairline)",
                    margin:
                      "8px 0",
                  }}
                />
              </>
            )}

          {onAdmin && (
            <>
              <div
                style={{
                  height: "1px",
                  background:
                    "var(--hairline)",
                  margin: "8px 0",
                }}
              />

              <button
                type="button"
                className="w-full border-none bg-transparent cursor-pointer flex items-center justify-between"
                style={{
                  padding:
                    "12px 0",
                  color:
                    "var(--gray-text)",
                  fontFamily:
                    "inherit",
                }}
                onClick={onAdmin}
              >
                <span
                  style={{
                    fontSize:
                      "var(--bubble-font-size, 15px)",
                  }}
                >
                  {t(
                    "adminSettings",
                  )}
                </span>

                <span
                  style={{
                    color:
                      "var(--meta)",
                    fontSize:
                      "20px",
                    lineHeight: 1,
                  }}
                >
                  ›
                </span>
              </button>
            </>
          )}
        </div>
      </div>

      {showNotificationInfo && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center p-6 animate-[ctxFade_0.16s_ease]"
          style={{
            background:
              "rgba(0,0,0,.32)",
            backdropFilter:
              "blur(3px)",
            WebkitBackdropFilter:
              "blur(3px)",
          }}
          onClick={(event) => {
            if (
              event.target ===
              event.currentTarget
            ) {
              setShowNotificationInfo(
                false,
              );
            }
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="notification-info-title"
            className="w-full max-w-[300px] rounded-[16px] overflow-hidden"
            style={{
              background:
                "var(--bg)",
              color:
                "var(--gray-text)",
              boxShadow:
                "0 14px 45px rgba(0,0,0,.25)",
            }}
          >
            <div
              className="flex items-center justify-between"
              style={{
                padding:
                  "14px 16px",
                borderBottom:
                  "0.5px solid var(--hairline)",
              }}
            >
              <h4
                id="notification-info-title"
                className="m-0 font-medium"
                style={{
                  fontSize:
                    "var(--bubble-font-size, 15px)",
                }}
              >
                {t(
                  "notificationInfoTitle",
                )}
              </h4>

              <button
                type="button"
                aria-label={t(
                  "close",
                )}
                onClick={() =>
                  setShowNotificationInfo(
                    false,
                  )
                }
                style={{
                  padding:
                    "4px 7px",
                  border: 0,
                  background:
                    "transparent",
                  color:
                    "var(--meta)",
                  cursor:
                    "pointer",
                }}
              >
                <CloseIcon />
              </button>
            </div>

            <div
              style={{
                padding:
                  "8px 16px 14px",
              }}
            >
              {(
                [
                  "off",
                  "important",
                  "all",
                ] as const
              ).map((mode) => (
                <div
                  key={mode}
                  style={{
                    padding:
                      "9px 0",
                    borderBottom:
                      mode === "all"
                        ? 0
                        : "0.5px solid var(--hairline)",
                  }}
                >
                  <div
                    style={{
                      fontSize:
                        "calc(var(--bubble-font-size) - 1px)",
                      fontWeight:
                        600,
                    }}
                  >
                    {t(
                      mode ===
                        "off"
                        ? "notificationOff"
                        : mode ===
                            "important"
                          ? "notificationImportant"
                          : "notificationAll",
                    )}
                  </div>

                  <div
                    style={{
                      marginTop:
                        "3px",
                      color:
                        "var(--meta)",
                      fontSize:
                        "calc(var(--bubble-font-size) - 4px)",
                      lineHeight:
                        1.4,
                    }}
                  >
                    {t(
                      mode ===
                        "off"
                        ? "notificationOffDesc"
                        : mode ===
                            "important"
                          ? onAdmin
                            ? "ownerImportantNotificationsDesc"
                            : "memberImportantNotificationsDesc"
                          : "notificationAllDesc",
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}