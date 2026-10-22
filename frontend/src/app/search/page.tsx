import SearchView from "@/views/SearchView";
const s = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
export default async function Page({ searchParams }: PageProps<"/search">) {
  const sp = await searchParams;
  return <SearchView sp={{ q: s(sp.q), category: s(sp.category), brand: s(sp.brand), price_max: s(sp.price_max),
    need: s(sp.need), spec: s(sp.spec), near: s(sp.near), inst: s(sp.inst), open: s(sp.open), sort: s(sp.sort) }} />;
}
