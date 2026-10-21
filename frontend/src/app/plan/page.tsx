import PlanView from "@/views/PlanView";
export default async function Page({ searchParams }: PageProps<"/plan">) {
  const { product } = await searchParams;
  return <PlanView product={typeof product === "string" ? product : undefined} />;
}
