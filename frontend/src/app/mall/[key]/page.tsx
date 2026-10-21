import MallView from "@/views/MallView";
export default async function Page({ params }: PageProps<"/mall/[key]">) {
  const { key } = await params;
  return <MallView mallKey={decodeURIComponent(key)} />;
}
