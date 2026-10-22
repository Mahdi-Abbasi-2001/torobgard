import AuthView from "@/views/AuthView";
export default async function Page({ searchParams }: PageProps<"/login">) {
  const { mode, next } = await searchParams;
  return <AuthView mode={mode === "signup" ? "signup" : "login"} next={typeof next === "string" ? next : undefined} />;
}
