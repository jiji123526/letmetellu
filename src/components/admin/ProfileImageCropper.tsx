"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/hooks/useLocale";

const CROP_SIZE = 240;
const OUTPUT_SIZE = 512;

interface ProfileImageCropperProps {
  file: File;
  onCancel: () => void;
  onConfirm: (file: File, preview: string) => void;
}

export function ProfileImageCropper({ file, onCancel, onConfirm }: ProfileImageCropperProps) {
  const { t } = useLocale();
  const imageRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const [source, setSource] = useState("");
  const [naturalSize, setNaturalSize] = useState({ width: 1, height: 1 });
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setSource(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const baseScale = Math.max(CROP_SIZE / naturalSize.width, CROP_SIZE / naturalSize.height);
  const baseWidth = naturalSize.width * baseScale;
  const baseHeight = naturalSize.height * baseScale;

  const clampOffset = (x: number, y: number, nextZoom = zoom) => ({
    x: Math.max(-(baseWidth * nextZoom - CROP_SIZE) / 2, Math.min((baseWidth * nextZoom - CROP_SIZE) / 2, x)),
    y: Math.max(-(baseHeight * nextZoom - CROP_SIZE) / 2, Math.min((baseHeight * nextZoom - CROP_SIZE) / 2, y)),
  });

  const confirmCrop = () => {
    const image = imageRef.current;
    if (!image) return;
    const displayScale = baseScale * zoom;
    const displayWidth = naturalSize.width * displayScale;
    const displayHeight = naturalSize.height * displayScale;
    const sourceX = ((displayWidth - CROP_SIZE) / 2 - offset.x) / displayScale;
    const sourceY = ((displayHeight - CROP_SIZE) / 2 - offset.y) / displayScale;
    const sourceSize = CROP_SIZE / displayScale;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.drawImage(image, sourceX, sourceY, sourceSize, sourceSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    canvas.toBlob((blob) => {
      if (!blob) return;
      const croppedFile = new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "profile"}-cropped.jpg`, { type: "image/jpeg" });
      onConfirm(croppedFile, canvas.toDataURL("image/jpeg", 0.9));
    }, "image/jpeg", 0.9);
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-5" style={{ background: "rgba(0,0,0,.55)", backdropFilter: "blur(6px)" }}>
      <div className="w-full max-w-[320px] rounded-[20px] p-5" style={{ background: "var(--bg)", color: "var(--gray-text)", boxShadow: "0 18px 60px rgba(0,0,0,.3)" }}>
        <h3 className="m-0 mb-4 text-center text-[17px] font-semibold">{t("cropProfilePhoto")}</h3>
        <div
          className="relative mx-auto overflow-hidden touch-none cursor-grab active:cursor-grabbing"
          style={{ width: CROP_SIZE, height: CROP_SIZE, borderRadius: "18px", background: "var(--card)" }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = { x: event.clientX, y: event.clientY, startX: offset.x, startY: offset.y };
          }}
          onPointerMove={(event) => {
            if (!dragRef.current) return;
            setOffset(clampOffset(
              dragRef.current.startX + event.clientX - dragRef.current.x,
              dragRef.current.startY + event.clientY - dragRef.current.y,
            ));
          }}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
        >
          {source && (
            <img
              ref={imageRef}
              src={source}
              alt=""
              draggable={false}
              onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
              className="absolute left-1/2 top-1/2 max-w-none select-none pointer-events-none"
              style={{
                width: baseWidth,
                height: baseHeight,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) scale(${zoom})`,
                transformOrigin: "center",
              }}
            />
          )}
          <div className="pointer-events-none absolute inset-0 rounded-[18px]" style={{ boxShadow: "inset 0 0 0 1px rgba(255,255,255,.55)" }} />
        </div>
        <div className="mt-5 flex items-center gap-3">
          <span className="text-[13px]" style={{ color: "var(--meta)" }}>−</span>
          <input
            className="flex-1"
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            aria-label={t("cropZoom")}
            onChange={(event) => {
              const nextZoom = Number(event.target.value);
              setZoom(nextZoom);
              setOffset((current) => clampOffset(current.x, current.y, nextZoom));
            }}
          />
          <span className="text-[18px]" style={{ color: "var(--meta)" }}>＋</span>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" className="border-none rounded-[12px] py-3 text-[14px] cursor-pointer" style={{ background: "var(--card)", color: "var(--gray-text)" }} onClick={onCancel}>{t("cancel")}</button>
          <button type="button" className="border-none rounded-[12px] py-3 text-white text-[14px] font-semibold cursor-pointer" style={{ background: "#007aff" }} onClick={confirmCrop}>{t("confirm")}</button>
        </div>
      </div>
    </div>
  );
}
