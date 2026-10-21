import SellerView from "@/views/SellerView";
export default async function Page({ params }: PageProps<"/seller/[shop]/[token]">) {
  const { shop, token } = await params;
  return <SellerView shop={shop} token={token} />;
}
