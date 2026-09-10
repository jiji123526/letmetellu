import assert from "node:assert/strict";
import test from "node:test";
import { parsePreviewMetadata } from "../src/lib/preview-metadata.ts";

test("preview metadata falls back to the largest safe document icon and hostname", () => {
  const metadata = parsePreviewMetadata(`
    <html>
      <head>
        <link href="/favicon-32.png" sizes="32x32" rel="icon">
        <link sizes="144x144" rel="shortcut icon" href="/favicon-144.png">
      </head>
    </html>
  `, "https://www.youtube.com/@example");

  assert.deepEqual(metadata, {
    title: "@example",
    description: "",
    image: "",
    icon: "https://www.youtube.com/favicon-144.png",
    video: "",
    siteName: "youtube.com",
  });
});

test("preview metadata derives only bounded profile-like path labels", () => {
  assert.equal(
    parsePreviewMetadata("", "https://youtube.com/@Stone_Pot").title,
    "@Stone_Pot",
  );
  assert.equal(
    parsePreviewMetadata("", "https://example.com/profile/creator-name").title,
    "creator-name",
  );
  assert.equal(
    parsePreviewMetadata("", "https://example.com/posts/private-looking-slug").title,
    "",
  );
  assert.equal(
    parsePreviewMetadata("", "https://example.com/@name%2Fadmin").title,
    "",
  );
});

test("preview metadata keeps icons separate from large preview media", () => {
  const metadata = parsePreviewMetadata(`
    <meta property="og:title" content="Example">
    <meta property="og:image" content="/cover.jpg">
    <link rel="apple-touch-icon" href="/touch.png" sizes="180x180">
  `, "https://example.com/profile");

  assert.equal(metadata.image, "https://example.com/cover.jpg");
  assert.equal(metadata.icon, "https://example.com/touch.png");
});

test("preview metadata rejects non-http icon URLs", () => {
  const metadata = parsePreviewMetadata(
    `<link rel="icon" href="data:image/svg+xml,unsafe">`,
    "https://example.com/",
  );
  assert.equal(metadata.icon, "");
  assert.equal(metadata.siteName, "example.com");
});
