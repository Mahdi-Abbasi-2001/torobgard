import ProductView from "@/views/ProductView";
export default async function Page({ params }: PageProps<"/p/[id]">) {
  const { id } = await params;
  return <ProductView id={decodeURIComponent(id)} />;
}
