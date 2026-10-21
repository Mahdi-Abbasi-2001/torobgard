import CompareShopsView from "@/views/CompareShopsView";
export default async function Page({ params, searchParams }: PageProps<"/p/[id]/shops/compare">) {
  const { id } = await params;
  const { ids } = await searchParams;
  return <CompareShopsView id={decodeURIComponent(id)} ids={String(ids ?? "").split(",").filter(Boolean).slice(0, 4)} />;
}
