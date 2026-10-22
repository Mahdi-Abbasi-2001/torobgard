import GoMission from "@/views/GoMission";
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { product } = await searchParams;
  return <GoMission productId={typeof product === "string" ? product : null} view="confirm" />;
}
