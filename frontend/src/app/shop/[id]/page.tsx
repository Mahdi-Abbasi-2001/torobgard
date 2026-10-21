import ShopView from "@/views/ShopView";
export default async function Page({ params, searchParams }: PageProps<"/shop/[id]">) {
  const { id } = await params;
  const { product } = await searchParams;
  return <ShopView id={decodeURIComponent(id)} product={typeof product === "string" ? product : undefined} />;
}
