import { ChatView } from "@/components/chat/ChatView";

interface Props {
  params: Promise<{ slug: string }>;
}

export default async function ChannelPage({ params }: Props) {
  const { slug } = await params;

  return (
    <main className="h-screen flex flex-col">
      <ChatView channelId={slug} />
    </main>
  );
}
