import AskView from "@/views/AskView";
export default async function Page({ params }: PageProps<"/p/[id]/ask">) {
  const { id } = await params;
  return <AskView id={decodeURIComponent(id)} />;
}
