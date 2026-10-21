import ShopsView from "@/views/ShopsView";
export default async function Page({ params }: PageProps<"/p/[id]/shops">) {
  const { id } = await params;
  return <ShopsView id={decodeURIComponent(id)} />;
}
