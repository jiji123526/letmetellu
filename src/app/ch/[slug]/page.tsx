import { ChatView } from "@/components/chat/ChatView";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function ChannelPage({ params }: Props) {
  const { slug } = await params;
  return <ChatView channelId={slug} />;
}
