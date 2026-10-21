import SearchView from "@/views/SearchView";
const s = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
export default async function Page({ searchParams }: PageProps<"/search">) {
  const sp = await searchParams;
  return <SearchView sp={{ q: s(sp.q), category: s(sp.category), brand: s(sp.brand), price_max: s(sp.price_max) }} />;
}
