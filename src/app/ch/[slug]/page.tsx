import { ChatView } from "@/components/chat/ChatView";
import { Providers } from "@/components/Providers";
import { VisitSurvey } from "@/components/VisitSurvey";
import { channelPreviewVersion, getPublicChannelPreview } from "@/lib/channel-preview";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ slug: string }>;
}

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_ORIGIN || "https://yapndot.com";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const channel = await getPublicChannelPreview(slug);
  if (!channel) {
    return {
      title: "yap.",
      description: "Anonymous chat platform",
    };
  }

  const channelUrl = new URL(`/ch/${encodeURIComponent(slug)}`, APP_ORIGIN).toString();
  const imageUrl = new URL(`/ch/${encodeURIComponent(slug)}/opengraph-image`, APP_ORIGIN);
  imageUrl.searchParams.set("v", channelPreviewVersion(channel));
  const title = `${channel.name} | yap.`;
  const description = "링크로 이어지는 익명 채팅";

  return {
    title,
    description,
    alternates: { canonical: channelUrl },
    openGraph: {
      type: "website",
      siteName: "yap.",
      title,
      description,
      url: channelUrl,
      images: [{
        url: imageUrl.toString(),
        width: 1200,
        height: 630,
        alt: `${channel.name} channel preview`,
      }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl.toString()],
    },
  };
}

export default async function ChannelPage({ params }: Props) {
  const { slug } = await params;
  return (
    <Providers>
      <ChatView channelId={slug} />
      <VisitSurvey />
    </Providers>
  );
}
