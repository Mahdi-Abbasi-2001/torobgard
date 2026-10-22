import SnapView from "@/views/SnapView";
export default async function Page({ searchParams }: PageProps<"/snap">) {
  const { t } = await searchParams;
  return <SnapView t={typeof t === "string" ? t : undefined} />;
}
