import CompareView from "@/views/CompareView";
export default async function Page({ searchParams }: PageProps<"/compare">) {
  const { ids } = await searchParams;
  return <CompareView ids={String(ids ?? "").split(",").filter(Boolean).slice(0, 4)} />;
}
