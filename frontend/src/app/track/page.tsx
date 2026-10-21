import TrackView from "@/views/TrackView";
export default async function Page({ searchParams }: PageProps<"/track">) {
  const { product } = await searchParams;
  return <TrackView product={typeof product === "string" ? product : undefined} />;
}
