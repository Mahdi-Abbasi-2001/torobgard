import GoMission from "@/views/GoMission";
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const { ids } = await searchParams;
  return <GoMission productId={decodeURIComponent(id)} view="compare" ids={String(ids ?? "").split(",").filter(Boolean).slice(0, 5)} />;
}
