import GoMission from "@/views/GoMission";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <GoMission productId={decodeURIComponent(id)} view="find" />;
}
