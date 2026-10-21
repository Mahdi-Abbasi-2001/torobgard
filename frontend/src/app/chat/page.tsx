import ChatView from "@/views/ChatView";
export default async function Page({ searchParams }: PageProps<"/chat">) {
  const { q } = await searchParams;
  return <ChatView initial={typeof q === "string" && q ? q : undefined} />;
}
